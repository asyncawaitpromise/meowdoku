import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import path from 'path'
import os from 'os'
import fs from 'fs'

// db.mjs opens its sqlite file at import time, so the DB_PATH override has to be
// set before anything imports (transitively) db.mjs or routes/progress.mjs.
const dbPath = path.join(os.tmpdir(), `meowdoku-progress-test-${process.pid}-${Date.now()}.db`)
process.env.DB_PATH = dbPath
process.env.JWT_SECRET = 'test-jwt-secret'

const { default: authRouter } = await import('../../routes/auth.mjs')
const { default: progressRouter } = await import('../../routes/progress.mjs')

const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
app.use('/api/progress', progressRouter)

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true })
})

async function createGuest() {
  const res = await request(app).post('/api/auth/guest')
  return res.body.token
}

describe('GET /api/progress', () => {
  it('returns empty defaults for a brand-new user', async () => {
    const token = await createGuest()
    const res = await request(app).get('/api/progress').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ completedLevels: [], completedPuzzles: {}, savedGames: {} })
  })

  it('requires auth', async () => {
    const res = await request(app).get('/api/progress')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/progress', () => {
  it('partially updates without clobbering the other field', async () => {
    const token = await createGuest()
    const auth = { Authorization: `Bearer ${token}` }

    const first = await request(app).patch('/api/progress').set(auth).send({ completedLevels: [1, 2, 3] })
    expect(first.status).toBe(200)
    expect(first.body.completedLevels).toEqual([1, 2, 3])

    const second = await request(app).patch('/api/progress').set(auth)
      .send({ completedPuzzles: { easy: [0, 1], medium: [], hard: [], expert: [] } })
    expect(second.status).toBe(200)
    expect(second.body.completedPuzzles).toEqual({ easy: [0, 1], medium: [], hard: [], expert: [] })

    const fetched = await request(app).get('/api/progress').set(auth)
    expect(fetched.body.completedLevels).toEqual([1, 2, 3])
    expect(fetched.body.completedPuzzles).toEqual({ easy: [0, 1], medium: [], hard: [], expert: [] })
  })
})

describe('saved games', () => {
  it('upserts and fetches a saved game', async () => {
    const token = await createGuest()
    const auth = { Authorization: `Bearer ${token}` }
    const game = { level: { foo: 'bar' }, board: [['empty']], solvedRegions: [], fishCount: 0, wrongCells: [] }

    const put = await request(app).put('/api/progress/games/level-3').set(auth).send(game)
    expect(put.status).toBe(200)

    const fetched = await request(app).get('/api/progress').set(auth)
    expect(fetched.body.savedGames['level-3']).toEqual(game)

    const updatedGame = { ...game, fishCount: 5 }
    await request(app).put('/api/progress/games/level-3').set(auth).send(updatedGame)
    const refetched = await request(app).get('/api/progress').set(auth)
    expect(refetched.body.savedGames['level-3']).toEqual(updatedGame)
    expect(Object.keys(refetched.body.savedGames)).toHaveLength(1)
  })

  it('deletes a saved game', async () => {
    const token = await createGuest()
    const auth = { Authorization: `Bearer ${token}` }
    await request(app).put('/api/progress/games/puzzle-medium-7').set(auth).send({ level: {}, board: [], solvedRegions: [], fishCount: 0, wrongCells: [] })

    const del = await request(app).delete('/api/progress/games/puzzle-medium-7').set(auth)
    expect(del.status).toBe(204)

    const fetched = await request(app).get('/api/progress').set(auth)
    expect(fetched.body.savedGames).toEqual({})
  })
})

describe('POST /api/progress/reset', () => {
  it('clears completed levels/puzzles and all saved games', async () => {
    const token = await createGuest()
    const auth = { Authorization: `Bearer ${token}` }

    await request(app).patch('/api/progress').set(auth).send({ completedLevels: [1], completedPuzzles: { easy: [0] } })
    await request(app).put('/api/progress/games/level-1').set(auth).send({ level: {}, board: [], solvedRegions: [], fishCount: 0, wrongCells: [] })

    const reset = await request(app).post('/api/progress/reset').set(auth)
    expect(reset.status).toBe(200)

    const fetched = await request(app).get('/api/progress').set(auth)
    expect(fetched.body).toEqual({ completedLevels: [], completedPuzzles: {}, savedGames: {} })
  })
})

describe('per-user isolation', () => {
  it("one user's progress and saved games are invisible to another user", async () => {
    const tokenA = await createGuest()
    const tokenB = await createGuest()
    const authA = { Authorization: `Bearer ${tokenA}` }
    const authB = { Authorization: `Bearer ${tokenB}` }

    await request(app).patch('/api/progress').set(authA).send({ completedLevels: [42] })
    await request(app).put('/api/progress/games/level-1').set(authA).send({ level: {}, board: [], solvedRegions: [], fishCount: 0, wrongCells: [] })

    const fetchedB = await request(app).get('/api/progress').set(authB)
    expect(fetchedB.body).toEqual({ completedLevels: [], completedPuzzles: {}, savedGames: {} })
  })
})
