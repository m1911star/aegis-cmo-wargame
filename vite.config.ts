import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8081,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'vendor-maplibre';
          if (id.includes('node_modules/milsymbol')) return 'vendor-milsymbol';
          if (id.includes('node_modules/@turf')) return 'vendor-turf';
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/zustand') ||
            id.includes('node_modules/lucide-react')
          ) {
            return 'vendor-react';
          }
          if (id.includes('/src/scenarios/') || id.includes('/src/db/')) {
            return 'wargame-data';
          }
          return undefined;
        },
      },
    },
  },
});
