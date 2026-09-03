import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createLimiter } from '../../middlewares/rateLimit.mjs'
import { ipKeyGenerator } from 'express-rate-limit'

// Straightforward shape on a scratch app: after `limit` requests the endpoint
// starts returning 429. The prebuilt limiters in rateLimit.mjs read
// RATE_LIMIT_SCALE (100000 in tests), so this drives the factory directly with
// an explicit tiny limit instead of trying to exhaust the real endpoints.
describe('createLimiter', () => {
  it('lets `limit` requests through, then rejects with 429', async () => {
    const app = express()
    app.use(express.json())
    app.post('/thing', createLimiter({ windowMs: 60_000, limit: 3, message: 'slow down' }), (_req, res) => {
      res.json({ ok: true })
    })

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/thing')
      expect(res.status).toBe(200)
    }

    const blocked = await request(app).post('/thing')
    expect(blocked.status).toBe(429)
    expect(blocked.body).toMatchObject({ error: 'slow down' })
  })

  it('keys authenticated limiters by user id, so a shared IP is not throttled together', async () => {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      // Simulate requireAuth having run: two distinct "users" behind one IP.
      req.user = req.headers['x-user'] === 'a' ? { id: 'user-a' } : { id: 'user-b' }
      next()
    })
    app.post(
      '/thing',
      createLimiter({ windowMs: 60_000, limit: 2, keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip) }),
      (_req, res) => res.json({ ok: true }),
    )

    expect((await request(app).post('/thing').set('x-user', 'a')).status).toBe(200)
    expect((await request(app).post('/thing').set('x-user', 'a')).status).toBe(200)
    expect((await request(app).post('/thing').set('x-user', 'b')).status).toBe(200)
    expect((await request(app).post('/thing').set('x-user', 'a')).status).toBe(429)
    expect((await request(app).post('/thing').set('x-user', 'b')).status).toBe(200)
  })
})