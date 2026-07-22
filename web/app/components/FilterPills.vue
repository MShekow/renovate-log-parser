<script setup lang="ts">
/**
 * FilterPills — the row of dynamic filter pills (Phase 5b). Each pill wraps a
 * core filter created by a context-menu action (message / JSON-field) and is
 * rendered by {@link FilterPill}: clicking toggles its `enabled` state (disabled
 * pills stay visible but drop out of the query); the ✕ removes it entirely.
 */
const filters = useFilters()
</script>

<template>
  <div
    v-if="filters.pills.value.length > 0"
    class="flex items-center gap-1.5 flex-wrap"
  >
    <FilterPill
      v-for="pill in filters.pills.value"
      :key="pill.id"
      :pill="pill"
    />
  </div>
</template>
