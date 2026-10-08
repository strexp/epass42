import { defineNuxtConfig } from 'nuxt/config'

// pkd42 frontend (Nuxt 4 + Naive UI).  English-only i18n; all copy goes through
// i18n keys (never hard-coded).
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  // Client-rendered SPA: the admin UI does not need SSR and this avoids
  // Naive UI css-render SSR plumbing.
  ssr: false,

  modules: ['@pinia/nuxt', '@nuxtjs/i18n', '@nuxtjs/color-mode'],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // Empty means same-origin; set NUXT_PUBLIC_API_BASE for a split deploy.
      apiBase: '',
    },
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [{ code: 'en', language: 'en', name: 'English' }],
    vueI18n: './i18n.config.ts',
  },

  colorMode: {
    preference: 'system',
    fallback: 'light',
    classSuffix: '',
    storageKey: 'pkd42-color-mode',
  },

  build: {
    transpile: ['naive-ui', 'vueuc', '@css-render/vue3-ssr', '@juggle/resize-observer'],
  },

  nitro: {
    devProxy: {
      '/api': { target: 'http://127.0.0.1:3000/api', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:3000/auth', changeOrigin: true },
      '/csca': { target: 'http://127.0.0.1:3000/csca', changeOrigin: true },
      '/dsc': { target: 'http://127.0.0.1:3000/dsc', changeOrigin: true },
      '/pkd': { target: 'http://127.0.0.1:3000/pkd', changeOrigin: true },
    },
  },

  // The backend defaults to 127.0.0.1:3000; run the dev UI on 3001 so the two
  // never contend for the port.
  devServer: { port: 3001 },

  app: {
    head: {
      title: 'pkd42',
      htmlAttrs: { lang: 'en' },
    },
  },

  typescript: { strict: true },
})
