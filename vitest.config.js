import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // Enables requestAnimationFrame and friends in jsdom
        pretendToBeVisual: true,
      },
    },
  },
});
