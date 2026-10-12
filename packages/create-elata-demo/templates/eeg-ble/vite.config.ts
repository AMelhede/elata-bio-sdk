import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [react(), wasm()],
  optimizeDeps: {
    exclude: ['@elata-biosciences/eeg-web', '@elata-biosciences/eeg-web-ble'],
  },
});
