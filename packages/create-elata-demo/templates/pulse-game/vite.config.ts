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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
      },
    },
  },
});
