import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy chỉ áp dụng khi chạy `npm run dev`; bản build không chứa địa chỉ này.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: process.env.DEV_SERVER_URL ?? 'http://127.0.0.1:3001', ws: true } },
  },
  build: { chunkSizeWarningLimit: 1400 },
  worker: { format: 'es' },
});
