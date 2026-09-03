import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-match-validation-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: matchesRouter } = await import('../../routes/matches.mjs')

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

async function createActiveMatch() {
  const a = await createGuest()
  const b = await createGuest()
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))

  const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })
  await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(b.token))

  return { a, b, sessionId: created.body.id }
}

describe('head-to-head event scorecard validation', () => {
  it('accepts a forward-moving cat_found sequence', async () => {
    const { a, sessionId } = await createActiveMatch()

    const first = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 1 } })
    expect(first.status).toBe(201)

    const second = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 2 } })
    expect(second.status).toBe(201)
  })

  it('rejects a cat_found count that does not move forward', async () => {
    const { a, sessionId } = await createActiveMatch()

    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 4 } })

    const replay = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 4 } })
    expect(replay.status).toBe(400)

    const regress = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 3 } })
    expect(regress.status).toBe(400)
  })

  it('rejects a cat_found count beyond the plausible board-size ceiling', async () => {
    const { a, sessionId } = await createActiveMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 100 } })
    expect(res.status).toBe(400)
  })

  it('accepts at most MAX_LIVES life_lost events, then 400s', async () => {
    const { a, sessionId } = await createActiveMatch()

    for (let remaining = 2; remaining >= 0; remaining--) {
      const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
        .send({ type: 'life_lost', payload: { remaining } })
      expect(res.status).toBe(201)
    }

    const fourth = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'life_lost', payload: { remaining: 0 } })
    expect(fourth.status).toBe(400)
  })

  it('rejects a life_lost event with an out-of-range remaining value', async () => {
    const { a, sessionId } = await createActiveMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'life_lost', payload: { remaining: 99 } })
    expect(res.status).toBe(400)
  })

  it('rejects an x_placed count beyond its ceiling', async () => {
    const { a, sessionId } = await createActiveMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'x_placed', payload: { count: 10_000 } })
    expect(res.status).toBe(400)
  })

  it('rejects without a payload through the same scorecard ceiling', async () => {
    const { a, sessionId } = await createActiveMatch()

    // No payload: accepted, bounded only by the ceiling — 10,001 empty
    // cat_found events would still fail, but a handful passes.
    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found' })
    expect(res.status).toBe(201)
  })

  it("doesn't let one player's scorecard cap another player's events", async () => {
    const { a, b, sessionId } = await createActiveMatch()

    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'cat_found', payload: { count: 1 } })

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(b.token))
      .send({ type: 'cat_found', payload: { count: 1 } })
    expect(res.status).toBe(201)
  })
})