<script setup lang="ts">
/**
 * FilterPills — the row of dynamic filter pills (Phase 5b). Each pill wraps a
 * core filter created by a context-menu action (message / JSON-field). Clicking
 * a pill toggles its `enabled` state (disabled pills stay visible but drop out
 * of the query); the ✕ removes it entirely.
 */
const filters = useFilters()
</script>

<template>
  <div
    v-if="filters.pills.value.length > 0"
    class="flex items-center gap-1.5 flex-wrap"
  >
    <UBadge
      v-for="pill in filters.pills.value"
      :key="pill.id"
      :color="pill.enabled ? 'primary' : 'neutral'"
      :variant="pill.enabled ? 'subtle' : 'outline'"
      size="sm"
      class="cursor-pointer select-none gap-1 max-w-xs"
      :class="pill.enabled ? '' : 'opacity-60 line-through'"
      :title="pill.enabled ? 'Click to disable' : 'Click to enable'"
      @click="filters.togglePill(pill.id)"
    >
      <span class="truncate min-w-0 font-mono text-xs">{{ pill.label }}</span>
      <UIcon
        name="i-lucide-x"
        class="size-3 shrink-0 hover:text-error"
        title="Remove"
        @click.stop="filters.removePill(pill.id)"
      />
    </UBadge>
  </div>
</template>
