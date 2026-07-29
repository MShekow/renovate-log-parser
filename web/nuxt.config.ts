// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

// The shared core (Parser, QueryBuilder, filter model, …) lives at ../src/core.
// The backend consumes it directly (it is part of the same TypeScript project);
// here it is exposed to the client bundle via the `renovate-core` alias, so the
// bits the UI needs (level metadata, the Filter types) are compiled into the
// static SPA at build time — one source of truth, no duplicate copy shipped.
const coreDir = fileURLToPath(new URL('../src/core', import.meta.url))

// The Express API server during `nuxt dev` (see `npm run dev:api`).
const devApiTarget = process.env.DEV_API_URL || 'http://localhost:3001'

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  // Pure client-side app: `nuxt generate` emits a static shell + assets into
  // .output/public, which the Express server serves. No SSR, no Nitro runtime.
  ssr: false,

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  alias: {
    'renovate-core': coreDir
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    // Dev only: `nuxt dev` serves the app itself, so forward API calls to the
    // Express server. In production nothing of Nitro is used — `nuxt generate`
    // produces static files only.
    devProxy: {
      '/api': {
        target: `${devApiTarget}/api`,
        changeOrigin: true
      }
    }
  },

  // Allow Vite to read the shared core that sits outside web/ (dev mode).
  vite: {
    server: {
      fs: {
        allow: ['..']
      }
    }
  },

  typescript: {
    typeCheck: true
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
