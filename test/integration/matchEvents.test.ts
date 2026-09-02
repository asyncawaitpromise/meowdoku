import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import crypto from 'crypto'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-match-events-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: matchesRouter, pruneSessionEvents, MAX_EVENTS_PER_SESSION } = await import('../../routes/matches.mjs')
const { default: db } = await import('../../db.mjs')
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

async function befriend(a: { token: string }, b: { token: string; user: any }) {
  await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
  const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
  await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))
}

async function createActiveMatch() {
  const a = await createGuest()
  const b = await createGuest()
  await befriend(a, b)

  const created = await request(app).post('/api/matches').set(auth(a.token)).send({ mode: 'head_to_head', difficulty: 'medium' })
  await request(app).post(`/api/matches/${created.body.id}/join`).set(auth(b.token))

  return { a, b, sessionId: created.body.id }
}

describe('POST /api/matches/:id/events', () => {
  it('records an event posted by a participant', async () => {
    const { a, sessionId } = await createActiveMatch()

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'life_lost', payload: { remaining: 2 } })

    expect(res.status).toBe(201)
    expect(res.body.sessionId).toBe(sessionId)
    expect(res.body.fromUserId).toBe(a.user.id)
    expect(res.body.type).toBe('life_lost')
    expect(res.body.payload).toEqual({ remaining: 2 })
    expect(typeof res.body.createdAt).toBe('string')
  })

  it('rejects a caller who is not a participant', async () => {
    const { sessionId } = await createActiveMatch()
    const outsider = await createGuest()

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(outsider.token))
      .send({ type: 'cat_found' })

    expect(res.status).toBe(403)
  })

  it('404s for an unknown session', async () => {
    const a = await createGuest()
    const res = await request(app).post('/api/matches/does-not-exist/events').set(auth(a.token)).send({ type: 'cat_found' })
    expect(res.status).toBe(404)
  })

  it('400s when type is missing', async () => {
    const { a, sessionId } = await createActiveMatch()
    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token)).send({})
    expect(res.status).toBe(400)
  })

  it('emits a match_event to the other participant, not the sender', async () => {
    const { a, b, sessionId } = await createActiveMatch()

    const receivedByB = new Promise<any>(resolve => appEvents.once(`update:${b.user.id}`, resolve))
    let receivedByA = false
    appEvents.once(`update:${a.user.id}`, () => { receivedByA = true })

    const res = await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token))
      .send({ type: 'x_placed', payload: { count: 1 } })
    expect(res.status).toBe(201)

    const event = await receivedByB
    expect(event.type).toBe('match_event')
    expect(event.sessionId).toBe(sessionId)
    expect(event.fromUserId).toBe(a.user.id)
    expect(event.eventType).toBe('x_placed')
    expect(event.payload).toEqual({ count: 1 })
    expect(receivedByA).toBe(false)
  })
})

describe('GET /api/matches/:id/events', () => {
  it('returns the ordered event log for a participant', async () => {
    const { a, b, sessionId } = await createActiveMatch()

    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token)).send({ type: 'x_placed' })
    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(b.token)).send({ type: 'cat_found' })
    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token)).send({ type: 'life_lost' })

    const res = await request(app).get(`/api/matches/${sessionId}/events`).set(auth(b.token))
    expect(res.status).toBe(200)
    expect(res.body.events.map((e: any) => e.type)).toEqual(['x_placed', 'cat_found', 'life_lost'])
    expect(res.body.events.map((e: any) => e.fromUserId)).toEqual([a.user.id, b.user.id, a.user.id])
  })

  it('rejects a caller who is not a participant', async () => {
    const { sessionId } = await createActiveMatch()
    const outsider = await createGuest()

    const res = await request(app).get(`/api/matches/${sessionId}/events`).set(auth(outsider.token))
    expect(res.status).toBe(403)
  })

  it('404s for an unknown session', async () => {
    const a = await createGuest()
    const res = await request(app).get('/api/matches/does-not-exist/events').set(auth(a.token))
    expect(res.status).toBe(404)
  })
})

describe('event log cap', () => {
  it('keeps only the most recent MAX_EVENTS_PER_SESSION events', async () => {
    const { a, sessionId } = await createActiveMatch()
    const insert = db.prepare(`
      INSERT INTO game_session_events (id, session_id, user_id, type) VALUES (?, ?, ?, ?)
    `)
    const total = MAX_EVENTS_PER_SESSION + 25
    for (let i = 0; i < total; i++) {
      insert.run(crypto.randomUUID(), sessionId, a.user.id, 'cat_found')
    }

    pruneSessionEvents(sessionId)

    const res = await request(app).get(`/api/matches/${sessionId}/events`).set(auth(a.token))
    expect(res.body.events).toHaveLength(MAX_EVENTS_PER_SESSION)
    // The oldest 25 were dropped; every kept row is one of the last MAX_EVENTS_PER_SESSION.
    expect(res.body.events.every((e: any) => e.type === 'cat_found')).toBe(true)
  })

  it('POST keeps the session log within the cap', async () => {
    const { a, sessionId } = await createActiveMatch()
    const insert = db.prepare(`
      INSERT INTO game_session_events (id, session_id, user_id, type) VALUES (?, ?, ?, ?)
    `)
    for (let i = 0; i < MAX_EVENTS_PER_SESSION; i++) {
      insert.run(crypto.randomUUID(), sessionId, a.user.id, 'cat_found')
    }

    await request(app).post(`/api/matches/${sessionId}/events`).set(auth(a.token)).send({ type: 'life_lost' })

    const res = await request(app).get(`/api/matches/${sessionId}/events`).set(auth(a.token))
    expect(res.body.events).toHaveLength(MAX_EVENTS_PER_SESSION)
    expect(res.body.events[res.body.events.length - 1].type).toBe('life_lost')
  })
})
