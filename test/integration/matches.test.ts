import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-matches-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: matchesRouter } = await import('../../routes/matches.mjs')
const { default: appEvents } = await import('../../events.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/friends', friendsRouter)
app.use('/api/matches', matchesRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  return { token: res.body.token, user: res.body.user }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function befriend(a: { token: string }, b: { token: string; user: any }, aUser: any) {
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))
}

describe('POST /api/matches', () => {
  it('creates a session with the creator as the sole player', async () => {
    const a = await createGuest()

    const res = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })
    expect(res.status).toBe(201)
    expect(res.body.mode).toBe('head_to_head')
    expect(res.body.difficulty).toBe('medium')
    expect(res.body.status).toBe('waiting')
    expect(typeof res.body.puzzleSeed).toBe('number')
    expect(res.body.players).toHaveLength(1)
    expect(res.body.players[0].id).toBe(a.user.id)
    expect(res.body.players[0].email).toBeUndefined()
  })

  it('rejects an invite to a non-friend', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const res = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'coop', difficulty: 'easy', inviteFriendId: b.user.id })
    expect(res.status).toBe(403)
  })

  it('emits a match_invite event to an invited friend', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b, a.user)

    const received = new Promise<any>(resolve => {
      appEvents.once(`update:${b.user.id}`, resolve)
    })

    const res = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'coop', difficulty: 'hard', inviteFriendId: b.user.id })
    expect(res.status).toBe(201)

    const event = await received
    expect(event.type).toBe('match_invite')
    expect(event.sessionId).toBe(res.body.id)
    expect(event.mode).toBe('coop')
    expect(event.difficulty).toBe('hard')
    expect(event.from.id).toBe(a.user.id)
  })
})

describe('POST /api/matches/:id/join', () => {
  it('adds a second player and flips status to active', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })

    const received = new Promise<any>(resolve => {
      appEvents.once(`update:${a.user.id}`, resolve)
    })

    const joined = await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(b.token))
    expect(joined.status).toBe(200)
    expect(joined.body.status).toBe('active')
    expect(joined.body.players.map((p: any) => p.id).sort()).toEqual([a.user.id, b.user.id].sort())

    const event = await received
    expect(event.type).toBe('match_update')
    expect(event.sessionId).toBe(created.body.id)
    expect(event.status).toBe('active')
  })

  it('is idempotent when the caller is already a player', async () => {
    const a = await createGuest()
    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })

    const res = await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(a.token))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('waiting')
    expect(res.body.players).toHaveLength(1)
  })

  it('rejects joining once the session already has two players', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const c = await createGuest()

    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })
    await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(b.token))

    const res = await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(c.token))
    expect(res.status).toBe(409)
  })

  it('404s for an unknown session', async () => {
    const a = await createGuest()
    const res = await request(app).post('/api/matches/does-not-exist/join').set(auth(a.token))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/matches/:id', () => {
  it('returns the session and its players, reachable by anyone with the id', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'coop', difficulty: 'easy' })

    const res = await request(app).get(`/api/matches/${created.body.id}`).set(auth(b.token))
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(created.body.id)
    expect(res.body.puzzleSeed).toBe(created.body.puzzleSeed)
    expect(res.body.players).toHaveLength(1)
    expect(res.body.players[0].id).toBe(a.user.id)
  })

  it('404s for an unknown session', async () => {
    const a = await createGuest()
    const res = await request(app).get('/api/matches/does-not-exist').set(auth(a.token))
    expect(res.status).toBe(404)
  })
})
