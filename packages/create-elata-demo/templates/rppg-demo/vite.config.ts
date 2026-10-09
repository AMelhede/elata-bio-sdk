import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  // Top-level await is native from es2022; vite-plugin-top-level-await is not needed, and its
  // production build fails with current @swc/core ("missing field `type`").
  build: { target: 'es2022' },
  plugins: [react(), wasm()],
  optimizeDeps: {
    exclude: ['@elata-biosciences/rppg-web'],
  },
});
