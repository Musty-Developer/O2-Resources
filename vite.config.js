import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // NEW: The local proxy to bypass CORS while testing on localhost
  server: {
    proxy: {
      '/supabase-storage': {
        target: 'https://ydhecoqcckzgibwdcnxm.supabase.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/supabase-storage/, '/storage/v1/object/public/the_archive')
      }
    }
  },
  // EXISTING: Your multi-page application build targets
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        signup: resolve(__dirname, 'signup.html'),
        reset: resolve(__dirname, 'reset-password.html'),
        onboarding: resolve(__dirname, 'onboarding.html'),
        pastpapers: resolve(__dirname, 'past-papers.html'),
        dashboard: resolve(__dirname, 'dashboard.html')
      }
    }
  }
});