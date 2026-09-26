// Builds the playable demo: the real app with an in-browser backend, as one HTML file.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('1') },
  resolve: { alias: { 'node:crypto': fileURLToPath(new URL('./web/src/demo/crypto-shim.ts', import.meta.url)) } },
  build: { outDir: '../dist/demo', emptyOutDir: true, assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
