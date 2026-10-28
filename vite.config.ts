import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-maplibre': ['maplibre-gl'],
          'vendor-turf-milsymbol': ['@turf/turf', 'milsymbol'],
          'vendor-react': ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
});
