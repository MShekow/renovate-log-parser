<script setup lang="ts">
/**
 * LevelFilterMenu — the static "log levels" dropdown (Phase 5b). Shows a
 * checkbox per level that occurs in the current log (with its count); an empty
 * selection means "all levels". Mutates {@link useFilters}'s `levels` (a
 * `levelIn` filter server-side).
 */
import { levelMeta } from 'renovate-core/levels'

const filters = useFilters()
const log = useLog()

/** Levels present in the log, with metadata + counts, sorted by level. */
const options = computed(() => {
  const counts = log.info.value?.levelCounts ?? {}
  return Object.entries(counts)
    .map(([level, count]) => ({ meta: levelMeta(Number(level)), count }))
    .sort((a, b) => a.meta.level - b.meta.level)
})

const selectedCount = computed(() => filters.levels.value.length)
</script>

<template>
  <UPopover :content="{ align: 'start' }">
    <UButton
      icon="i-lucide-signal"
      color="neutral"
      variant="subtle"
      size="sm"
      trailing-icon="i-lucide-chevron-down"
    >
      Levels
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
      <div class="p-2 w-56 flex flex-col gap-1">
        <div class="flex items-center justify-between px-1 pb-1">
          <span class="text-xs text-muted">Show levels</span>
          <UButton
            v-if="selectedCount > 0"
            label="All"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="filters.clearLevels()"
          />
        </div>
        <p
          v-if="options.length === 0"
          class="text-xs text-dimmed px-1 py-2"
        >
          No log loaded.
        </p>
        <label
          v-for="opt in options"
          :key="opt.meta.level"
          class="flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated/50 cursor-pointer"
        >
          <UCheckbox
            :model-value="filters.levels.value.includes(opt.meta.level)"
            @update:model-value="filters.toggleLevel(opt.meta.level)"
          />
          <span :class="[LEVEL_GLYPH_BASE, LEVEL_CLASS[opt.meta.color]]">{{ opt.meta.symbol }}</span>
          <span class="text-sm flex-1">{{ opt.meta.name }}</span>
          <span class="text-xs text-dimmed tabular-nums">{{ opt.count.toLocaleString() }}</span>
        </label>
      </div>
    </template>
  </UPopover>
</template>
