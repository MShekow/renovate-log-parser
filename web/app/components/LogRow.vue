<script setup lang="ts">
/**
 * LogRow — a single fixed-height line in the virtualized log list:
 * source line number, level glyph, and the `msg`. When the entry has keys beyond
 * `msg` a chevron affordance appears and the whole row opens the details panel.
 *
 * Right-clicking opens a context menu: level/repository actions drive
 * the static dropdowns (via {@link useFilters}); message actions create pills.
 */
import { levelMeta } from 'renovate-core/levels'
import type { ContextMenuItem } from '@nuxt/ui'
import type { RowDTO } from '~/types'

const props = defineProps<{ row: RowDTO, highlighted?: boolean }>()
const emit = defineEmits<{ open: [] }>()

const filters = useFilters()

const meta = computed(() =>
  typeof props.row.level === 'number' ? levelMeta(props.row.level) : null
)
const glyph = computed(() => meta.value?.symbol ?? '·')
const glyphClass = computed(() =>
  meta.value ? LEVEL_CLASS[meta.value.color] : 'text-dimmed'
)

/**
 * The row opens a details panel only when it carries information beyond what the
 * row already shows inline. `_oL` (line number) and `msg` are rendered in the
 * row; `level` is shown as the glyph; and the synthetic blank/parse-error keys
 * are surfaced as the message text — so none of them count as "extra detail".
 * (Server-side the ignored/hidden fields are already stripped from the DTO, so
 * any remaining key here is genuinely additional.)
 */
const NON_DETAIL_KEYS = new Set([
  '_oL',
  'msg',
  'level',
  '_blank',
  '_parseError',
  '_raw'
])
const hasDetails = computed(() =>
  Object.keys(props.row).some(k => !NON_DETAIL_KEYS.has(k))
)

/**
 * Keys omitted from the inline preview. This is {@link NON_DETAIL_KEYS} plus
 * `v` (the pino version marker): the details slide-over still surfaces `v`, but
 * it is noise in the one-line preview.
 */
const PREVIEW_HIDDEN_KEYS = new Set([...NON_DETAIL_KEYS, 'v'])

/** Render a value compactly for the preview: strings as-is, else length-capped JSON. */
function previewValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const max = 60
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * A one-line `key=value | key=value` preview of the entry's extra keys (those
 * beyond what the row already shows). `repository` is surfaced first when
 * present; the remaining keys keep their original order.
 */
const preview = computed(() => {
  const keys = Object.keys(props.row).filter(k => !PREVIEW_HIDDEN_KEYS.has(k))
  keys.sort((a, b) => {
    if (a === 'repository') return -1
    if (b === 'repository') return 1
    return 0
  })
  return keys.map(k => `${k}=${previewValue(props.row[k])}`).join(' | ')
})

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

/** Context-menu items built from the row's level, repository and message. */
const menuItems = computed<ContextMenuItem[][]>(() => {
  const groups: ContextMenuItem[][] = []

  if (meta.value) {
    const level = meta.value.level
    const name = meta.value.name
    groups.push([
      {
        label: `Show only level ${name}`,
        icon: 'i-lucide-signal',
        onSelect: () => filters.showOnlyLevel(level)
      },
      {
        label: `Hide level ${name}`,
        icon: 'i-lucide-signal-low',
        onSelect: () => filters.hideLevel(level)
      }
    ])
  }

  const repo = props.row.repository
  if (typeof repo === 'string' && repo.length > 0) {
    groups.push([
      {
        label: 'Show only this repository',
        icon: 'i-lucide-folder-git-2',
        onSelect: () => filters.showOnlyRepo(repo)
      },
      {
        label: 'Hide this repository',
        icon: 'i-lucide-folder-minus',
        onSelect: () => filters.hideRepo(repo)
      }
    ])
  }

  if (typeof props.row.msg === 'string' && props.row.msg.length > 0) {
    const msg = props.row.msg
    groups.push([
      {
        label: 'Show only this message',
        icon: 'i-lucide-message-square',
        onSelect: () => filters.showOnlyValue('msg', msg)
      },
      {
        label: 'Hide this message',
        icon: 'i-lucide-message-square-off',
        onSelect: () => filters.hideValue('msg', msg)
      }
    ])
  }

  return groups
})

const hasMenu = computed(() => menuItems.value.length > 0)
</script>

<template>
  <UContextMenu
    :items="menuItems"
    :disabled="!hasMenu"
    :ui="{ content: 'w-56' }"
  >
    <div
      class="group flex items-center gap-1.5 h-full pl-1.5 pr-3 text-sm border-b border-default/40"
      :class="[hasDetails ? 'cursor-pointer hover:bg-elevated/50' : '', highlighted ? 'log-row--highlight' : '']"
      @click="hasDetails && emit('open')"
    >
      <!-- Expand affordance on the left (only when the row has extra detail). -->
      <span class="w-3.5 shrink-0 flex items-center justify-center">
        <UIcon
          v-if="hasDetails"
          name="i-lucide-chevron-right"
          class="size-3.5 text-dimmed group-hover:text-primary"
        />
      </span>
      <span class="w-10 shrink-0 text-right font-mono text-xs text-dimmed tabular-nums select-none">
        {{ row._oL }}
      </span>
      <span :class="[LEVEL_GLYPH_BASE, glyphClass]">{{ glyph }}</span>
      <span class="truncate flex-1 font-mono text-xs">
        <span :class="isSpecial ? 'text-dimmed italic' : ''">{{ message }}</span>
        <span
          v-if="preview"
          class="text-dimmed ml-2"
        >{{ preview }}</span>
      </span>
    </div>
  </UContextMenu>
</template>

<style scoped>
/*
 * Jump-to-line landing highlight: a quick flash that settles into a subtle
 * tinted persist (the parent clears the `highlighted` prop after ~2.6s).
 */
.log-row--highlight {
  animation: log-row-flash 2.6s ease-out;
}

@keyframes log-row-flash {
  0% {
    background-color: var(--ui-primary);
  }
  15% {
    background-color: color-mix(in oklch, var(--ui-primary) 35%, transparent);
  }
  100% {
    background-color: color-mix(in oklch, var(--ui-primary) 12%, transparent);
  }
}
</style>
