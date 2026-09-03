import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-invites-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: matchesRouter, emitPendingInvites } = await import('../../routes/matches.mjs')
const { default: sseRouter } = await import('../../routes/sse.mjs')
const { default: appEvents } = await import('../../events.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/friends', friendsRouter)
app.use('/api/matches', matchesRouter)
app.use('/api/sse', sseRouter)

let server: ReturnType<typeof app.listen> | null = null

afterAll(() => {
  server?.close()
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  return { token: res.body.token, user: res.body.user }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function befriend(a: { token: string }, b: { token: string; user: any }) {
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))
}

async function challenge(a: { token: string }, b: { user: any }, mode = 'head_to_head') {
  const res = await request(app).post('/api/matches').set(auth(a.token)).send({ mode, difficulty: 'medium', inviteFriendId: b.user.id })
  expect(res.status).toBe(201)
  return res.body
}

describe('persistent invite inbox', () => {
  it('stores the invitee on the session so the invite outlives the SSE emit', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const created = await challenge(a, b)
    expect(created.status).toBe('waiting')
    expect(created.players.map((p: any) => p.id)).toEqual([a.user.id])
  })

  it('lists awaiting invites via GET /api/matches/invites', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const c = await createGuest()
    await befriend(a, b)
    await befriend(a, c)

    await challenge(a, b, 'head_to_head')
    await challenge(a, c, 'coop')

    const bInvites = await request(app).get('/api/matches/invites').set(auth(b.token))
    expect(bInvites.status).toBe(200)
    expect(bInvites.body.invites).toHaveLength(1)
    expect(bInvites.body.invites[0].sessionId).not.toBe(a.user.id)
    expect(bInvites.body.invites[0].sessionId).not.toBe(b.user.id)
    expect(typeof bInvites.body.invites[0].sessionId).toBe('string')
    expect(bInvites.body.invites[0].mode).toBe('head_to_head')
    expect(bInvites.body.invites[0].from.id).toBe(a.user.id)
    expect(bInvites.body.invites[0].from.email).toBeUndefined()
    expect(bInvites.body.invites[0].from.password_hash).toBeUndefined()

    const cInvites = await request(app).get('/api/matches/invites').set(auth(c.token))
    expect(cInvites.body.invites).toHaveLength(1)
    expect(cInvites.body.invites[0].mode).toBe('coop')

    const aInvites = await request(app).get('/api/matches/invites').set(auth(a.token))
    expect(aInvites.body.invites).toEqual([])
  })

  it('drops invites once the session is no longer waiting', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const created = await challenge(a, b)
    await request(app).post(`/api/matches/${created.id}/join`).set(auth(b.token))

    const invites = await request(app).get('/api/matches/invites').set(auth(b.token))
    expect(invites.body.invites).toEqual([])
  })

  it('emitPendingInvites replays parked invites onto the invitee SSE channel', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const created = await challenge(a, b, 'coop')

    const received: any[] = []
    const listener = (data: any) => received.push(data)
    appEvents.on(`update:${b.user.id}`, listener)
    try {
      emitPendingInvites(b.user.id)
    } finally {
      appEvents.off(`update:${b.user.id}`, listener)
    }

    expect(received.some(e => e.type === 'match_invite' && e.sessionId === created.id && e.mode === 'coop')).toBe(true)
  })

  it('delivers a parked invite over the real SSE stream on connect', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)
    const created = await challenge(a, b, 'head_to_head')

    if (!server) server = app.listen(0)
    const port = (server.address() as { port: number }).port

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/sse/stream?token=${encodeURIComponent(b.token)}`, { signal: controller.signal })
      expect(res.status).toBe(200)

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let found = false
      for (;;) {
        const { done, value } = await reader.read()
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        if (buf.includes(`"sessionId":"${created.id}"`) && buf.includes('"type":"match_invite"')) {
          found = true
          break
        }
        if (done) break
      }
      expect(found).toBe(true)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  })
})

describe('POST /api/matches/:id/decline', () => {
  it('deletes the waiting session and tells the host', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)
    const created = await challenge(a, b)

    const notified = new Promise<any>(resolve => appEvents.once(`update:${a.user.id}`, resolve))
    const res = await request(app).post(`/api/matches/${created.id}/decline`).set(auth(b.token))
    expect(res.status).toBe(204)

    const event = await notified
    expect(event.type).toBe('match_update')
    expect(event.sessionId).toBe(created.id)
    expect(event.status).toBe('declined')

    const fetched = await request(app).get(`/api/matches/${created.id}`).set(auth(a.token))
    expect(fetched.status).toBe(404)
  })

  it('rejects someone who is not the invitee', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const c = await createGuest()
    await befriend(a, b)
    const created = await challenge(a, b)

    const res = await request(app).post(`/api/matches/${created.id}/decline`).set(auth(c.token))
    expect(res.status).toBe(403)

    const stillThere = await request(app).get(`/api/matches/${created.id}`).set(auth(a.token))
    expect(stillThere.status).toBe(200)
  })

  it('rejects declining a session that is no longer pending', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)
    const created = await challenge(a, b)
    await request(app).post(`/api/matches/${created.id}/join`).set(auth(b.token))

    const res = await request(app).post(`/api/matches/${created.id}/decline`).set(auth(b.token))
    expect(res.status).toBe(403)
  })
})