import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'happy-dom',
  setupFiles: ['./rstest.setup.ts'],
});
