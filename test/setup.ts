import { expect } from 'vitest'

// Lift the rate limits to effectively-unlimited in tests: the integration
// suites legitimately hammer /guest, /matches, /events etc., and the limiter
// middleware reads RATE_LIMIT_SCALE at import time (after this setup file runs,
// before any test file's own imports).
process.env.RATE_LIMIT_SCALE = '100000'

expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor} - ${ceiling}`
          : `expected ${received} to be within range ${floor} - ${ceiling}`,
    }
  },
  toBeOneOf(received: unknown, values: unknown[]) {
    const pass = values.includes(received)
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be one of ${JSON.stringify(values)}`
          : `expected ${received} to be one of ${JSON.stringify(values)}`,
    }
  },
})