import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'voxshot-fixed': '/workspaces/voxshot-fixed/dist/index.js'
    }
  },
  server: {
    host: '0.0.0.0',
    port: 8091,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, max-age=0'
    },
    fs: {
      allow: ['/workspaces']
    }
  }
});
