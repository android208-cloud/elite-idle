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
});
