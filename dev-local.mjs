// Entry point for local development with mock data.
// Usage: pnpm dev:local
// Sets LOCAL_DEV=true so index.mjs runs the dev setup (seed user, auto JWT).
process.env.LOCAL_DEV = 'true';
await import('./index.mjs');
