/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  clearMocks: true,
  // Integration tests (escrow/mutex) pull in notificationService -> fcmService, which
  // initializes the Firebase Admin SDK's persistent gRPC channel at import time — that channel
  // has no test-scoped teardown hook, so it keeps the event loop alive after all tests finish.
  // Redis connections are explicitly closed per-file, but forceExit covers this remaining case.
  forceExit: true,
};
