<script setup lang="ts">
/**
 * FindingsSlideover — the "Problems" panel. Lists the error-detector findings
 * for the current log, grouped by category (error-severity categories first,
 * then warnings), each an expandable section with a count. Clicking a finding
 * asks the page to jump to its source line via the `jump` event.
 *
 * Jumping clears any active filters (so the target line is guaranteed visible);
 * when filters are active a note makes that explicit before the user commits.
 */
import type { Category } from 'renovate-core/error-detector'
import type { FindingDTO } from '~/types'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ jump: [line: number] }>()

const findings = useFindings()
const filters = useFilters()

/** How many findings to show per category before the "Show all" affordance. */
const GROUP_CAP = 100

/** A category with its findings, kept only when non-empty. */
interface Group {
  category: Category
  label: string
  icon: string
  color: 'error' | 'warning'
  items: FindingDTO[]
}

/**
 * Findings grouped by category. Categories are emitted error-severity first,
 * then warnings; within each severity the core `CATEGORIES` order is preserved
 * (the DTO list already arrives in source-line order, so items stay ordered).
 */
const groups = computed<Group[]>(() => {
  const byCategory = new Map<Category, FindingDTO[]>()
  for (const f of findings.findings.value) {
    const list = byCategory.get(f.category)
    if (list) list.push(f)
    else byCategory.set(f.category, [f])
  }

  const out: Group[] = []
  for (const [category, items] of byCategory) {
    out.push({
      category,
      label: FINDING_CATEGORY_META[category].label,
      icon: FINDING_CATEGORY_META[category].icon,
      color: SEVERITY_COLOR[FINDING_CATEGORY_META[category].severity],
      items
    })
  }
  // Errors before warnings; stable otherwise.
  return out.sort((a, b) => severityRank(a.category) - severityRank(b.category))
})

function severityRank(category: Category): number {
  return FINDING_CATEGORY_META[category].severity === 'error' ? 0 : 1
}

/** Categories the user expanded past the {@link GROUP_CAP} cap. */
const showAll = ref<Set<Category>>(new Set())
function toggleShowAll(category: Category): void {
  const next = new Set(showAll.value)
  if (next.has(category)) next.delete(category)
  else next.add(category)
  showAll.value = next
}
function visibleItems(group: Group): FindingDTO[] {
  return showAll.value.has(group.category)
    ? group.items
    : group.items.slice(0, GROUP_CAP)
}

const filtersActive = computed(() => filters.activeCount.value > 0)

function onJump(line: number): void {
  emit('jump', line)
  open.value = false
}

const description = computed(() => {
  const e = findings.errorCount.value
  const w = findings.warningCount.value
  return `${e} error${e === 1 ? '' : 's'}, ${w} warning${w === 1 ? '' : 's'}`
})
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Problems"
    :description="description"
    :ui="{ content: 'sm:max-w-none w-2/5 min-w-96' }"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <!-- Loading. -->
        <div
          v-if="findings.loading.value"
          class="flex items-center justify-center py-10"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-dimmed"
          />
        </div>

        <!-- Error loading findings. -->
        <UAlert
          v-else-if="findings.error.value"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="findings.error.value"
        />

        <!-- Empty state. -->
        <div
          v-else-if="groups.length === 0"
          class="flex flex-col items-center justify-center gap-3 py-10 text-center"
        >
          <UIcon
            name="i-lucide-shield-check"
            class="size-10 text-success"
          />
          <p class="text-muted">
            No problems detected.
          </p>
        </div>

        <template v-else>
          <!-- Filters-active note: jumping will reset filters. -->
          <UAlert
            v-if="filtersActive"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            title="Jumping to a line clears the active filters"
            description="Filters are reset so the target line is visible in the list."
            :ui="{ title: 'text-xs', description: 'text-xs' }"
          />

          <!-- Category groups. -->
          <UCollapsible
            v-for="group in groups"
            :key="group.category"
            :default-open="true"
            class="border border-default rounded-md"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium group"
            >
              <UIcon
                :name="group.icon"
                class="size-4 shrink-0"
                :class="group.color === 'error' ? 'text-error' : 'text-warning'"
              />
              <span class="truncate">{{ group.label }}</span>
              <UBadge
                :label="String(group.items.length)"
                :color="group.color"
                variant="subtle"
                size="sm"
              />
              <UIcon
                name="i-lucide-chevron-down"
                class="size-4 ms-auto text-dimmed transition-transform group-data-[state=open]:rotate-180"
              />
            </button>

            <template #content>
              <ul class="border-t border-default divide-y divide-default/60">
                <li
                  v-for="(f, i) in visibleItems(group)"
                  :key="i"
                  class="flex items-start gap-2 px-3 py-1.5 text-xs hover:bg-elevated/50 cursor-pointer"
                  @click="onJump(f.line)"
                >
                  <span
                    class="shrink-0 font-mono text-dimmed tabular-nums w-12 text-right pt-px"
                    :title="`Line ${f.line}`"
                  >{{ f.line }}</span>
                  <span class="flex-1 min-w-0">
                    <span class="block truncate font-mono">{{ f.message }}</span>
                    <span
                      v-if="f.repository"
                      class="block truncate text-dimmed"
                    >{{ f.repository }}</span>
                  </span>
                  <UIcon
                    name="i-lucide-corner-down-right"
                    class="size-3.5 shrink-0 text-dimmed mt-0.5"
                  />
                </li>
              </ul>
              <div
                v-if="group.items.length > GROUP_CAP"
                class="px-3 py-1.5 border-t border-default"
              >
                <UButton
                  :label="
                    showAll.has(group.category)
                      ? 'Show fewer'
                      : `Show all ${group.items.length}`
                  "
                  color="neutral"
                  variant="link"
                  size="xs"
                  @click="toggleShowAll(group.category)"
                />
              </div>
            </template>
          </UCollapsible>
        </template>
      </div>
    </template>
  </USlideover>
</template>
