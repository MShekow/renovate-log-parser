/**
 * `useLog` — reactive lifecycle for the log this tab has open.
 *
 * The backend registers every loaded log by its content md5 and holds no
 * "current" pointer; each read names its log via an `md5` parameter (see
 * {@link apiFetch}). This composable owns that md5 for the tab: it exposes the
 * open log's metadata plus the three ways to set it:
 *   - {@link loadFromPath} — POST an absolute path (used by the `?log=` handoff
 *     and, later, any path input).
 *   - {@link loadFromContents} — POST raw file bytes from the file picker.
 *   - {@link restore} — re-attach to an already-loaded log by md5, which is how
 *     a tab recovers itself from its URL after a reload.
 *
 * It is a singleton across the app (module-level refs) so the header and the row
 * list observe the same state. The singleton is per browser tab — each tab runs
 * its own copy of this module — so two tabs can hold two different logs.
 */
import type { LoadedLogInfo } from '~/types'

const info = ref<LoadedLogInfo | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

/** Extract a human-readable message from a `$fetch`/H3 error. */
function messageOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { statusMessage?: string, data?: { statusMessage?: string, message?: string }, message?: string }
    return (
      e.data?.statusMessage
      ?? e.data?.message
      ?? e.statusMessage
      ?? e.message
      ?? 'Failed to load log.'
    )
  }
  return 'Failed to load log.'
}

export function useLog() {
  /** POST an absolute path to open that log in this tab. */
  async function loadFromPath(path: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      info.value = await $fetch<LoadedLogInfo>('/api/log/path', {
        method: 'POST',
        body: { path }
      })
      return true
    } catch (err) {
      error.value = messageOf(err)
      return false
    } finally {
      loading.value = false
    }
  }

  /** POST raw file bytes (file picker) to open the uploaded log in this tab. */
  async function loadFromContents(bytes: ArrayBuffer): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      info.value = await $fetch<LoadedLogInfo>('/api/log/contents', {
        method: 'POST',
        body: bytes,
        headers: { 'content-type': 'application/octet-stream' }
      })
      return true
    } catch (err) {
      error.value = messageOf(err)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Re-attach to a log the server already holds, by md5. Used on mount to
   * restore the tab from its `?md5=` query param.
   *
   * Returns `false` when the server no longer has that log (a restart drops the
   * registry). That is an ordinary outcome of reloading a stale URL, not a
   * failure worth surfacing, so it leaves `error` untouched and the caller just
   * drops the query param.
   */
  async function restore(md5: string): Promise<boolean> {
    loading.value = true
    try {
      info.value = await $fetch<LoadedLogInfo>(`/api/log/${md5}`)
      return true
    } catch {
      info.value = null
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Forget the open log. Called by {@link apiFetch} when the server 404s an
   * md5 it once served, so the UI drops to the empty state rather than showing a
   * header for a log nothing can be fetched for.
   */
  function clear(): void {
    info.value = null
  }

  return {
    info: readonly(info),
    loading: readonly(loading),
    error: readonly(error),
    loadFromPath,
    loadFromContents,
    restore,
    clear
  }
}
