import { EventEmitter } from 'events';

// Singleton event bus — used to push SSE updates from background workers to
// open client connections without coupling modules together.
//
// Usage:
//   import appEvents from './events.mjs';
//   appEvents.emit('update:userId', { type: 'refresh', data: {} });
//
//   // In a route handler:
//   appEvents.on('update:userId', handler);
//   appEvents.off('update:userId', handler);

const appEvents = new EventEmitter();
appEvents.setMaxListeners(0); // no limit — one listener per active SSE connection

export default appEvents;
