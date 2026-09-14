import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'voxshot-fixed': '/workspaces/voxshot-fixed/dist/index.js'
    }
  },
  server: {
    host: '0.0.0.0',
    port: 8080,
    strictPort: true,
    fs: {
      allow: ['/workspaces']
    }
  }
});
