<script setup lang="ts">
/**
 * JsonTree — a recursive, collapsible view of an arbitrary JSON value (Phase 5a
 * details panel). Branches (objects/arrays) render a chevron toggle and are
 * expanded by default (plan Q17). When `keyName` is omitted the node renders its
 * children directly with no header line — used for the root object so the panel
 * starts flat.
 *
 * Phase 5b: right-clicking a root-level key (`depth === 1`) opens a context menu
 * to create filter pills — show-only/hide the field's presence, and (for scalar
 * leaves) show-only/hide `field == value`. Filtering only targets root-level
 * keys in v1, so the menu is disabled for nested keys.
 */
import type { ContextMenuItem } from '@nuxt/ui'
import type { ScalarValue } from 'renovate-core/filters'

interface Props {
  value: unknown
  keyName?: string
  depth?: number
}
const props = withDefaults(defineProps<Props>(), { depth: 0 })

const filters = useFilters()

const expanded = ref(true)

const kind = computed<'array' | 'object' | 'null' | 'primitive'>(() => {
  const v = props.value
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  if (typeof v === 'object') return 'object'
  return 'primitive'
})

const isBranch = computed(() => kind.value === 'array' || kind.value === 'object')

const entries = computed<[string, unknown][]>(() => {
  const v = props.value
  if (Array.isArray(v)) return v.map((item, i) => [String(i), item])
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>)
  return []
})

const isEmpty = computed(() => isBranch.value && entries.value.length === 0)

/** Short summary shown for a branch (element/key count + brackets). */
const summary = computed(() => {
  if (kind.value === 'array') return isEmpty.value ? '[]' : `[${entries.value.length}]`
  if (kind.value === 'object') return isEmpty.value ? '{}' : `{${entries.value.length}}`
  return ''
})

/** Human display of a leaf value (strings quoted, others stringified). */
function primitiveDisplay(v: unknown): string {
  if (kind.value === 'null') return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  return String(v)
}

const primitiveClass = computed(() => {
  const v = props.value
  if (v === null) return 'text-dimmed italic'
  switch (typeof v) {
    case 'number':
    case 'bigint':
      return 'text-info'
    case 'boolean':
      return 'text-warning'
    default:
      return 'text-default break-all'
  }
})

function toggle() {
  if (isBranch.value && !isEmpty.value) expanded.value = !expanded.value
}

// --- Context menu (root-level keys only) -----------------------------------
/** Only root-level keys are addressable by filters in v1 (plan Q4). */
const canFilter = computed(() => props.depth === 1 && props.keyName !== undefined)

/** Scalar leaf whose value can drive a `field == value` pill. */
const scalarValue = computed<ScalarValue | null>(() => {
  const v = props.value
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v
  }
  return null
})

const menuItems = computed<ContextMenuItem[][]>(() => {
  if (!canFilter.value || props.keyName === undefined) return []
  const field = props.keyName
  const groups: ContextMenuItem[][] = [
    [
      {
        label: `Show only entries with "${field}"`,
        icon: 'i-lucide-eye',
        onSelect: () => filters.showOnlyField(field)
      },
      {
        label: `Hide entries with "${field}"`,
        icon: 'i-lucide-eye-off',
        onSelect: () => filters.hideField(field)
      }
    ]
  ]
  const scalar = scalarValue.value
  if (scalar !== null) {
    groups.push([
      {
        label: `Show only ${field} = this value`,
        icon: 'i-lucide-equal',
        onSelect: () => filters.showOnlyValue(field, scalar)
      },
      {
        label: `Hide ${field} = this value`,
        icon: 'i-lucide-equal-not',
        onSelect: () => filters.hideValue(field, scalar)
      }
    ])
  }
  return groups
})
</script>

<template>
  <div class="font-mono text-xs leading-relaxed">
    <!-- Header line (skipped at the flat root where keyName is undefined). -->
    <UContextMenu
      v-if="keyName !== undefined"
      :items="menuItems"
      :disabled="!canFilter"
      :ui="{ content: 'w-64' }"
    >
      <div
        class="flex items-start gap-1"
        :class="isBranch && !isEmpty ? 'cursor-pointer select-none' : ''"
        @click="toggle"
      >
        <UIcon
          v-if="isBranch && !isEmpty"
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3 mt-0.5 shrink-0 text-dimmed"
        />
        <span
          v-else
          class="inline-block w-3 shrink-0"
        />
        <span class="text-primary shrink-0">{{ keyName }}</span>
        <span class="text-dimmed">:</span>
        <span
          v-if="isBranch"
          class="text-dimmed"
        >{{ summary }}</span>
        <span
          v-else
          :class="primitiveClass"
        >{{ primitiveDisplay(value) }}</span>
      </div>
    </UContextMenu>

    <!-- Children. -->
    <div
      v-if="isBranch && expanded && !isEmpty"
      :class="keyName !== undefined ? 'ml-1.5 pl-3 border-l border-default' : ''"
    >
      <JsonTree
        v-for="[k, v] in entries"
        :key="k"
        :value="v"
        :key-name="k"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
