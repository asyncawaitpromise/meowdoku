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

// ── Startup ingest of the committed curated puzzles ──────────────────────────

const { ingestCuratedPuzzles } = await import('../../scripts/ingestPuzzles.mjs')

function curatedDir(files: Record<string, string[]>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meowdoku-curated-'))
  for (const [difficulty, lines] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${difficulty}.txt`), lines.join('\n') + '\n')
  return dir
}
const codes = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(6, '0')}abc`)

describe('ingestCuratedPuzzles', () => {
  it('loads each file under its difficulty as curated, and is idempotent across restarts', async () => {
    const hard = codes(3, 'fIngH'), expert = codes(2, 'fIngE')
    const dir = curatedDir({ hard, expert })
    expect(await ingestCuratedPuzzles(dir)).toEqual({ inserted: 5, promoted: 0, duplicates: 0, skipped: 0 })
    expect(await ingestCuratedPuzzles(dir)).toEqual({ inserted: 0, promoted: 0, duplicates: 5, skipped: 0 })
    const rows = db.prepare(`SELECT * FROM generated_puzzles WHERE share_code LIKE 'fIng%'`).all()
    expect(rows).toHaveLength(5)
    expect(rows.every((r: any) => r.source === 'curated' && r.gate_met === 1 && r.contributor_user_id === null)).toBe(true)
    expect(rows.filter((r: any) => r.difficulty === 'expert')).toHaveLength(2)
  })

  it('picks up only the new lines when a file grows, and assigns increasing seq', async () => {
    const dir = curatedDir({ hard: codes(2, 'fGrow') })
    await ingestCuratedPuzzles(dir)
    const before = db.prepare(`SELECT MAX(seq) AS m FROM generated_puzzles`).get().m
    fs.writeFileSync(path.join(dir, 'hard.txt'), codes(4, 'fGrow').join('\n') + '\n')
    expect(await ingestCuratedPuzzles(dir)).toEqual({ inserted: 2, promoted: 0, duplicates: 2, skipped: 0 })
    const seqs = db.prepare(`SELECT seq FROM generated_puzzles WHERE share_code LIKE 'fGrow%' ORDER BY seq`).all().map((r: any) => r.seq)
    expect(new Set(seqs).size).toBe(4)
    expect(Math.min(...seqs.slice(2))).toBeGreaterThan(before)
  })

  it('promotes a puzzle a client already contributed instead of duplicating it', async () => {
    const guest = await createGuest()
    const [c] = codes(1, 'fIngPromote')
    await request(app).post('/api/puzzle-catalog').set(auth(guest.token)).send({ shareCode: c, difficulty: 'hard', gateMet: false })
    expect(db.prepare('SELECT source FROM generated_puzzles WHERE share_code = ?').get(c).source).toBeNull()
    expect(await ingestCuratedPuzzles(curatedDir({ expert: [c] }))).toMatchObject({ inserted: 0, promoted: 1 })
    expect(db.prepare('SELECT * FROM generated_puzzles WHERE share_code = ?').get(c)).toMatchObject({ source: 'curated', difficulty: 'expert', gate_met: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM generated_puzzles WHERE share_code = ?').get(c).n).toBe(1)
  })

  it('skips malformed lines and blank lines, and tolerates missing files', async () => {
    const dir = curatedDir({ medium: ['fIngOk0001abc', '<script>alert(1)</script>', '', 'bad code', 'fIngOk0002abc'] })
    expect(await ingestCuratedPuzzles(dir)).toEqual({ inserted: 2, promoted: 0, duplicates: 0, skipped: 2 })
    expect(await ingestCuratedPuzzles(path.join(dir, 'does-not-exist'))).toEqual({ inserted: 0, promoted: 0, duplicates: 0, skipped: 0 })
  })
})

// ── Per-player shuffled batches ──────────────────────────────────────────────

describe('GET /api/puzzle-catalog/batch', () => {
  type Page = { puzzles: { id: string; shareCode: string }[]; cursor: number; since: number; exhausted: boolean }
  const batch = (token: string, q: Record<string, string | number>) =>
    request(app).get('/api/puzzle-catalog/batch').query(q).set(auth(token))

  // Walks a player's whole shuffled order the way the client does, carrying cursor/since between calls.
  async function walk(token: string, difficulty: string, limit = 3, start: { cursor?: number; since?: number } = {}) {
    let cursor = start.cursor ?? -1, since = start.since ?? 0
    const got: string[] = []
    for (let i = 0; i < 100; i++) {
      const res = await batch(token, { difficulty, limit, cursor, since })
      expect(res.status).toBe(200)
      const page = res.body as Page
      got.push(...page.puzzles.map(p => p.shareCode))
      cursor = page.cursor; since = page.since
      if (page.exhausted) return { got, cursor, since }
    }
    throw new Error('walk never exhausted')
  }

  it('walks every curated puzzle of that difficulty exactly once, in batches', async () => {
    const pool = codes(7, 'fWalk')
    await ingestCuratedPuzzles(curatedDir({ hard: pool }))
    const p = await createGuest()
    const { got } = await walk(p.token, 'hard', 3)
    const mine = got.filter(c => c.startsWith('fWalk'))
    expect(mine.sort()).toEqual([...pool].sort())
    expect(new Set(got).size).toBe(got.length)               // no repeats
  })

  it('only serves curated puzzles of the requested difficulty', async () => {
    const guest = await createGuest()
    await request(app).post('/api/puzzle-catalog').set(auth(guest.token)).send({ shareCode: 'fClientOnlyB01abc', difficulty: 'hard', gateMet: true })
    await ingestCuratedPuzzles(curatedDir({ hard: ['fOnlyHard01abc'], expert: ['fOnlyExpert1abc'] }))
    const p = await createGuest()
    const hard = (await walk(p.token, 'hard')).got
    expect(hard).toContain('fOnlyHard01abc')
    expect(hard).not.toContain('fOnlyExpert1abc')
    expect(hard).not.toContain('fClientOnlyB01abc')          // contributed, never curated
  })

  it('gives different players different orders, stable for the same player', async () => {
    await ingestCuratedPuzzles(curatedDir({ hard: codes(12, 'fOrder') }))
    const a = await createGuest(), b = await createGuest()
    const orderOf = async (t: string) => (await walk(t, 'hard', 50)).got.filter(c => c.startsWith('fOrder'))
    const a1 = await orderOf(a.token), a2 = await orderOf(a.token), b1 = await orderOf(b.token)
    expect(a1).toEqual(a2)
    expect(a1.slice().sort()).toEqual(b1.slice().sort())      // same set...
    expect(a1).not.toEqual(b1)                                 // ...different order
  })

  it('catches a returning player up on puzzles added behind their cursor, without repeating any', async () => {
    await ingestCuratedPuzzles(curatedDir({ expert: codes(6, 'fLate') }))
    const p = await createGuest()
    const first = await walk(p.token, 'expert', 50)
    const seenBefore = new Set(first.got)
    // New puzzles arrive. With a finished cursor, every one of them sits "behind" it.
    await ingestCuratedPuzzles(curatedDir({ expert: [...codes(6, 'fLate'), ...codes(5, 'fLateNew')] }))
    const second = await walk(p.token, 'expert', 2, { cursor: first.cursor, since: first.since })
    expect(second.got.filter(c => c.startsWith('fLateNew')).sort()).toEqual(codes(5, 'fLateNew').sort())
    expect(second.got.some(c => seenBefore.has(c))).toBe(false)   // nothing offered twice
    // and once caught up, there is nothing more
    const third = await batch(p.token, { difficulty: 'expert', limit: 10, cursor: second.cursor, since: second.since })
    expect(third.body.puzzles).toEqual([])
    expect(third.body.exhausted).toBe(true)
  })

  it('a mid-walk player also receives newly added puzzles, whichever side of the cursor they land on', async () => {
    await ingestCuratedPuzzles(curatedDir({ hard: codes(10, 'fMid') }))
    const p = await createGuest()
    const partial = (await batch(p.token, { difficulty: 'hard', limit: 4 })).body as Page
    const seen = new Set<string>(partial.puzzles.map(x => x.shareCode))
    await ingestCuratedPuzzles(curatedDir({ hard: [...codes(10, 'fMid'), ...codes(6, 'fMidNew')] }))
    const rest = await walk(p.token, 'hard', 3, { cursor: partial.cursor, since: partial.since })
    const all = [...seen, ...rest.got]
    expect(new Set(all).size).toBe(all.length)                                   // never twice
    expect(all.filter(c => c.startsWith('fMid')).length).toBe(16)                // all 10 original + 6 new, each once
  })

  it('stress: puzzles arriving at random moments during partial walks are each delivered exactly once', async () => {
    // Tiny seeded RNG so a failure is reproducible.
    let seed = 12345
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (let trial = 0; trial < 12; trial++) {
      const prefix = `fStress${trial}x`
      let total = 3 + Math.floor(rnd() * 8)
      const lines = () => codes(total, prefix)
      await ingestCuratedPuzzles(curatedDir({ expert: lines() }))
      const p = await createGuest()
      let cursor = -1, since = 0
      const got: string[] = []
      for (let step = 0; step < 40; step++) {
        const res = await batch(p.token, { difficulty: 'expert', limit: 1 + Math.floor(rnd() * 4), cursor, since })
        const page = res.body as Page
        got.push(...page.puzzles.map(x => x.shareCode))
        cursor = page.cursor; since = page.since
        if (rnd() < 0.4) { total += 1 + Math.floor(rnd() * 3); await ingestCuratedPuzzles(curatedDir({ expert: lines() })) }
        if (page.exhausted && rnd() < 0.3) break
      }
      // drain whatever is left (the expert store accumulates every trial's puzzles, so this can be long)
      for (let i = 0; i < 500; i++) {
        const page = (await batch(p.token, { difficulty: 'expert', limit: 50, cursor, since })).body as Page
        got.push(...page.puzzles.map(x => x.shareCode)); cursor = page.cursor; since = page.since
        if (page.exhausted) break
      }
      const mine = got.filter(c => c.startsWith(prefix))
      expect(new Set(mine).size, `trial ${trial}: a puzzle was offered twice`).toBe(mine.length)
      expect(mine.sort(), `trial ${trial}: a puzzle was never offered`).toEqual(lines().sort())
    }
  }, 60_000)

  it('validates its inputs and requires auth', async () => {
    const p = await createGuest()
    expect((await batch(p.token, { difficulty: 'nope' })).status).toBe(400)
    expect((await batch(p.token, { difficulty: 'hard', limit: 0 })).status).toBe(400)
    expect((await batch(p.token, { difficulty: 'hard', limit: 51 })).status).toBe(400)
    expect((await batch(p.token, { difficulty: 'hard', cursor: -2 })).status).toBe(400)
    expect((await batch(p.token, { difficulty: 'hard', cursor: 'abc' })).status).toBe(400)
    expect((await batch(p.token, { difficulty: 'hard', since: -1 })).status).toBe(400)
    expect((await request(app).get('/api/puzzle-catalog/batch').query({ difficulty: 'hard' })).status).toBe(401)
  })
})
