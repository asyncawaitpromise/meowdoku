// Shared SSE connection for server-pushed app events.
//
// A module-level singleton (not a hook) so every consumer — Friends presence,
// future multiplayer, etc. — shares one EventSource instead of each opening
// its own connection to the same stream.

type Handler = (data: Record<string, unknown>) => void

let source: EventSource | null = null
let currentToken: string | null = null
const handlers = new Map<string, Set<Handler>>()
const reconnectHandlers = new Set<() => void>()
let seenFirstOpen = false

function dispatch(type: string, data: Record<string, unknown>) {
  handlers.get(type)?.forEach(handler => handler(data))
}

function connect(token: string) {
  source = new EventSource(`/api/sse/stream?token=${encodeURIComponent(token)}`)
  seenFirstOpen = false
  // EventSource fires 'open' both on the initial connection and on every
  // automatic reconnect. Consumers (multiplayer, presence) need to re-fetch
  // authoritative state after a reconnect, because the stream silently drops
  // whatever happened while disconnected — but an initial mount already loads
  // state itself, so only subsequent opens are worth notifying about.
  source.addEventListener('open', () => {
    if (seenFirstOpen) reconnectHandlers.forEach(handler => handler())
    seenFirstOpen = true
  })
  source.addEventListener('update', (e) => {
    const data = JSON.parse((e as MessageEvent).data) as Record<string, unknown>
    if (typeof data.type === 'string') dispatch(data.type, data)
  })
}

export function setLiveEventsToken(token: string | null) {
  if (token === currentToken) return
  currentToken = token
  source?.close()
  source = null
  if (token) connect(token)
}

export function subscribeToAppEvent(type: string, handler: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set())
  handlers.get(type)!.add(handler)
  return () => handlers.get(type)?.delete(handler)
}

// Called after every SSE reconnection, so a consumer can re-fetch authoritative
// server state instead of trusting the stream to be gap-free.
export function subscribeToReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler)
  return () => reconnectHandlers.delete(handler)
}
