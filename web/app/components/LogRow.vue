<script setup lang="ts">
/**
 * LogRow — a single fixed-height line in the virtualized log list (Phase 5a):
 * source line number, level glyph, and the `msg`. When the entry has keys beyond
 * `msg` a chevron affordance appears and the whole row opens the details panel
 * (plan Phase 5a).
 */
import { levelMeta } from 'renovate-core/levels'
import type { RowDTO } from '~/types'

const props = defineProps<{ row: RowDTO }>()
const emit = defineEmits<{ open: [] }>()

const meta = computed(() =>
  typeof props.row.level === 'number' ? levelMeta(props.row.level) : null
)
const glyph = computed(() => meta.value?.symbol ?? '·')
const glyphClass = computed(() =>
  meta.value ? LEVEL_CLASS[meta.value.color] : 'text-dimmed'
)

/** The row opens a details panel iff it carries data beyond `msg`/`_oL`. */
const hasDetails = computed(() =>
  Object.keys(props.row).some(k => k !== '_oL' && k !== 'msg')
)

/** Text to show: the message, or a muted marker for blank/malformed lines. */
const isSpecial = computed(() =>
  props.row._blank === true || props.row._parseError === true
)
const message = computed(() => {
  if (typeof props.row.msg === 'string') return props.row.msg
  if (props.row._parseError === true) {
    return typeof props.row._raw === 'string' ? props.row._raw : '(malformed line)'
  }
  if (props.row._blank === true) return '(blank line)'
  return ''
})
</script>

<template>
  <div
    class="group flex items-center gap-2 h-full px-3 text-sm border-b border-default/40"
    :class="hasDetails ? 'cursor-pointer hover:bg-elevated/50' : ''"
    @click="hasDetails && emit('open')"
  >
    <span class="w-12 shrink-0 text-right font-mono text-xs text-dimmed tabular-nums select-none">
      {{ row._oL }}
    </span>
    <span :class="[LEVEL_GLYPH_BASE, glyphClass]">{{ glyph }}</span>
    <span
      class="truncate flex-1 font-mono text-xs"
      :class="isSpecial ? 'text-dimmed italic' : ''"
    >{{ message }}</span>
    <UIcon
      v-if="hasDetails"
      name="i-lucide-chevron-left"
      class="size-4 shrink-0 text-dimmed group-hover:text-primary"
    />
  </div>
</template>
