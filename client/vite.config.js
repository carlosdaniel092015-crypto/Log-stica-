import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://localhost:3000';
// En Vercel (frontend separado) el socket va directo al backend; basta con definir BACKEND_URL.
const realtime = process.env.VITE_REALTIME_URL || (process.env.VERCEL ? process.env.BACKEND_URL || '' : '');

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_REALTIME_URL': JSON.stringify(realtime.replace(/\/$/, '')) },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
