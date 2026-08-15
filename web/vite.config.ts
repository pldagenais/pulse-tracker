import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Build identity, baked into the bundle AND emitted as /build.json. An open
// tab compares the two to learn that a new build shipped — nothing else tells
// it: assets are content-hashed but index.html is cached, and vite:preloadError
// only fires if the user happens to navigate to a not-yet-loaded route.
const BUILD_ID = `${Date.now().toString(36)}`;
const buildStamp = (): Plugin => ({
  name: 'pulse-build-stamp',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ buildId: BUILD_ID }) });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), buildStamp()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5600,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5599',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
