import { expect } from 'vitest'

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