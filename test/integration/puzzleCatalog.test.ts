import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/auth.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-puzzle-catalog-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: db } = await import('../../db.mjs')
const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: puzzleCatalogRouter } = await import('../../routes/puzzleCatalog.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/puzzle-catalog', puzzleCatalogRouter)

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

const SAMPLE_CODE = 'mwd1.4.0001112223330.0123.0123'

describe('POST /api/puzzle-catalog', () => {
  it('stores a submitted puzzle, attributed to its contributor', async () => {
    const a = await createGuest()

    const res = await request(app).post('/api/puzzle-catalog').set(auth(a.token))
      .send({ shareCode: SAMPLE_CODE, difficulty: 'medium', gateMet: true })
    expect(res.status).toBe(202)

    const row = db.prepare('SELECT * FROM generated_puzzles WHERE share_code = ?').get(SAMPLE_CODE)
    expect(row.difficulty).toBe('medium')
    expect(row.gate_met).toBe(1)
    expect(row.contributor_user_id).toBe(a.user.id)
  })

  it('requires a shareCode', async () => {
    const a = await createGuest()
    const res = await request(app).post('/api/puzzle-catalog').set(auth(a.token)).send({})
    expect(res.status).toBe(400)
  })

  it('rejects unauthenticated submissions', async () => {
    const res = await request(app).post('/api/puzzle-catalog').send({ shareCode: SAMPLE_CODE })
    expect(res.status).toBe(401)
  })

  it('dedupes an identical puzzle submitted twice, from different contributors', async () => {
    const a = await createGuest()
    const b = await createGuest()

    await request(app).post('/api/puzzle-catalog').set(auth(a.token)).send({ shareCode: SAMPLE_CODE + 'dup' })
    await request(app).post('/api/puzzle-catalog').set(auth(b.token)).send({ shareCode: SAMPLE_CODE + 'dup' })

    const rows = db.prepare('SELECT * FROM generated_puzzles WHERE share_code = ?').all(SAMPLE_CODE + 'dup')
    expect(rows).toHaveLength(1)
    expect(rows[0].contributor_user_id).toBe(a.user.id)
  })

  it('survives its contributor account being deleted', async () => {
    const a = await createGuest()
    await request(app).post('/api/puzzle-catalog').set(auth(a.token)).send({ shareCode: SAMPLE_CODE + 'orphan' })

    db.prepare('DELETE FROM users WHERE id = ?').run(a.user.id)

    const row = db.prepare('SELECT * FROM generated_puzzles WHERE share_code = ?').get(SAMPLE_CODE + 'orphan')
    expect(row).toBeTruthy()
    expect(row.contributor_user_id).toBeNull()
  })
})
