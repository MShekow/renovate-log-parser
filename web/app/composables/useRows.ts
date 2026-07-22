/**
 * `useRows` — paged row cache that backs the virtualized list (plan Q16).
 *
 * `GET /api/rows` returns rows for a `offset`/`limit` window plus the `total`
 * count matching the (Phase 5b) filters. The client virtualizes: it renders only
 * the visible slice and fetches the pages covering it on demand. Rows are cached
 * by their result index (0..total-1), so scrolling back is instant and each page
 * is fetched at most once.
 *
 * `getFilters` returns the serialized filter wire (see {@link useFilters}); it is
 * read at fetch time and sent as the `filters` query param. Whenever the filters
 * change the page calls {@link reload} to drop the (now-stale) cache.
 *
 * Created once per page instance (not a singleton) so a fresh log gets a clean
 * cache via {@link reload}.
 */
import type { RowDTO, RowsResponse } from '~/types'

/** Rows fetched per network request. */
const PAGE_SIZE = 200

export function useRows(getFilters?: () => string | undefined) {
  const total = ref(0)
  const ready = ref(false)
  const error = ref<string | null>(null)
  /** result-index -> row. `shallowRef` + replace-on-write keeps reactivity cheap. */
  const rows = shallowRef<Map<number, RowDTO>>(new Map())

  const loadedPages = new Set<number>()
  const inflight = new Set<number>()

  /** Fetch one page (idempotent per page for the current log). */
  async function fetchPage(page: number): Promise<void> {
    if (page < 0 || loadedPages.has(page) || inflight.has(page)) return
    inflight.add(page)
    try {
      const offset = page * PAGE_SIZE
      const query: Record<string, string | number> = { offset, limit: PAGE_SIZE }
      const filters = getFilters?.()
      if (filters && filters !== '{}') query.filters = filters
      const res = await $fetch<RowsResponse>('/api/rows', { query })
      total.value = res.total
      const next = new Map(rows.value)
      res.rows.forEach((row, i) => next.set(offset + i, row))
      rows.value = next
      loadedPages.add(page)
    } catch (err) {
      error.value = messageOf(err)
    } finally {
      inflight.delete(page)
    }
  }

  /** Reset all cached state and fetch the first page for the new current log. */
  async function reload(): Promise<void> {
    total.value = 0
    rows.value = new Map()
    loadedPages.clear()
    inflight.clear()
    error.value = null
    ready.value = false
    await fetchPage(0)
    ready.value = true
  }

  /** Ensure every page covering result indices [start, end) is fetched. */
  function ensureRange(start: number, end: number): void {
    if (end <= start) return
    const firstPage = Math.max(0, Math.floor(start / PAGE_SIZE))
    const lastPage = Math.floor((end - 1) / PAGE_SIZE)
    for (let p = firstPage; p <= lastPage; p++) void fetchPage(p)
  }

  return { total, ready, error, rows, reload, ensureRange, PAGE_SIZE }
}

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
      ?? 'Failed to load rows.'
    )
  }
  return 'Failed to load rows.'
}
