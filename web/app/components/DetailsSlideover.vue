<script setup lang="ts">
/**
 * DetailsSlideover — a 3/4-width slide-over showing the full JSON of a log entry
 * as a collapsible tree (plan Q17 / Phase 5a). `msg` is shown in the header and
 * excluded from the tree; `_oL` (the synthetic source-line marker) is surfaced as
 * the title and likewise omitted from the tree body.
 */
import type { RowDTO } from '~/types'

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
        <JsonTree :value="treeValue" />
      </div>
    </template>
  </USlideover>
</template>
