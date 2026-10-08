import { defineNuxtConfig } from 'nuxt/config'

// pkd42 frontend (Nuxt 4 + Naive UI).  English-only i18n; all copy goes through
// i18n keys (never hard-coded).
//
// The API runs on a separate origin in development (backend :3000, frontend
// :3001) and is called cross-origin with credentials; CORS is configured on the
// backend from FRONTEND_URL.  In production set NUXT_PUBLIC_API_BASE (empty for
// same-origin).
const apiBase =
  process.env.NUXT_PUBLIC_API_BASE ??
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: false },
  // Client-rendered SPA (no SSR plumbing for Naive UI, and direct navigation to
  // any route, e.g. /csca, is served by the SPA shell).
  ssr: false,

  modules: ['@pinia/nuxt', '@nuxtjs/i18n', '@nuxtjs/color-mode'],

  // Register components by file name (no directory prefix) so `<FileField>`
  // resolves; names are unique across directories.
  components: [{ path: '~/components', pathPrefix: false }],

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: { apiBase },
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

  // The backend defaults to 127.0.0.1:3000; run the dev UI on 3001 so the two
  // never contend for the port.
  devServer: { port: 3001 },

  app: {
    head: {
      title: 'PKD42',
      htmlAttrs: { lang: 'en' },
    },
  },

  typescript: { strict: true },
})
