import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-shares-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: sharesRouter } = await import('../../routes/shares.mjs')
const { default: appEvents } = await import('../../events.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/friends', friendsRouter)
app.use('/api/shares', sharesRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  const token = res.body.token
  // Sending a friend request now requires a nickname — every test guest gets
  // one so `befriend()` keeps working regardless of who's the requester.
  const named = await request(app).patch('/api/auth/profile').set({ Authorization: `Bearer ${token}` }).send({ name: 'Test User' })
  return { token, user: named.body.user }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function befriend(a: { token: string; user: any }, b: { token: string; user: any }) {
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))
}

const SAMPLE_CODE = 'mwd1.4.0001112223330.0123.0123'

describe('POST /api/shares', () => {
  it('sends a puzzle share to a friend', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const res = await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })
    expect(res.status).toBe(201)
    expect(res.body.share.shareCode).toBe(SAMPLE_CODE)
    expect(res.body.share.from.id).toBe(a.user.id)
    expect(res.body.share.from.email).toBeUndefined()
  })

  it('rejects a share to a non-friend', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const res = await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })
    expect(res.status).toBe(403)
  })

  it('emits a puzzle_shared SSE event to the recipient', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const received = new Promise<any>(resolve => {
      appEvents.once(`update:${b.user.id}`, resolve)
    })

    await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })

    const event = await received
    expect(event.type).toBe('puzzle_shared')
    expect(event.share.shareCode).toBe(SAMPLE_CODE)
    expect(event.share.from.id).toBe(a.user.id)
  })
})

describe('GET /api/shares', () => {
  it('returns received shares, most recent first, without leaking sender email', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })
    await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE + 'x' })

    const res = await request(app).get('/api/shares').set(auth(b.token))
    expect(res.status).toBe(200)
    expect(res.body.shares).toHaveLength(2)
    expect(res.body.shares[0].shareCode).toBe(SAMPLE_CODE + 'x')
    expect(res.body.shares[0].from.id).toBe(a.user.id)
    expect(res.body.shares[0].from.email).toBeUndefined()
  })

  it('does not return shares sent to someone else', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const c = await createGuest()
    await befriend(a, b)

    await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })

    const res = await request(app).get('/api/shares').set(auth(c.token))
    expect(res.body.shares).toEqual([])
  })
})

describe('DELETE /api/shares/:id', () => {
  it('lets the recipient dismiss a share, using the id as returned from GET', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })
    const inbox = await request(app).get('/api/shares').set(auth(b.token))
    const shareId = inbox.body.shares[0].id
    expect(shareId).not.toBe(a.user.id)

    const del = await request(app).delete(`/api/shares/${shareId}`).set(auth(b.token))
    expect(del.status).toBe(204)

    const res = await request(app).get('/api/shares').set(auth(b.token))
    expect(res.body.shares).toEqual([])
  })

  it('404s for the sender (not the recipient)', async () => {
    const a = await createGuest()
    const b = await createGuest()
    await befriend(a, b)

    const created = await request(app).post('/api/shares').set(auth(a.token)).send({ toUserId: b.user.id, shareCode: SAMPLE_CODE })
    const shareId = created.body.share.id

    const res = await request(app).delete(`/api/shares/${shareId}`).set(auth(a.token))
    expect(res.status).toBe(404)
  })

  it('404s for a nonexistent id', async () => {
    const a = await createGuest()
    const res = await request(app).delete('/api/shares/does-not-exist').set(auth(a.token))
    expect(res.status).toBe(404)
  })
})
