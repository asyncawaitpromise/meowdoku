import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-names-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: progressRouter } = await import('../../routes/progress.mjs')
const { default: friendsRouter } = await import('../../routes/friends.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/progress', progressRouter)
app.use('/api/friends', friendsRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  return { token: res.body.token as string, user: res.body.user }
}

async function createFriendPair() {
  const first = await createGuest()
  const second = await createGuest()
  await request(app).post('/api/friends/requests').set(auth(first.token)).send({ friendCode: second.user.friend_code })
  const pending = await request(app).get('/api/friends/requests').set(auth(second.token))
  await request(app).post(`/api/friends/requests/${pending.body.requests[0].id}/accept`).set(auth(second.token))
  return { first, second }
}

describe('generated guest names', () => {
  it('gives a brand-new guest a generated name', async () => {
    const guest = await createGuest()
    expect(guest.user.name).toMatch(/^\w+ \w+ \d{2}$/)
  })

  it('lets an unedited guest send a friend request', async () => {
    const sender = await createGuest()
    const target = await createGuest()

    const res = await request(app)
      .post('/api/friends/requests')
      .set(auth(sender.token))
      .send({ friendCode: target.user.friend_code })
    expect(res.status).toBe(201)
  })

  it('rejects clearing your own name', async () => {
    const guest = await createGuest()
    const res = await request(app).patch('/api/auth/profile').set(auth(guest.token)).send({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('lets a guest edit their generated name', async () => {
    const guest = await createGuest()
    const res = await request(app).patch('/api/auth/profile').set(auth(guest.token)).send({ name: 'Zeke' })
    expect(res.body.user.name).toBe('Zeke')
  })
})

describe('friend nicknames', () => {
  it('stores a private nickname only the setter sees, and clears it when empty', async () => {
    const { first, second } = await createFriendPair()

    const set = await request(app).put(`/api/friends/${second.user.id}/nickname`).set(auth(first.token)).send({ nickname: 'Bestie' })
    expect(set.body.nickname).toBe('Bestie')

    const setterView = await request(app).get('/api/friends').set(auth(first.token))
    expect(setterView.body.friends[0].nickname).toBe('Bestie')
    const otherView = await request(app).get('/api/friends').set(auth(second.token))
    expect(otherView.body.friends[0].nickname).toBeNull()

    await request(app).put(`/api/friends/${second.user.id}/nickname`).set(auth(first.token)).send({ nickname: '' })
    const cleared = await request(app).get('/api/friends').set(auth(first.token))
    expect(cleared.body.friends[0].nickname).toBeNull()
  })

  it('refuses a nickname for someone who is not a friend', async () => {
    const guest = await createGuest()
    const stranger = await createGuest()
    const res = await request(app).put(`/api/friends/${stranger.user.id}/nickname`).set(auth(guest.token)).send({ nickname: 'X' })
    expect(res.status).toBe(404)
  })
})
