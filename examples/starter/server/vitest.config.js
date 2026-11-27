import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'summary'],
      include: ['middleware/**/*.js', 'services/**/*.js', '../packages/auth-kit/src/**/*.js'],
    },
  },
});
