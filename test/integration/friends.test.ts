import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-friends-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: progressRouter } = await import('../../routes/progress.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')
const { default: db } = await import('../../db.mjs')
const { default: appEvents } = await import('../../events.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/progress', progressRouter)
app.use('/api/friends', friendsRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  const token = res.body.token
  // Sending a friend request now requires a nickname — every test guest gets
  // one so the requester side of these tests keeps working.
  const named = await request(app).patch('/api/auth/profile').set({ Authorization: `Bearer ${token}` }).send({ name: 'Test User' })
  return { token, user: named.body.user }
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

describe('friend_code generation', () => {
  it('assigns a unique friend_code to every new guest', async () => {
    const a = await createGuest()
    const b = await createGuest()

    expect(a.user.friend_code).toMatch(/^[A-Z0-9]{8}$/)
    expect(b.user.friend_code).toMatch(/^[A-Z0-9]{8}$/)
    expect(a.user.friend_code).not.toBe(b.user.friend_code)
  })
})

describe('POST /api/friends/requests', () => {
  it('sends a pending request by friend code', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const res = await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')

    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    expect(incoming.status).toBe(200)
    expect(incoming.body.requests).toHaveLength(1)
    expect(incoming.body.requests[0].requester.id).toBe(a.user.id)
    expect(incoming.body.requests[0].requester.email).toBeUndefined()
  })

  it('is case-insensitive on the friend code', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const res = await request(app)
      .post('/api/friends/requests')
      .set(auth(a.token))
      .send({ friendCode: b.user.friend_code.toLowerCase() })
    expect(res.status).toBe(201)
  })

  it('rejects a self-request', async () => {
    const a = await createGuest()
    const res = await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: a.user.friend_code })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown friend code', async () => {
    const a = await createGuest()
    const res = await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: 'NOTREAL1' })
    expect(res.status).toBe(404)
  })

  it('rejects a duplicate pending request', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const res = await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    expect(res.status).toBe(409)
  })

  it('auto-accepts when the addressee already has a pending request from the other side', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const res = await request(app).post('/api/friends/requests').set(auth(b.token)).send({ friendCode: a.user.friend_code })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')

    const friendsOfA = await request(app).get('/api/friends').set(auth(a.token))
    expect(friendsOfA.body.friends.map((f: any) => f.id)).toContain(b.user.id)
  })

  it('rejects a request once already friends', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const requests = await request(app).get('/api/friends/requests').set(auth(b.token))
    await request(app).post(`/api/friends/requests/${requests.body.requests[0].id}/accept`).set(auth(b.token))

    const res = await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    expect(res.status).toBe(409)
  })

  it('emits a friend_request SSE event to the addressee', async () => {
    const a = await createGuest()
    const b = await createGuest()

    const received = new Promise<any>(resolve => {
      appEvents.once(`update:${b.user.id}`, resolve)
    })

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })

    const event = await received
    expect(event.type).toBe('friend_request')
    expect(event.request.requester.id).toBe(a.user.id)
  })
})

describe('POST /api/friends/requests/:id/accept and /decline', () => {
  async function sendRequest(from: { token: string }, to: { user: any }) {
    await request(app).post('/api/friends/requests').set(auth(from.token)).send({ friendCode: to.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth((to as any).token))
    return incoming.body.requests[0].id
  }

  it('lets only the addressee accept', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const c = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    const requestId = incoming.body.requests[0].id

    const wrongUser = await request(app).post(`/api/friends/requests/${requestId}/accept`).set(auth(c.token))
    expect(wrongUser.status).toBe(404)

    const requester = await request(app).post(`/api/friends/requests/${requestId}/accept`).set(auth(a.token))
    expect(requester.status).toBe(404)

    const res = await request(app).post(`/api/friends/requests/${requestId}/accept`).set(auth(b.token))
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')
  })

  it('lets only the addressee decline, deleting the row', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    const requestId = incoming.body.requests[0].id

    const wrongUser = await request(app).post(`/api/friends/requests/${requestId}/decline`).set(auth(a.token))
    expect(wrongUser.status).toBe(404)

    const res = await request(app).post(`/api/friends/requests/${requestId}/decline`).set(auth(b.token))
    expect(res.status).toBe(204)

    const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId)
    expect(row).toBeUndefined()

    const stillPending = await request(app).get('/api/friends/requests').set(auth(b.token))
    expect(stillPending.body.requests).toHaveLength(0)
  })
})

describe('GET /api/friends', () => {
  it('returns accepted friends with online status and progress, without leaking email', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))

    await request(app).patch('/api/progress').set(auth(b.token)).send({ completedLevels: [1, 2] })

    const res = await request(app).get('/api/friends').set(auth(a.token))
    expect(res.status).toBe(200)
    expect(res.body.friends).toHaveLength(1)

    const friend = res.body.friends[0]
    expect(friend.id).toBe(b.user.id)
    expect(friend.email).toBeUndefined()
    expect(friend.password_hash).toBeUndefined()
    expect(friend.online).toBe(false)
    expect(friend.progress).toEqual({ completedLevels: [1, 2], completedPuzzles: {} })
  })

  it('defaults progress for a friend with no progress row yet', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))

    const res = await request(app).get('/api/friends').set(auth(a.token))
    expect(res.body.friends[0].progress).toEqual({ completedLevels: [], completedPuzzles: {} })
  })

  it('is symmetric — the friendship shows up for both users regardless of who requested', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))

    const friendsOfB = await request(app).get('/api/friends').set(auth(b.token))
    expect(friendsOfB.body.friends.map((f: any) => f.id)).toEqual([a.user.id])
  })
})

describe('DELETE /api/friends/:userId', () => {
  it('unfriends regardless of who originally requested', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/friends/requests').set(auth(a.token)).send({ friendCode: b.user.friend_code })
    const incoming = await request(app).get('/api/friends/requests').set(auth(b.token))
    await request(app).post(`/api/friends/requests/${incoming.body.requests[0].id}/accept`).set(auth(b.token))

    const del = await request(app).delete(`/api/friends/${a.user.id}`).set(auth(b.token))
    expect(del.status).toBe(204)

    const friendsOfA = await request(app).get('/api/friends').set(auth(a.token))
    expect(friendsOfA.body.friends).toEqual([])
    const friendsOfB = await request(app).get('/api/friends').set(auth(b.token))
    expect(friendsOfB.body.friends).toEqual([])
  })

  it('404s when there is no friendship to remove', async () => {
    const a = await createGuest()
    const b = await createGuest()
    const res = await request(app).delete(`/api/friends/${b.user.id}`).set(auth(a.token))
    expect(res.status).toBe(404)
  })
})
