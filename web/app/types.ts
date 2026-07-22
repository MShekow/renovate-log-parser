/**
 * Shared frontend types for the log viewer (Phase 5a).
 */

/**
 * A single row as returned by `GET /api/rows`. It is the original log entry with
 * the server-added `_oL` (0-indexed source line) plus whatever root keys survive
 * the ignored-fields projection. `msg` is never stripped. In Phase 5a no fields
 * are stripped, so `level`/`msg`/etc. are all present when the source entry has
 * them.
 */
export interface RowDTO {
  /** 0-indexed source line number in the original log file. */
  _oL: number
  /** Numeric Renovate log level, when the entry has one. */
  level?: number
  /** The primary log message, when present. */
  msg?: string
  /** Any other root-level key from the entry. */
  [key: string]: unknown
}

/** Metadata about the currently-loaded log (from a load response). */
export interface LoadedLogInfo {
  md5: string
  path: string
  totalLines: number
  levelCounts: Record<string, number>
}

/** Shape of the `GET /api/rows` response. */
export interface RowsResponse {
  total: number
  offset: number
  limit: number
  rows: RowDTO[]
}
