// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

// The shared core (Parser, QueryBuilder, filter model, …) lives at
// ../src/core and is consumed natively by the CLI (tsc). Here it is exposed to
// the Nitro server via the `renovate-core` alias so it gets inlined into web/.output at
// build time — one source of truth, no duplicate copy shipped (plan Q14/Q15).
const coreDir = fileURLToPath(new URL('../src/core', import.meta.url))

export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  alias: {
    'renovate-core': coreDir
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    // Nitro bundles the server separately from Vite, so it needs the alias too.
    // `node:sqlite` (used by the Parser) is a Node builtin and is externalized
    // automatically by the node-server preset.
    alias: {
      'renovate-core': coreDir
    }
  },

  // Allow Vite/Nitro to read the shared core that sits outside web/ (dev mode).
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
