import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts'],
    // 不依赖浏览器/React 环境，纯逻辑单测跑得快
  },
  resolve: {
    alias: {
      '@': root,
    },
  },
});
