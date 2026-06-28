# Meowdoku

A cat-themed logic puzzle game based on the **Star Battle** puzzle type, built as a full-stack web app.

## The puzzle

Place exactly **one cat per row, one cat per column, and one cat per colored region**. No two cats may be adjacent — including diagonally.

The board is 10×10 with 10 colored regions. Every puzzle has a unique solution reachable through logical deduction alone, with no guessing required.

### Same puzzle, many names

This puzzle type has been independently invented and branded several times:

| Name | Publisher |
|------|-----------|
| **Star Battle** | Competition name (Hans Eendebak, 2003 World Puzzle Championship) |
| **Two Not Touch** | New York Times |
| **Queens** | LinkedIn |
| **Parks** | Android app store |
| **Starstruck** | Netflix |

Meowdoku is the cat-themed version. The rules are identical across all variants.

---

## Tech stack

| Layer | Stack |
|-------|-------|
| Backend | Express 5, better-sqlite3 (WAL mode), Server-Sent Events |
| Frontend | Vite 6, React 18, TypeScript, Tailwind CSS v3, DaisyUI v4 |
| Auth | JWT (30-day), bcrypt, OAuth (GitHub / Google / Discord) |
| State | Zustand v5 with persist middleware |
| Routing | react-router-dom v7 |
| Package manager | pnpm workspaces (root + `client/`) |
| Deployment | CapRover via GitHub Actions |
| Containers | Docker multi-stage build → GHCR |

---

## Puzzle solving

All puzzle logic lives in `client/src/lib/levelGen.ts`. The solver uses five constraint-propagation strategies applied iteratively until no more deductions can be made. Puzzles that require guessing are rejected at generation time.

### Strategies (in order of application)

**1. Singleton propagation**
If a region has only one candidate cell left, the cat must go there. Immediately eliminate that row, column, and all 8 adjacent cells from every other region's candidates.

**2. Naked subsets** (generalised, size 2…N−1)
If k regions' combined candidates span exactly k rows (or columns), no other region can have a candidate in those rows/cols. Handles pairs, triples, quads, and larger.

**3. Hidden subsets** (generalised, size 2…N−1)
If k rows (or columns) contain candidates from exactly k regions, those regions must stay within those rows/cols — eliminate their candidates elsewhere. Also handles pairs through larger sets.

**4. Trap 2×2**
If a region's remaining candidates all fit inside a 2×2 bounding box, any cat placed there will block the entire box via its 8-neighbour halo. Eliminate other regions' candidates inside that box.

**5. Region crowding**
If placing a cat at cell X for region A would leave some other region B with zero surviving candidates (B's entire candidate set falls within X's halo), then X is impossible for A — eliminate it.

Strategies are applied in order. Any change at strategy k restarts from strategy 1. The solver is deterministic and never backtracks.

### Hint engine

`getHint()` mirrors the solver exactly but tracks the *first* new deduction that the player hasn't already applied, and returns a plain-English explanation with color-coded region references.

---

## Puzzle generation

Puzzle generation also lives in `client/src/lib/levelGen.ts`. The goal is producing puzzles with **natural-looking, varied region shapes** that are **logically solvable** (the solver above can fully solve them without guessing).

### Pipeline

**Phase 1 — star placement**
Use backtracking to place 10 cats: one per row, one per column, no two adjacent. This is a constrained N-Queens variant and produces a valid solution instantly.

**Phase 2 — Voronoi region seeding**
Grow 10 regions simultaneously via randomised BFS from the 10 cat positions. Each cell is claimed by the nearest seed (ties broken randomly), producing organic blob-shaped regions of roughly equal size (~10 cells each). These look natural but are not yet logically solvable — with 10 candidates per region the solver can make no deductions.

**Phase 3 — Simulated annealing refinement**
Refine regions via simulated annealing (SA): at each step, pick a random boundary cell and propose moving it to an adjacent region. Accept the move if it reduces the *span score* (total distinct rows + columns across all regions), or accept it with Boltzmann probability `exp(-Δ/T)` if it worsens the score — allowing escape from local minima. Temperature T starts at 6.0 and cools by factor 0.998 per iteration (minimum 0.05). After 3 000 steps the best configuration seen is returned.

Rules throughout:
- Never move a cat's seed cell
- Always verify the source region stays 4-connected after removal
- `canSolveLogically` is called once per attempt (after SA converges), not inside the inner loop

