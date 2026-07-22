<script setup lang="ts">
/**
 * JsonTree — a recursive, collapsible view of an arbitrary JSON value (Phase 5a
 * details panel). Branches (objects/arrays) render a chevron toggle and are
 * expanded by default (plan Q17). When `keyName` is omitted the node renders its
 * children directly with no header line — used for the root object so the panel
 * starts flat.
 */
interface Props {
  value: unknown
  keyName?: string
  depth?: number
}
const props = withDefaults(defineProps<Props>(), { depth: 0 })

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
</script>

<template>
  <div class="font-mono text-xs leading-relaxed">
    <!-- Header line (skipped at the flat root where keyName is undefined). -->
    <div
      v-if="keyName !== undefined"
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
