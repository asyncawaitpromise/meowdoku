# Accounts, Progress & Multiplayer — Feature Plan

Rough draft of features under consideration for user accounts, cross-device progress, social features, and multiplayer modes. This captures the direction settled on so far, not a final spec.

## Features under consideration

- An anonymous session is created the first time someone uses the app.
- Progress and generated/saved puzzles persist for that session, even if the user resets their in-progress state.
- Friend links between users.
- Friends can see each other's progress.
- An online/presence indicator for friends.
- Puzzle sharing between friends.
- Head-to-head mode: two players race the same puzzle.
- Co-op mode: two players solve one shared puzzle together.
- Account promotion: an anonymous session can be upgraded to a real account (email/password or OAuth), so progress carries across devices (PC, mobile, etc.) after logging in.

## Current state (what already exists)

- The server is Express + `better-sqlite3`, already scaffolded with `routes/auth.mjs`: JWT-based email/password signup and signin, plus OAuth for Google, GitHub, and Discord. The `users` and `oauth_accounts` tables already exist in `db.mjs`.
- Real-time push already exists: `routes/sse.mjs` plus `events.mjs` provide a per-user Server-Sent Events channel (an `appEvents` emitter keyed by `update:${userId}`), currently used for generic notifications.
- Puzzle generation happens entirely client-side, in `client/src/lib/levelGen/`. The server does no puzzle-generation work — its CPU load is limited to normal request handling and small SQLite reads/writes.

## Anonymous sessions & account promotion

- `users.email` is currently `UNIQUE NOT NULL`, so anonymous users need either a nullable email plus an `is_anon` flag, or a separate guest concept. This should be designed before other features are built on top of user IDs, so saved progress doesn't need a migration step later.
- "Promotion" means attaching email/password or OAuth credentials to the *same* anonymous user row, not creating a second account and merging the two afterward. Attaching to the existing row avoids a merge step once a user already has real progress attached to their anonymous ID.
- Worth designing this schema early, even if the promotion flow itself ships later — retrofitting a merge path after users have accumulated progress is painful.

## Progress & saved puzzles

- Store progress and saved/generated puzzles in their own table(s) keyed by user ID, separate from whatever represents "current in-progress state." That way resetting current progress doesn't touch saved history.
- Otherwise standard CRUD; no new infrastructure needed.

## Friends, presence, and sharing

- Friend links, friends seeing each other's progress, and puzzle sharing are standard relational data and queries.
- The online indicator and related notifications can reuse the existing per-user SSE channel rather than needing new infrastructure.

## Multiplayer

Both modes turn out to be lower-stakes than "real-time multiplayer" usually implies:

### Head-to-head

Not a shared board. Each player solves their own board, generated from the same puzzle seed so both face identical difficulty. What's shared is a small stream of meta-events — lives lost, cats found, X's placed — broadcast to the opponent so their HUD can update live.

### Co-op

One shared board, but placing a cat is idempotent: it doesn't matter *who* placed it, only that it was placed. That removes the need for conflict resolution, operation ordering, or CRDTs on the shared state — a placement can just be applied whenever it arrives.

### Why HTTP + SSE instead of WebSockets

- Neither mode needs low-latency bidirectional messaging — moves happen every few seconds, not frame by frame.
- The per-connection resource cost of SSE vs. WebSockets is roughly the same order of magnitude. The deciding factor here is code and infrastructure surface area, not overhead: a normal HTTP POST for client-to-server moves, combined with the SSE channel that already exists for server-to-client fan-out, reuses infrastructure that's already built instead of adding a new dependency (`ws` or `socket.io`) and a new connection lifecycle to maintain.
- Planned shape: the client sends a move via a normal POST endpoint; the server validates it, updates the shared game-session state (one row per match), and fans the delta out via `appEvents.emit` to the other participant's existing SSE connection.
- Reconnect handling: `EventSource` auto-reconnects, but silently drops whatever happened while disconnected. Rule to build in: on every (re)connect, first `GET` the current authoritative game state, then subscribe to SSE for future deltas — never rely on the stream alone being gap-free.
- If a genuine need for low-latency bidirectional messaging shows up later, the app is deployed via CapRover, which has a per-app "Websocket Support" toggle that adds the header passthrough WebSockets need. Adding sockets later would be a deploy-config change, not an architecture change.

## Resource footprint

- The existing stack (Express + `better-sqlite3` + SSE) is inexpensive to run: idle memory in the tens of MB, no server-side CPU-heavy workload since generation is client-side, and SQLite scales comfortably into the GB range on a single file.
- Concurrent SSE connections cost low tens of MB even at hundreds of connections, dominated by kernel socket buffers rather than application memory.

## Suggested build order

1. Anonymous session, with the data model designed for promotion up front (even if the promotion flow ships later).
2. Progress and saved-puzzle persistence.
3. Friends, presence, and sharing, built on top of the existing SSE channel.
4. Head-to-head and co-op multiplayer — a game-session table plus an event schema, reusing SSE rather than adding WebSockets.
