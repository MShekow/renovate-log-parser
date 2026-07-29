<script setup lang="ts">
/**
 * Main log viewer: a virtualized, fixed-row-height list of every log
 * line (level glyph + `msg`) with an on-demand details slide-over. The header
 * shows the current log path, a file picker (POST /api/log/contents) and a level
 * breakdown. On mount it reads `?log=` and loads that path (the CLI handoff).
 */
import { levelMeta } from 'renovate-core/levels'
import type { RowDTO } from '~/types'

/** Fixed row height in px — must match the rendered row for virtualization. */
const ROW_HEIGHT = 28
/** Extra rows rendered above/below the viewport to avoid blank flashes. */
const OVERSCAN = 10

const route = useRoute()
const log = useLog()
const filters = useFilters()
const findings = useFindings()
const toast = useToast()
const { total, ready, error: rowsError, rows, reload, ensureRange } = useRows(
  () => filters.serialized.value
)

// --- Virtualization state --------------------------------------------------
const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportH = ref(0)

const startIndex = computed(() =>
  Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN)
)
const visibleCount = computed(() =>
  Math.ceil(viewportH.value / ROW_HEIGHT) + OVERSCAN * 2
)
const endIndex = computed(() =>
  Math.min(total.value, startIndex.value + visibleCount.value)
)

const visibleRows = computed(() => {
  const out: { index: number, row: RowDTO | undefined }[] = []
  for (let i = startIndex.value; i < endIndex.value; i++) {
    out.push({ index: i, row: rows.value.get(i) })
  }
  return out
})

watch([startIndex, endIndex], () => ensureRange(startIndex.value, endIndex.value))

function onScroll() {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

function measure() {
  viewportH.value = scroller.value?.clientHeight ?? 0
}

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  clearTimeout(refetchTimer)
  clearTimeout(highlightTimer)
})

// --- Log loading -----------------------------------------------------------
// When a new log becomes current, reset filters + scroll and reload the cache.
// `suppressRefetch` swallows the filter-change refetch that resetting filters
// would otherwise trigger, so a new log reloads exactly once.
let suppressRefetch = false
let refetchTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => log.info.value?.md5,
  async (md5) => {
    if (!md5) return
    suppressRefetch = true
    filters.reset()
    await nextTick()
    suppressRefetch = false
    scrollTop.value = 0
    scroller.value?.scrollTo({ top: 0 })
    await reload()
    await nextTick()
    measure()
    ensureRange(startIndex.value, endIndex.value)
    void findings.load()
  }
)

// Debounced refetch whenever the filter model changes.
watch(filters.serialized, () => {
  if (suppressRefetch || !log.info.value) return
  clearTimeout(refetchTimer)
  refetchTimer = setTimeout(async () => {
    scrollTop.value = 0
    scroller.value?.scrollTo({ top: 0 })
    await reload()
    await nextTick()
    ensureRange(startIndex.value, endIndex.value)
  }, 250)
})

onMounted(async () => {
  const q = route.query.log
  const logPath = Array.isArray(q) ? q[0] : q
  if (typeof logPath === 'string' && logPath.length > 0) {
    await log.loadFromPath(logPath)
  }
})

// --- File picker -----------------------------------------------------------
const fileInput = ref<HTMLInputElement | null>(null)
function pickFile() {
  fileInput.value?.click()
}
async function onFileChosen(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const bytes = await file.arrayBuffer()
  await log.loadFromContents(bytes)
  input.value = '' // allow re-picking the same file
}

// --- Details panel ---------------------------------------------------------
const detailsOpen = ref(false)
const selectedRow = ref<RowDTO | null>(null)
function openDetails(row: RowDTO) {
  selectedRow.value = row
  detailsOpen.value = true
}

// --- Problems panel + jump-to-line -----------------------------------------
const problemsOpen = ref(false)

/** The source line currently highlighted after a jump (flash + brief persist). */
const highlightedLine = ref<number | null>(null)
let highlightTimer: ReturnType<typeof setTimeout> | undefined
function highlightLine(line: number) {
  highlightedLine.value = line
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    highlightedLine.value = null
  }, 2600)
}

/** Scroll the target source line into view (~1/3 from the top) and prefetch it. */
function scrollToLine(line: number) {
  const target = line * ROW_HEIGHT - viewportH.value * 0.3
  const maxTop = Math.max(0, totalHeight.value - viewportH.value)
  const top = Math.min(Math.max(0, target), maxTop)
  scrollTop.value = top
  scroller.value?.scrollTo({ top })
  ensureRange(startIndex.value, endIndex.value)
}

/**
 * Jump to a finding's source line. Any active filters are cleared first so the
 * line is guaranteed present and its result-index equals its source line (the
 * unfiltered list is line-ordered and complete). The clear is done inline —
 * bypassing the debounced refetch — so the scroll lands on fresh data.
 */
async function jumpToLine(line: number) {
  if (filters.activeCount.value > 0) {
    suppressRefetch = true
    filters.clearAll()
    await nextTick()
    suppressRefetch = false
    clearTimeout(refetchTimer)
    scrollTop.value = 0
    scroller.value?.scrollTo({ top: 0 })
    await reload()
    await nextTick()
    toast.add({
      title: `Cleared filters to reveal line ${line}`,
      icon: 'i-lucide-filter-x',
      color: 'info'
    })
  }
  scrollToLine(line)
  highlightLine(line)
}

// --- Header level breakdown ------------------------------------------------
const levelBreakdown = computed(() => {
  const counts = log.info.value?.levelCounts ?? {}
  return Object.entries(counts)
    .map(([level, count]) => ({ meta: levelMeta(Number(level)), count }))
    .sort((a, b) => a.meta.level - b.meta.level)
})

