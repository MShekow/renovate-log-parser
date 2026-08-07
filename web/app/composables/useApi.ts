/**
 * `apiFetch` — the single entry point for every read against `/api`.
 *
 * The backend reads are stateless: each GET names the log it operates on with an
 * `md5` query parameter and the server holds no "current log" to fall back on.
 * Rather than have every call site remember to pass that md5, this wrapper
 * injects the one {@link useLog} holds. Routing all reads through here is what
 * keeps browser tabs independent — each tab sends its own md5, so opening a
 * second log in a second tab cannot drag the first one onto it.
 *
 * A 404 means the server no longer holds that log — in practice it restarted
 * since the tab loaded. We clear the open log so the UI falls back to the empty
 * state instead of leaving a header naming a log nothing can be fetched for.
 */

/** Query parameters a caller may add alongside the injected `md5`. */
export type ApiQuery = Record<string, string | number>

/**
 * Fetch an `/api` read for the log this tab has open.
 *
 * @throws {NoLogOpenError} when no log is open — callers guard on
 *   `log.info.value` and should never hit this.
 */
export async function apiFetch<T>(
  url: string,
  options: { query?: ApiQuery } = {}
): Promise<T> {
  const log = useLog()
  const md5 = log.info.value?.md5
  if (!md5) throw new NoLogOpenError()

  try {
    return await $fetch<T>(url, { query: { ...options.query, md5 } })
  } catch (err) {
    if (statusOf(err) === 404) log.clear()
    throw err
  }
}

/** Raised when a read is attempted with no log open. */
export class NoLogOpenError extends Error {
  constructor() {
    super('No log is open.')
    this.name = 'NoLogOpenError'
  }
}

/** Read the HTTP status off a `$fetch` error, if it carries one. */
function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { statusCode?: number, status?: number, response?: { status?: number } }
    return e.statusCode ?? e.status ?? e.response?.status
  }
  return undefined
}
