// Shared WebSocket connection for server-pushed app events (and, for coop
// placements, client -> server input too — see sendLiveMessage).
//
// A module-level singleton (not a hook) so every consumer — Friends presence,
// multiplayer, etc. — shares one connection instead of each opening its own
// to the same stream.
//
// Unlike EventSource (the previous transport), a plain WebSocket has no
// built-in auto-reconnect, so that's implemented here with a small backoff.

type Handler = (data: Record<string, unknown>) => void

// A server-side auth failure closes with this code (see routes/ws.mjs) —
// retrying immediately would just spin forever on a token that isn't going
// to become valid on its own; wait for setLiveEventsToken to be called again
// with a fresh one instead.
const AUTH_FAILURE_CLOSE_CODE = 4001
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 10000

let socket: WebSocket | null = null
let currentToken: string | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_MIN_MS
const handlers = new Map<string, Set<Handler>>()
const reconnectHandlers = new Set<() => void>()
let seenFirstOpen = false

function dispatch(type: string, data: Record<string, unknown>) {
  handlers.get(type)?.forEach(handler => handler(data))
}

function wsUrl(token: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`
}

function scheduleReconnect(token: string) {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (currentToken === token) connect(token)
  }, reconnectDelay)
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
}

function connect(token: string) {
  const ws = new WebSocket(wsUrl(token))
  socket = ws

  // Fires both on the initial connection and every reconnect. Consumers
  // (multiplayer, presence) need to re-fetch authoritative state after a
  // reconnect, because the connection silently drops whatever happened while
  // disconnected — but an initial mount already loads state itself, so only
  // subsequent opens are worth notifying about.
  ws.addEventListener('open', () => {
    reconnectDelay = RECONNECT_MIN_MS
    if (seenFirstOpen) reconnectHandlers.forEach(handler => handler())
    seenFirstOpen = true
  })
  ws.addEventListener('message', (e) => {
    const data = JSON.parse(e.data as string) as Record<string, unknown>
    if (typeof data.type === 'string') dispatch(data.type, data)
  })
  ws.addEventListener('close', (e) => {
    if (socket !== ws) return // superseded by a newer connection already
    socket = null
    if (e.code === AUTH_FAILURE_CLOSE_CODE) return
    if (currentToken === token) scheduleReconnect(token)
  })
  ws.addEventListener('error', () => ws.close())
}

export function setLiveEventsToken(token: string | null) {
  if (token === currentToken) return
  currentToken = token
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectDelay = RECONNECT_MIN_MS
  seenFirstOpen = false
  socket?.close()
  socket = null
  if (token) connect(token)
}

export function subscribeToAppEvent(type: string, handler: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)
  return () => handlers.get(type)?.delete(handler)
}

// Called after every reconnection, so a consumer can re-fetch authoritative
// server state instead of trusting the connection to be gap-free.
export function subscribeToReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler)
  return () => reconnectHandlers.delete(handler)
}

// Client -> server messages (currently just coop placements — see
// coopStore.ts). Fire-and-forget: returns whether it was actually sent, so a
// caller can fall back to a REST resync if the socket wasn't open yet.
export function sendLiveMessage(message: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(message))
  return true
}
