<script setup lang="ts">
/**
 * JsonTree — a recursive, collapsible view of an arbitrary JSON value (the
 * details panel). Branches (objects/arrays) render a chevron toggle and are
 * expanded by default. When `keyName` is omitted the node renders its
 * children directly with no header line — used for the root object so the panel
 * starts flat.
 *
 * Right-clicking a key opens a context menu that creates
 * filter pills.
 *   - Root-level keys (`path.length === 1`) get the v1 root-only filters:
 *     show-only/hide the field's presence, and (for scalar leaves) show-only/hide
 *     `field == value`.
 *   - Nested keys (`path.length >= 2`) map to a field-scoped wildcard search on
 *     the top-level ancestor key (`path[0]`): "the ancestor's serialized value
 *     contains this compact JSON fragment" (e.g. `"hostType":"github"`). This
 *     matches the compact JSONL the log actually stores.
 */
import type { ContextMenuItem } from '@nuxt/ui'
import type { ScalarValue } from 'renovate-core/filters'
import { JSON_TREE_BULK_KEY } from '~/composables/useJsonTreeBulk'

interface Props {
  value: unknown
  keyName?: string
  depth?: number
  /**
   * Full path of segments from the root entry to this node: object keys as
   * strings, array indices as numbers. The root is `[]`; a root-level key is
   * `[key]`; nested nodes are longer. Drives the context-menu behaviour.
   */
  path?: (string | number)[]
}
const props = withDefaults(defineProps<Props>(), { depth: 0, path: () => [] })

/**
 * Root keys backed by dedicated static dropdowns rather than dynamic pills.
 * Right-clicking their scalar values must update the corresponding dropdown
 * (Repositories / Levels) instead of creating an equals pill.
 */
const REPOSITORY_FIELD = 'repository'
const LEVEL_FIELD = 'level'

const filters = useFilters()

/**
 * Bulk collapse/expand pulse provided by `DetailsSlideover`. When its `nonce`
 * changes we apply the requested `expanded` state to this branch; collapsing a
 * branch unmounts its children, so the effect cascades to full depth.
 *
 * The flat root node (`keyName === undefined`) renders its children with no
 * header of its own, so it must never collapse — otherwise the root-level keys
 * would vanish entirely. Bulk actions only reach keyed branches.
 */
const bulk = inject(JSON_TREE_BULK_KEY, null)

/**
 * Initial expanded state. Keyed branches inherit the current bulk target so a
 * node that (re)mounts after "collapse all" — e.g. when its parent is expanded
 * by hand — appears collapsed, exposing its immediate children while keeping
 * their subtrees folded. The flat root is always expanded.
 */
const expanded = ref(
  props.keyName === undefined ? true : bulk ? bulk.value.expanded : true
)

if (bulk) {
  watch(
    () => bulk.value.nonce,
    () => {
      if (props.keyName === undefined) return
      if (isBranch.value && !isEmpty.value) expanded.value = bulk.value.expanded
    }
  )
}

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

/** Path segment for a child key: numeric index for arrays, string key otherwise. */
function childSegment(k: string): string | number {
  return kind.value === 'array' ? Number(k) : k
}

/** Short summary shown for a branch (element/key count + brackets). */
const summary = computed(() => {
  if (kind.value === 'array') return isEmpty.value ? '[]' : `[${entries.value.length}]`
  if (kind.value === 'object') return isEmpty.value ? '{}' : `{${entries.value.length}}`
  return ''
})

/** Multiline strings are shown as readable output rather than JSON syntax. */
const isMultilineString = computed(
  () => typeof props.value === 'string' && /[\r\n]/.test(props.value)
)

/** Human display of a leaf value (single-line strings quoted, others readable). */
function primitiveDisplay(v: unknown): string {
  if (kind.value === 'null') return 'null'
  if (typeof v === 'string') return isMultilineString.value ? v : JSON.stringify(v)
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

// --- Context menu ----------------------------------------------------------
/** Root-level key (direct child of the entry). */
const isRootLevel = computed(() => props.path.length === 1)
/** The top-level ancestor key this node lives under (for nested searches). */
const rootField = computed(() => String(props.path[0] ?? ''))
/** True when the immediate parent is an array (this node's segment is an index). */
const parentIsArray = computed(
  () => typeof props.path[props.path.length - 1] === 'number'
)

/** Scalar leaf whose value can drive a root-level `field == value` pill. */
const scalarValue = computed<ScalarValue | null>(() => {
  const v = props.value
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v
  }
  return null
})

/**
 * Compact JSON fragment that must appear inside the root ancestor's serialized
 * value. For an object member it is `"key":value`; for an array element it is
 * the element itself. `JSON.stringify` produces the same compact form SQLite
 * renders, so the substring matches.
 */
const fragment = computed<string>(() => {
  const value = JSON.stringify(props.value)
  return parentIsArray.value ? value : `${JSON.stringify(props.keyName)}:${value}`
})

/** Friendly value for pill/menu labels (full; pills clip visually on hover). */
const labelValue = computed(() => JSON.stringify(props.value))

const menuItems = computed<ContextMenuItem[][]>(() => {
  if (props.keyName === undefined) return []
  const field = props.keyName

  // Root-level key: v1 root-only presence + (scalar) equals filters.
  if (isRootLevel.value) {
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
      // `repository` and `level` have dedicated static dropdowns; route their
      // equals actions there so they update the dropdown instead of adding a
      // pill. Fall back to the generic pill helpers for any other field (or an
      // unexpected value type).
      let showOnly: () => void
      let hide: () => void
      if (field === REPOSITORY_FIELD && typeof scalar === 'string') {
        showOnly = () => filters.showOnlyRepo(scalar)
        hide = () => filters.hideRepo(scalar)
      } else if (field === LEVEL_FIELD && typeof scalar === 'number') {
        showOnly = () => filters.showOnlyLevel(scalar)
        hide = () => filters.hideLevel(scalar)
      } else {
        showOnly = () => filters.showOnlyValue(field, scalar)
        hide = () => filters.hideValue(field, scalar)
      }
      groups.push([
        {
          label: `Show only ${field} = this value`,
          icon: 'i-lucide-equal',
          onSelect: showOnly
        },
        {
          label: `Hide ${field} = this value`,
          icon: 'i-lucide-equal-not',
          onSelect: hide
        }
      ])
    }
    return groups
  }

  // Nested key: search the root ancestor's value for this fragment.
  const root = rootField.value
  const frag = fragment.value
  const label = `${field}: ${labelValue.value}`
  return [
    [
      {
        label: `Show only where "${root}" contains this`,
        icon: 'i-lucide-eye',
        onSelect: () => filters.showOnlyContains(root, frag, `${root} ⊃ ${label}`)
      },
      {
        label: `Hide where "${root}" contains this`,
        icon: 'i-lucide-eye-off',
        onSelect: () => filters.hideContains(root, frag, `${root} ⊅ ${label}`)
      }
    ]
  ]
})
</script>

<template>
  <div class="font-mono text-xs leading-relaxed">
    <!-- Header line (skipped at the flat root where keyName is undefined). -->
    <UContextMenu
      v-if="keyName !== undefined"
      :items="menuItems"
      :disabled="menuItems.length === 0"
      :ui="{ content: 'w-max' }"
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
          data-testid="json-tree-value"
          :data-key-name="keyName"
          :class="[primitiveClass, isMultilineString ? 'whitespace-pre-wrap' : '']"
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
        :path="[...path, childSegment(k)]"
      />
    </div>
  </div>
</template>
