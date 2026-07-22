<script setup lang="ts">
/**
 * FilterPill — a single dynamic filter pill (see {@link FilterPills}). Clicking
 * the pill toggles its `enabled` state; the ✕ removes it. The label is visually
 * clipped (`truncate` + `max-w-xs`); when it overflows we surface the full,
 * untruncated content via a {@link UTooltip} that stays disabled while the label
 * fits, so non-clipped pills show no redundant tooltip.
 */
import type { Pill } from '~/types'

const props = defineProps<{ pill: Pill }>()

const filters = useFilters()

const labelEl = ref<HTMLElement | null>(null)
const overflowing = ref(false)

function measure(): void {
  const el = labelEl.value
  if (el) overflowing.value = el.scrollWidth > el.clientWidth
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && labelEl.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(labelEl.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// Re-measure when the label text changes (pill reused / relabelled).
watch(() => props.pill.label, () => nextTick(measure))
</script>

<template>
  <UTooltip
    :text="pill.label"
    :disabled="!overflowing"
    :ui="{
      content: 'h-auto max-w-md py-1',
      text: 'whitespace-normal break-all text-left'
    }"
  >
    <UBadge
      :color="pill.enabled ? 'primary' : 'neutral'"
      :variant="pill.enabled ? 'subtle' : 'outline'"
      size="sm"
      class="cursor-pointer select-none gap-1 max-w-xs"
      :class="pill.enabled ? '' : 'opacity-60 line-through'"
      @click="filters.togglePill(pill.id)"
    >
      <span
        ref="labelEl"
        class="truncate min-w-0 font-mono text-xs"
      >{{ pill.label }}</span>
      <UIcon
        name="i-lucide-x"
        class="size-3 shrink-0 hover:text-error"
        title="Remove"
        @click.stop="filters.removePill(pill.id)"
      />
    </UBadge>
  </UTooltip>
</template>
