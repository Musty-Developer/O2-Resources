import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
        signup: resolve(__dirname, 'signup.html'),
        reset: resolve(__dirname, 'reset-password.html'),
        pastpapers: resolve(__dirname, 'past-papers.html'),
        dashboard: resolve(__dirname, 'dashboard.html')
      }
    }
  }
});