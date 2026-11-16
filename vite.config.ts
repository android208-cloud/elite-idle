import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    // Разрешаем любой хост: dev-сервер запускается и в песочнице, и в превью-окружении
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
  build: {
    // Автономный HTML (tools/make-standalone.mjs) вставляет бандл в
    // <script> без соседних файлов. Поэтому:
    //  - iife вместо es, чтобы не было внешних import;
    //  - один файл без хэша в имени;
    //  - css отдельным файлом, его вставляет тот же сборщик.
    // Для обычной сборки в dist это ничего не ломает.
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
