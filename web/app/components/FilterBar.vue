<script setup lang="ts">
/**
 * FilterBar — the Phase 5b filter toolbar. Combines the free-text search box,
 * the three static dropdowns (levels / repositories / hidden fields), the
 * dynamic pills, and a "Clear" affordance. All controls mutate the shared
 * {@link useFilters} singleton; the page watches its serialized value and
 * refetches (debounced).
 */
const filters = useFilters()
const log = useLog()
const { searchPattern, searchField } = filters

/** Fields available as the search target (msg first, then log root keys). */
const searchFields = ref<string[]>(['msg'])

async function fetchSearchFields(): Promise<void> {
  if (!log.info.value) {
    searchFields.value = ['msg']
    return
  }
  try {
    const all = await $fetch<string[]>('/api/fields')
    searchFields.value = ['msg', ...all.filter(f => f !== 'msg')]
  } catch {
    searchFields.value = ['msg']
  }
}

watch(() => log.info.value?.md5, fetchSearchFields, { immediate: true })

const hasActive = computed(() => filters.activeCount.value > 0)
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
          :placeholder="`Search ${searchField} (use * for wildcards)…`"
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
      <FieldsFilterMenu />

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