const totalHeight = computed(() => total.value * ROW_HEIGHT)
const anyError = computed(() => log.error.value ?? rowsError.value)
</script>

<template>
  <div class="h-screen flex flex-col">
    <!-- Header: log path, file picker, level breakdown. -->
    <header class="shrink-0 border-b border-default px-4 py-2 flex items-center gap-4">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon
          name="i-lucide-file-text"
          class="size-5 shrink-0 text-primary"
        />
        <div class="min-w-0">
          <p
            v-if="log.info.value"
            class="font-mono text-sm truncate"
            :title="log.info.value.path"
          >
            {{ log.info.value.path }}
          </p>
          <p
            v-else
            class="text-sm text-dimmed"
          >
            No log loaded
          </p>
          <p
            v-if="log.info.value"
            class="text-xs text-dimmed"
          >
            {{ log.info.value.totalLines.toLocaleString() }} lines
          </p>
        </div>
      </div>

      <!-- Level breakdown pills. -->
      <div
        v-if="levelBreakdown.length"
        class="flex items-center gap-1.5 flex-wrap"
      >
        <span
          v-for="b in levelBreakdown"
          :key="b.meta.level"
          class="inline-flex items-center gap-1 text-xs"
          :title="b.meta.name"
        >
          <span :class="[LEVEL_GLYPH_BASE, LEVEL_CLASS[b.meta.color]]">{{ b.meta.symbol }}</span>
          <span class="tabular-nums text-muted">{{ b.count.toLocaleString() }}</span>
        </span>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <UButton
          v-if="log.info.value"
          color="neutral"
          variant="subtle"
          size="sm"
          :icon="findings.total.value > 0 ? 'i-lucide-shield-alert' : 'i-lucide-shield-check'"
          :loading="findings.loading.value"
          @click="() => { problemsOpen = true }"
        >
          Problems
          <UBadge
            v-if="findings.errorCount.value > 0"
            :label="findings.errorCount.value.toLocaleString()"
            color="error"
            variant="solid"
            size="sm"
          />
          <UBadge
            v-if="findings.warningCount.value > 0"
            :label="findings.warningCount.value.toLocaleString()"
            color="warning"
            variant="solid"
            size="sm"
          />
        </UButton>
        <FieldsFilterMenu v-if="log.info.value" />
        <UButton
          icon="i-lucide-folder-open"
          label="Open file"
          color="neutral"
          variant="subtle"
          size="sm"
          :loading="log.loading.value"
          @click="pickFile"
        />
        <UColorModeButton />
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".jsonl,.log,.json,.txt,application/json,text/plain"
          @change="onFileChosen"
        >
      </div>
    </header>

    <!-- Filter toolbar: search, static dropdowns, dynamic pills. -->
    <FilterBar v-if="log.info.value" />

    <!-- Error banner. -->
    <UAlert
      v-if="anyError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="anyError"
      class="rounded-none"
    />

    <!-- Body. -->
    <div
      ref="scroller"
      class="flex-1 min-h-0 overflow-auto relative"
      @scroll="onScroll"
    >
      <!-- Empty state. -->
      <div
        v-if="!log.info.value && !log.loading.value"
        class="h-full flex flex-col items-center justify-center gap-3 text-center px-6"
      >
        <UIcon
          name="i-lucide-file-search"
          class="size-10 text-dimmed"
        />
        <p class="text-muted">
          Open a Renovate JSONL log to begin.
        </p>
        <UButton
          icon="i-lucide-folder-open"
          label="Open file"
          color="primary"
          @click="pickFile"
        />
      </div>

      <!-- Loading first page. -->
      <div
        v-else-if="log.info.value && !ready"
        class="h-full flex items-center justify-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-dimmed"
        />
      </div>

      <!-- No rows match the current filters. -->
      <div
        v-else-if="log.info.value && ready && total === 0"
        class="h-full flex flex-col items-center justify-center gap-3 text-center px-6"
      >
        <UIcon
          name="i-lucide-filter-x"
          class="size-10 text-dimmed"
        />
        <p class="text-muted">
          No log lines match the current filters.
        </p>
        <UButton
          icon="i-lucide-filter-x"
          label="Clear filters"
          color="neutral"
          variant="subtle"
          @click="filters.clearAll()"
        />
      </div>

      <!-- Virtualized list: full-height spacer + absolutely-positioned rows. -->
      <div
        v-else-if="log.info.value"
        class="relative"
        :style="{ height: `${totalHeight}px` }"
      >
        <div
          v-for="item in visibleRows"
          :key="item.index"
          class="absolute inset-x-0"
          :style="{ top: `${item.index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }"
        >
          <LogRow
            v-if="item.row"
            :row="item.row"
            :highlighted="highlightedLine !== null && item.row._oL === highlightedLine"
            @open="openDetails(item.row)"
          />
          <div
            v-else
            class="flex items-center gap-1.5 h-full pl-1.5 pr-3"
          >
            <span class="w-3.5 shrink-0" />
            <span class="w-10 shrink-0 text-right font-mono text-xs text-dimmed tabular-nums">{{ item.index }}</span>
            <USkeleton class="h-3 flex-1" />
          </div>
        </div>
      </div>
    </div>

    <DetailsSlideover
      v-model:open="detailsOpen"
      :row="selectedRow"
    />

    <FindingsSlideover
      v-model:open="problemsOpen"
      @jump="jumpToLine"
    />
  </div>
</template>
