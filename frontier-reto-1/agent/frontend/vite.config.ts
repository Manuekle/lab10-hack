import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {textOnlyReactDom} from './scripts/text-only-react-dom.mjs';

export default defineConfig({
  plugins: [textOnlyReactDom(), react(), tailwindcss()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  build: {
    target: 'es2022', cssMinify: true, modulePreload: false,
    rollupOptions: {output: {inlineDynamicImports: true}},
  },
});
