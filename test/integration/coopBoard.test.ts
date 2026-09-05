import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-coop-test-${process.pid}-${Date.now()}.db`)
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
  const token = res.body.token
  // Sending a friend request now requires a nickname — every test guest gets
  // one so `befriend()` keeps working regardless of who's the requester.
  const named = await request(app).patch('/api/auth/profile').set({ Authorization: `Bearer ${token}` }).send({ name: 'Test User' })
  return { token, user: named.body.user }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function befriend(a: { token: string }, b: { token: string; user: any }) {
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))
}

async function makeCoopMatch() {
  const a = await createGuest()
  const b = await createGuest()
  await befriend(a, b)
  const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'coop', difficulty: 'medium', inviteFriendId: b.user.id })
  await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(b.token))
  return { a, b, sessionId: created.body.id }
}

describe('POST /api/matches/:id/place', () => {
  it('places a cell and reflects it in the session', async () => {
    const { a, sessionId } = await makeCoopMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 2, col: 3, state: 'marker' })
    expect(res.status).toBe(200)
    expect(res.body.boardState['2,3']).toBe('marker')
  })

  it('403s for a non-participant', async () => {
    const { sessionId } = await makeCoopMatch()
    const outsider = await createGuest()

    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(outsider.token)).send({ row: 0, col: 0, state: 'marker' })
    expect(res.status).toBe(403)
  })

  it('rejects placement on a non-coop session', async () => {
    const a = await createGuest()
    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })

    const res = await request(app).post(`/api/matches/${created.body.id}/place`).set(auth(a.token)).send({ row: 0, col: 0, state: 'marker' })
    expect(res.status).toBe(400)
  })

  it('is idempotent when placing the same state twice', async () => {
    const { a, sessionId } = await makeCoopMatch()

    await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 1, col: 1, state: 'cat' })
    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 1, col: 1, state: 'cat' })

    expect(res.status).toBe(200)
    expect(res.body.boardState['1,1']).toBe('cat')
    expect(Object.keys(res.body.boardState)).toHaveLength(1)
  })

  it('lets either participant overwrite a cell the other placed, last-write-wins', async () => {
    const { a, b, sessionId } = await makeCoopMatch()

    await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 4, col: 4, state: 'marker' })
    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(b.token)).send({ row: 4, col: 4, state: 'cat' })

    expect(res.status).toBe(200)
    expect(res.body.boardState['4,4']).toBe('cat')
  })

  it('emits a match_placement event to the other participant', async () => {
    const { a, b, sessionId } = await makeCoopMatch()

    const received = new Promise<any>(resolve => {
      appEvents.once(`update:${b.user.id}`, resolve)
    })

    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 5, col: 6, state: 'cat' })
    expect(res.status).toBe(200)

    const event = await received
    expect(event.type).toBe('match_placement')
    expect(event.sessionId).toBe(sessionId)
    expect(event.row).toBe(5)
    expect(event.col).toBe(6)
    expect(event.state).toBe('cat')
    expect(event.byUserId).toBe(a.user.id)
  })

  it('rejects coordinates outside the bounded board range', async () => {
    const { a, sessionId } = await makeCoopMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 32, col: 0, state: 'marker' })
    expect(res.status).toBe(400)

    const res2 = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: -1, col: 0, state: 'marker' })
    expect(res2.status).toBe(400)
  })

  it('rejects an invalid cell state', async () => {
    const { a, sessionId } = await makeCoopMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 0, col: 0, state: 'nuke' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/matches/:id boardState', () => {
  it('reflects previously placed cells for a reconnecting client', async () => {
    const { a, sessionId } = await makeCoopMatch()

    await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 0, col: 0, state: 'marker' })
    await request(app).post(`/api/matches/${sessionId}/place`).set(auth(a.token)).send({ row: 9, col: 9, state: 'cat' })

    const res = await request(app).get(`/api/matches/${sessionId}`).set(auth(a.token))
    expect(res.status).toBe(200)
    expect(res.body.boardState).toEqual({ '0,0': 'marker', '9,9': 'cat' })
  })

  it('defaults to an empty boardState for a session with no placements', async () => {
    const a = await createGuest()
    const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'coop', difficulty: 'easy' })

    const res = await request(app).get(`/api/matches/${created.body.id}`).set(auth(a.token))
    expect(res.body.boardState).toEqual({})
  })
})
