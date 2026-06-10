// tests/jest.mocks.js
// Global mocks for ESM-only packages that Jest can't transform.
// Loaded via setupFilesAfterEnv so jest.mock() is available.

jest.mock('otplib', () => ({
  authenticator: {
    generateSecret: () => 'MOCKSECRETAAAAAAAAAAAAAAAAAAAAAA',
    keyuri: () => 'otpauth://totp/mock',
    verify: () => true,
  },
}));

jest.mock('qrcode', () => ({
  toDataURL: async () => 'data:image/png;base64,mock',
}));
