<script setup lang="ts">
/**
 * RepositoryFilterMenu — the static "repositories" dropdown.
 * Lists the distinct `repository` values in the current log (verbatim,
 * incl. git-URL sub-repos) as checkboxes, plus an include/exclude mode switch
 * and a "Repository-independent" pseudo-entry for entries with no `repository`.
 * Maps to a single `inSet` filter server-side.
 */
const filters = useFilters()
const log = useLog()

const repositories = ref<string[]>([])
const loading = ref(false)
const search = ref('')

/** (Re)fetch the distinct repositories for the current log. */
async function fetchRepositories(): Promise<void> {
  if (!log.info.value) {
    repositories.value = []
    return
  }
  loading.value = true
  try {
    repositories.value = await $fetch<string[]>('/api/repositories')
  } catch {
    repositories.value = []
  } finally {
    loading.value = false
  }
}

watch(() => log.info.value?.md5, fetchRepositories, { immediate: true })

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const matches = q ? repositories.value.filter(r => r.toLowerCase().includes(q)) : repositories.value
  return sortSelectedFirst(matches, repo => filters.repoValues.value.includes(repo))
})

const selectedCount = computed(
  () => filters.repoValues.value.length + (filters.repoIndependent.value ? 1 : 0)
)
</script>

<template>
  <UPopover :content="{ align: 'start' }">
    <UButton
      icon="i-lucide-folder-git-2"
      color="neutral"
      variant="subtle"
      size="sm"
      trailing-icon="i-lucide-chevron-down"
    >
      Repositories
      <UBadge
        v-if="selectedCount > 0"
        color="primary"
        variant="solid"
        size="sm"
      >
        {{ selectedCount }}
      </UBadge>
    </UButton>

    <template #content>
      <div class="p-2 w-80 flex flex-col gap-2">
        <!-- Include / exclude mode. -->
        <div class="flex items-center justify-between gap-2">
          <UFieldGroup size="xs">
            <UButton
              label="Include"
              :color="filters.repoMode.value === 'include' ? 'primary' : 'neutral'"
              :variant="filters.repoMode.value === 'include' ? 'solid' : 'subtle'"
              @click="filters.setRepoMode('include')"
            />
            <UButton
              label="Exclude"
              :color="filters.repoMode.value === 'exclude' ? 'primary' : 'neutral'"
              :variant="filters.repoMode.value === 'exclude' ? 'solid' : 'subtle'"
              @click="filters.setRepoMode('exclude')"
            />
          </UFieldGroup>
          <UButton
            v-if="selectedCount > 0"
            label="Clear"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="filters.clearRepos()"
          />
        </div>

        <UInput
          v-model="search"
          icon="i-lucide-search"
          size="sm"
          placeholder="Filter repositories…"
        />

        <!-- Repository-independent pseudo-entry. -->
        <label class="flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated/50 cursor-pointer">
          <UCheckbox
            :model-value="filters.repoIndependent.value"
            @update:model-value="filters.setRepoIndependent(!filters.repoIndependent.value)"
          />
          <span class="text-sm italic text-muted">Repository-independent</span>
        </label>

        <div class="max-h-64 overflow-auto flex flex-col gap-0.5 border-t border-default pt-1">
          <p
            v-if="loading"
            class="text-xs text-dimmed px-1 py-2"
          >
            Loading…
          </p>
          <p
            v-else-if="filtered.length === 0"
            class="text-xs text-dimmed px-1 py-2"
          >
            {{ repositories.length === 0 ? 'No repositories.' : 'No matches.' }}
          </p>
          <label
            v-for="repo in filtered"
            :key="repo"
            class="flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated/50 cursor-pointer"
          >
            <UCheckbox
              :model-value="filters.repoValues.value.includes(repo)"
              @update:model-value="filters.toggleRepo(repo)"
            />
            <span
              class="text-xs font-mono truncate"
              :title="repo"
            >{{ repo }}</span>
          </label>
        </div>
      </div>
    </template>
  </UPopover>
</template>
