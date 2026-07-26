/**
 * Shared frontend types for the log viewer.
 */
import type { Filter } from 'renovate-core/filters'

/**
 * A single row as returned by `GET /api/rows`. It is the original log entry with
 * the server-added `_oL` (0-indexed source line) plus whatever root keys survive
 * the ignored-fields projection. `msg` is never stripped.
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

/**
 * A dynamic filter "pill": a core {@link Filter} wrapped with a
 * client-side id, a human-readable `label`, and an `enabled` toggle. Disabled
 * pills stay visible in the UI but are omitted from the query.
 */
export interface Pill {
  id: string
  enabled: boolean
  label: string
  filter: Filter
}

/** The repository include/exclude selection, part of the filter wire object. */
export interface RepositoriesWire {
  mode: 'include' | 'exclude'
  values: string[]
  /** Whether the no-`repository` "Repository-independent" group participates. */
  independent: boolean
}

/**
 * The reactive filter object sent (URL-encoded JSON) as the `filters` query
 * param to `GET /api/rows`. It mirrors the server-side `FilterWire` in
 * `web/server/utils/translate-filters.ts`. All keys are optional; an absent key
 * means "no constraint" (an empty object = the unfiltered view).
 */
export interface FilterWire {
  levels?: number[]
  repositories?: RepositoriesWire
  ignoredFields?: string[]
  search?: { field: string, pattern: string, scope?: 'field' | 'raw' }
  pills?: { id: string, enabled: boolean, filter: Filter }[]
}
