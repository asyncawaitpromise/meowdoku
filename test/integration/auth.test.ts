import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-auth-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: db } = await import('../../db.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

describe('POST /api/auth/guest', () => {
  it('creates an anonymous user', async () => {
    const res = await request(app).post('/api/auth/guest')
    expect(res.status).toBe(201)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.is_anon).toBe(1)
    expect(res.body.user.email).toBeNull()
    expect(res.body.user.password_hash).toBeUndefined()
  })
})

describe('POST /api/auth/promote', () => {
  async function createGuest() {
    const res = await request(app).post('/api/auth/guest')
    return res.body
  }

  it('promotes a guest to a real account in place', async () => {
    const guest = await createGuest()

    const res = await request(app)
      .post('/api/auth/promote')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ email: 'promoted@example.com', password: 'password123', passwordConfirm: 'password123', name: 'Promoted' })

    expect(res.status).toBe(200)
    expect(res.body.user.id).toBe(guest.user.id)
    expect(res.body.user.is_anon).toBe(0)
    expect(res.body.user.email).toBe('promoted@example.com')
    expect(res.body.user.name).toBe('Promoted')
    expect(res.body.token).not.toBe(guest.token)

    const signinRes = await request(app)
      .post('/api/auth/signin')
      .send({ email: 'promoted@example.com', password: 'password123' })
    expect(signinRes.status).toBe(200)
    expect(signinRes.body.user.id).toBe(guest.user.id)
  })

  it('rejects promotion for a non-anonymous user', async () => {
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'already-real@example.com', password: 'password123', passwordConfirm: 'password123' })

    const res = await request(app)
      .post('/api/auth/promote')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ email: 'wants-to-change@example.com', password: 'password123', passwordConfirm: 'password123' })

    expect(res.status).toBe(403)
  })

  it('rejects promotion to an email already used by a different user', async () => {
    await request(app)
      .post('/api/auth/signup')
      .send({ email: 'taken@example.com', password: 'password123', passwordConfirm: 'password123' })

    const guest = await createGuest()
    const res = await request(app)
      .post('/api/auth/promote')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ email: 'taken@example.com', password: 'password123', passwordConfirm: 'password123' })

    expect(res.status).toBe(409)
  })

  it('requires auth', async () => {
    const res = await request(app).post('/api/auth/promote').send({ email: 'x@example.com', password: 'password123', passwordConfirm: 'password123' })
    expect(res.status).toBe(401)
  })
})

describe('GET /api/auth/oauth/:provider promotion state', () => {
  it('stores the anon user id on oauth_state when a valid guest token is passed', async () => {
    const guestRes = await request(app).post('/api/auth/guest')
    const { token, user } = guestRes.body

    const res = await request(app).get(`/api/auth/oauth/google?token=${token}`)
    expect(res.status).toBe(302)

    const row = db.prepare('SELECT * FROM oauth_state WHERE promote_user_id = ?').get(user.id)
    expect(row).toBeTruthy()
    expect(row.provider).toBe('google')
  })

  it('degrades gracefully when the token is missing, invalid, or non-anon', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM oauth_state WHERE promote_user_id IS NOT NULL').get().n

    const noToken = await request(app).get('/api/auth/oauth/google')
    expect(noToken.status).toBe(302)

    const badToken = await request(app).get('/api/auth/oauth/google?token=not-a-real-jwt')
    expect(badToken.status).toBe(302)

    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'non-anon-oauth@example.com', password: 'password123', passwordConfirm: 'password123' })
    const nonAnonToken = await request(app).get(`/api/auth/oauth/google?token=${signup.body.token}`)
    expect(nonAnonToken.status).toBe(302)

    const after = db.prepare('SELECT COUNT(*) AS n FROM oauth_state WHERE promote_user_id IS NOT NULL').get().n
    expect(after).toBe(before)
  })
})
