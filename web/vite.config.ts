/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// relative base: works on GitHub Pages under any subpath
export default defineConfig({
  base: './',
  plugins: [react()],
  // scenarios compute the parabolic equation (1–2 s per grid)
  test: { testTimeout: 60_000 },
});
