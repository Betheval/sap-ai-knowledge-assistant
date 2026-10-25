/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // Downloaded corpus (ingestion cache) is not part of the project
  modulePathIgnorePatterns: ['<rootDir>/.cache/'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // CAP keeps internal handles open after the server shuts down
  forceExit: true,
}
