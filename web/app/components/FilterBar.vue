<script setup lang="ts">
/**
 * FilterBar — the filter toolbar. Combines the free-text search box,
 * the two static dropdowns (levels / repositories), the
 * dynamic pills, and a "Clear" affordance. All controls mutate the shared
 * {@link useFilters} singleton; the page watches its serialized value and
 * refetches (debounced).
 */
const filters = useFilters()
const log = useLog()
const { searchPattern, searchField } = filters

/**
 * Fields available as the search target: "Raw search" (whole line, any key or
 * value) first, then `msg`, then the open log's other root keys.
 */
const searchFields = ref<string[]>([RAW_SEARCH, 'msg'])

async function fetchSearchFields(): Promise<void> {
  if (!log.info.value) {
    searchFields.value = [RAW_SEARCH, 'msg']
    return
  }
  try {
    const all = await apiFetch<string[]>('/api/fields')
    searchFields.value = [RAW_SEARCH, 'msg', ...all.filter(f => f !== 'msg')]
  } catch {
    searchFields.value = [RAW_SEARCH, 'msg']
  }
}

watch(() => log.info.value?.md5, fetchSearchFields, { immediate: true })

const hasActive = computed(() => filters.activeCount.value > 0)

/** Placeholder reflecting the selected search target. */
const searchPlaceholder = computed(() =>
  searchField.value === RAW_SEARCH
    ? 'Search entire line (use * for wildcards)…'
    : `Search ${searchField.value} (use * for wildcards)…`
)
</script>

<template>
  <div class="shrink-0 border-b border-default px-4 py-2 flex flex-col gap-2">
    <div class="flex items-center gap-2 flex-wrap">
      <!-- Free-text search: a field-scoped LIKE. The attached select on the
           left chooses which JSON key the search box matches against (msg by
           default); the box itself is a case-insensitive `*`-wildcard search. -->
      <UFieldGroup size="sm">
        <UTooltip text="Field the search matches against">
          <USelectMenu
            v-model="searchField"
            :items="searchFields"
            color="neutral"
            variant="subtle"
            icon="i-lucide-at-sign"
            class="w-40"
            aria-label="Field to search in"
            :search-input="{ placeholder: 'Field…' }"
          />
        </UTooltip>
        <UInput
          v-model="searchPattern"
          icon="i-lucide-search"
          class="w-64"
          :placeholder="searchPlaceholder"
          :ui="{ trailing: 'pe-1' }"
        >
          <template
            v-if="searchPattern.length > 0"
            #trailing
          >
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="link"
              size="xs"
              aria-label="Clear search"
              @click="filters.clearSearch()"
            />
          </template>
        </UInput>
      </UFieldGroup>

      <LevelFilterMenu />
      <RepositoryFilterMenu />

      <UButton
        v-if="hasActive"
        icon="i-lucide-filter-x"
        label="Clear filters"
        color="neutral"
        variant="ghost"
        size="sm"
        class="ml-auto"
        @click="filters.clearAll()"
      />
    </div>

    <FilterPills />
  </div>
</template>
