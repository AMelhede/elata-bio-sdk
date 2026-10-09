import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  optimizeDeps: {
    exclude: ['@elata-biosciences/rppg-web'],
  },
  build: {
    // Top-level await is native from es2022; vite-plugin-top-level-await is not needed, and its
    // production build fails with current @swc/core ("missing field `type`").
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
      },
    },
  },
});