This produces a ~4% solve rate per attempt. With 200 attempts the probability that none succeeds is < 0.03%; expected generation time ≈ 150 ms.

**Phase 4 — engineered fallback**
If SA doesn't produce a logically solvable puzzle in 200 attempts (happens < 0.03% of the time), fall back to a structured region layout: 5 singleton regions (1 cell each, immediately forced), 4 small regions (2 cells each, grown in a random 4-connected direction), and 1 large BFS region filling the remainder. This approach gives ~59% solve rate per attempt; 200 tries makes failure probability < 10⁻⁴⁰.

### Why simulated annealing

Pure Voronoi regions have a ~0% logical solve rate — each region spans too many rows and columns for any deduction strategy to fire. The engineered approach (singletons + smalls) is reliable but produces visually predictable puzzles — every puzzle has the same structural fingerprint (4–5 tiny isolated regions, a few 2-cell pairs, one giant blob).

A greedy hill-climb (only accepting equal-or-better moves) gets stuck in local minima around span score 38–55 and cannot improve further; the SA's ability to accept temporarily worse moves lets it escape those minima and find the configurations (~4%) that happen to be logically solvable.

SA on Voronoi produces regions that:
- Look natural (no obvious singletons or rigid structure)
- Have varied sizes and shapes
- Reach logical solvability through stochastic boundary refinement

The engineered fallback is retained as a safety net for the (extremely rare) cases where SA exhausts its budget.

### Seeded generation

`generateLevel(levelNum, puzzleSeed)` is deterministic: given the same inputs it always returns the same puzzle. Level number and seed are mixed into a base integer that drives a mulberry32 PRNG for all random decisions.

---

## Project structure

```
.
├── client/                        # Vite + React frontend (pnpm workspace)
│   └── src/
│       ├── lib/
│       │   └── levelGen.ts        # Puzzle generation, solver, hint engine
│       ├── routes/
│       │   ├── Game.tsx           # Main game board
│       │   ├── LevelSelect.tsx
│       │   └── ...
│       ├── store/
│       │   └── gameStore.ts       # Zustand game state
│       └── services/
│           └── apiClient.ts       # Typed fetch wrapper
├── routes/
│   ├── auth.mjs                   # Signup, signin, OAuth, /me, /profile
│   └── sse.mjs                    # GET /api/sse/stream — per-user event stream
├── middlewares/
│   ├── requireAuth.mjs
│   └── requireAdmin.mjs
├── scripts/
│   ├── localDev.mjs               # Seeds dev user, auto-generates JWT_SECRET
│   └── postinstall.mjs            # Rebuilds better-sqlite3 on Android/Termux
├── config/
│   └── admins.json                # Static admin email allowlist
├── db.mjs                         # SQLite schema + connection singleton
├── events.mjs                     # EventEmitter singleton for SSE
├── index.mjs                      # Express server entry point
└── Dockerfile                     # Multi-stage: client build → production server
```

---

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Copy and fill in secrets
cp .env.example .env.local

# 3. Start backend + frontend concurrently
pnpm dev
# Backend:  http://localhost:8080
# Frontend: http://localhost:5173 (proxies /api to :8080)
```

A dev user (`dev@local`) is seeded automatically with a generated `JWT_SECRET`.

---

## Deployment

### CI deploy (recommended)

Push to `master` → GitHub Actions builds the Docker image → pushes to GHCR → deploys to CapRover automatically.

```bash
bash scripts/scaffold.sh        # one-time CapRover app setup
bash scripts/sync-secrets.sh    # push .env.local → GitHub Secrets + CapRover
git push origin master
```

### Manual tar deploy

```bash
npm install -g caprover
caprover login
bash scripts/deploy-tar.sh
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Random string, min 32 chars |
| `PORT` | Server port (default 8080) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google OAuth credentials |
| `GITHUB_CLIENT_ID` / `_SECRET` | GitHub OAuth credentials |
| `DISCORD_CLIENT_ID` / `_SECRET` | Discord OAuth credentials |
| `OAUTH_CALLBACK_BASE` | Public base URL (e.g. `https://myapp.example.com`) |
| `CAPROVER_URL` | CapRover dashboard URL |
| `CAPROVER_PASSWORD` | CapRover admin password |
| `CAPROVER_APP` | App name in CapRover |

## License

MIT
