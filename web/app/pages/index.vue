<script setup lang="ts">
// Calls the Nitro server route at /api/hello (server/api/hello.ts).
// This runs on the server during SSR and can be re-run on demand.
const { data, status, refresh } = await useFetch('/api/hello')
</script>

<template>
  <div>
    <UPageHero
      title="renovate-log-parser"
      description="Demo web UI served by the CLI's `web` command. This page is rendered by Nuxt and fetches live data from the built-in Nitro server."
      :links="[{
        label: 'Nuxt UI docs',
        to: 'https://ui.nuxt.com',
        target: '_blank',
        trailingIcon: 'i-lucide-arrow-right',
        size: 'xl'
      }]"
    />

    <UPageSection
      title="Server functionality"
      description="The card below is populated from GET /api/hello, a Nitro server route bundled into the app."
    >
      <UCard class="max-w-xl mx-auto">
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">
              GET /api/hello
            </h3>
            <UBadge
              :color="status === 'success' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ status }}
            </UBadge>
          </div>
        </template>

        <div class="space-y-2">
          <p class="text-muted text-sm">
            Message
          </p>
          <p class="font-medium">
            {{ data?.message }}
          </p>

          <p class="text-muted text-sm pt-2">
            Server timestamp
          </p>
          <p class="font-mono text-sm">
            {{ data?.timestamp }}
          </p>
        </div>

        <template #footer>
          <UButton
            label="Refresh from server"
            icon="i-lucide-refresh-cw"
            :loading="status === 'pending'"
            @click="refresh()"
          />
        </template>
      </UCard>
    </UPageSection>
  </div>
</template>
