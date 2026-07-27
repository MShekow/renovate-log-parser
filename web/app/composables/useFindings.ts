/**
 * `useFindings` — reactive error-detector report for the current log.
 *
 * `GET /api/findings` returns the findings the shared `ErrorDetector` produced
 * for the current log (errors + warnings, no ignore rules). This composable is
 * the client mirror: it fetches once per log and exposes the report plus a few
 * derived views the header badges and the Problems panel consume.
 *
 * It is a module-level singleton (like {@link useLog} / {@link useFilters}) so
 * the header button and the slide-over observe the same state. {@link load} is
 * called by the page whenever a new log becomes current.
 */
import type { FindingsResponse, FindingDTO } from '~/types'
import type { Category } from 'renovate-core/error-detector'

const report = ref<FindingsResponse | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** Extract a human-readable message from a `$fetch`/H3 error. */
function messageOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      statusMessage?: string
      data?: { statusMessage?: string, message?: string }
      message?: string
    }
    return (
      e.data?.statusMessage
      ?? e.data?.message
      ?? e.statusMessage
      ?? e.message
      ?? 'Failed to load findings.'
    )
  }
  return 'Failed to load findings.'
}

export function useFindings() {
  /** Fetch the report for the current log, replacing any previous one. */
  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    report.value = null
    try {
      report.value = await $fetch<FindingsResponse>('/api/findings')
    } catch (err) {
      error.value = messageOf(err)
    } finally {
      loading.value = false
    }
  }

  /** Clear the report (e.g. when no log is loaded). */
  function reset(): void {
    report.value = null
    error.value = null
  }

  const errorCount = computed(() => report.value?.summary.errorCount ?? 0)
  const warningCount = computed(() => report.value?.summary.warningCount ?? 0)
  const total = computed(() => errorCount.value + warningCount.value)
  const counts = computed<Record<Category, number> | undefined>(
    () => report.value?.counts
  )
  const findings = computed<FindingDTO[]>(() => report.value?.findings ?? [])

  return {
    report: readonly(report),
    loading: readonly(loading),
    error: readonly(error),
    errorCount,
    warningCount,
    total,
    counts,
    findings,
    load,
    reset
  }
}
