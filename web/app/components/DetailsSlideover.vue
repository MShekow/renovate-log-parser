<script setup lang="ts">
/**
 * DetailsSlideover — a 3/4-width slide-over showing the full JSON of a log entry
 * as a collapsible tree. `msg` is shown in the header and
 * excluded from the tree; `_oL` (the synthetic source-line marker) is surfaced as
 * the title and likewise omitted from the tree body.
 */
import type { RowDTO } from '~/types'
import { JSON_TREE_BULK_KEY, type JsonTreeBulk } from '~/composables/useJsonTreeBulk'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ row: RowDTO | null }>()

/** The entry minus `msg` (shown in the header) and `_oL` (shown as the title). */
const treeValue = computed<Record<string, unknown>>(() => {
  if (!props.row) return {}
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props.row)) {
    if (k === 'msg' || k === '_oL') continue
    rest[k] = v
  }
  return rest
})

const title = computed(() => (props.row ? `Line ${props.row._oL}` : ''))
const description = computed(() =>
  typeof props.row?.msg === 'string' ? props.row.msg : undefined
)

// --- Bulk collapse/expand --------------------------------------------------
/**
 * Reactive pulse broadcast to every {@link JsonTree} descendant. `allExpanded`
 * tracks the last bulk action so the button can toggle its label; `bulk.nonce`
 * makes each request observable even when the target state repeats.
 */
const allExpanded = ref(true)
const bulk = ref<JsonTreeBulk>({ expanded: true, nonce: 0 })
provide(JSON_TREE_BULK_KEY, bulk)

function toggleAll() {
  allExpanded.value = !allExpanded.value
  bulk.value = { expanded: allExpanded.value, nonce: bulk.value.nonce + 1 }
}

/** True when the entry has at least one collapsible branch to act on. */
const hasBranches = computed(() =>
  Object.values(treeValue.value).some(
    v => v !== null && typeof v === 'object'
  )
)

// A newly opened row mounts fresh trees (expanded by default), so reset the
// toggle back to its "Collapse all" state.
watch(
  () => props.row,
  () => {
    allExpanded.value = true
  }
)
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :description="description"
    :ui="{ content: 'sm:max-w-none w-3/4' }"
  >
    <template #body>
      <div class="overflow-auto">
        <div
          class="sticky top-0 z-10 mb-2 flex justify-start border-b border-default bg-default/80 pb-2 backdrop-blur"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :disabled="!hasBranches"
            :icon="
              allExpanded ? 'i-lucide-chevrons-down-up' : 'i-lucide-chevrons-up-down'
            "
            :label="allExpanded ? 'Collapse all' : 'Expand all'"
            @click="toggleAll"
          />
        </div>
        <JsonTree :value="treeValue" />
      </div>
    </template>
  </USlideover>
</template>
