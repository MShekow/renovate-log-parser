/**
 * `useLog` — reactive lifecycle for the currently-loaded log.
 *
 * The Nitro backend is stateful: it holds one "current" log. This
 * composable is the client mirror of that pointer. It exposes the current log's
 * metadata plus the two ways to make a log current:
 *   - {@link loadFromPath} — POST an absolute path (used by the `?log=` handoff
 *     and, later, any path input).
 *   - {@link loadFromContents} — POST raw file bytes from the file picker.
 *
 * It is a singleton across the app (module-level refs) so the header and the row
 * list observe the same state.
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
  /** POST an absolute path to make that log current. */
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

  /** POST raw file bytes (file picker) to make the uploaded log current. */
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

  return {
    info: readonly(info),
    loading: readonly(loading),
    error: readonly(error),
    loadFromPath,
    loadFromContents
  }
}
