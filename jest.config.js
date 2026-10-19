/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // CAP keeps internal handles open after the server shuts down
  forceExit: true,
}
