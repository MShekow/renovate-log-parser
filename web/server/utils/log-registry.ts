/**
 * Stateful, process-wide log registry for the web backend.
 *
 * The `web` command runs a single long-lived Nitro process for one user, so we
 * keep every loaded log's open {@link Parser} (and its SQLite handle) in memory
 * keyed by content md5, plus a `current` pointer. A successful load sets
 * `current`; the GET routes always operate on `current` — there is no per-request
 * `md5` override. Loading a new file simply moves the pointer (the previous
 * handle stays cached for cheap re-selection).
 *
 * This module is auto-imported by Nitro (server/utils/*), so route handlers can
 * call the exported helpers without importing them.
 */
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Parser } from 'renovate-core/parser'
import { extractExpr } from 'renovate-core/filters'

/** A single cached, loaded log. */
interface RegistryEntry {
  /** Absolute path of the source log (or the temp file for uploads). */
  path: string
  /** The open parser / SQLite handle for this log. */
  parser: Parser
}

/** Public metadata returned to the client after a successful load. */
export interface LoadedLogInfo {
  md5: string
  path: string
  totalLines: number
  levelCounts: Record<string, number>
}

/** md5 -> loaded log. Persists for the lifetime of the Nitro process. */
const registry = new Map<string, RegistryEntry>()

/** The md5 of the log the GET routes currently operate on. */
let current: string | null = null

/** Prefix for uploaded-file temp copies (distinct from Parser's cache files). */
const UPLOAD_PREFIX = 'renovate-log-parser-upload-'
const UPLOAD_SUFFIX = '.jsonl'

/**
 * Load a log from an absolute filesystem path and make it current.
 *
 * @throws {Error} with a `statusCode` when the path is not absolute / missing,
 *   or the parse fails — the route layer maps these to HTTP responses.
 */
export function loadLogFromPath(rawPath: string): LoadedLogInfo {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'A "path" is required.' })
  }
  if (!isAbsolute(rawPath)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Path must be absolute: ${rawPath}`
    })
  }
  if (!existsSync(rawPath)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Log file not found: ${rawPath}`
    })
  }
  return loadInto(rawPath)
}

/**
 * Persist uploaded bytes to a temp file (named by their md5) and load it. The
 * temp copy becomes the log's `path`, mirroring the on-disk load path.
 */
export function loadLogFromBytes(bytes: Uint8Array): LoadedLogInfo {
  if (bytes.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Uploaded file is empty.' })
  }
  const md5 = createHash('md5').update(bytes).digest('hex')
  const tempPath = join(tmpdir(), `${UPLOAD_PREFIX}${md5}${UPLOAD_SUFFIX}`)
  if (!existsSync(tempPath)) {
    writeFileSync(tempPath, bytes)
  }
  return loadInto(tempPath)
}

/** Shared load path: reuse the cached parser if present, else parse fresh. */
function loadInto(absolutePath: string): LoadedLogInfo {
  let md5: string
  let parser: Parser

  // Reuse an already-open parser whose source path matches (cheap re-select).
  const existing = [...registry.values()].find(e => e.path === absolutePath)
  if (existing) {
    parser = existing.parser
    md5 = parser.loaded!.md5
  } else {
    parser = new Parser()
    let result
    try {
      result = parser.load(absolutePath)
    } catch (err) {
      parser.close()
      throw createError({
        statusCode: 400,
        statusMessage:
          err instanceof Error ? err.message : 'Failed to parse log file.'
      })
    }
    md5 = result.md5
    registry.set(md5, { path: absolutePath, parser })
  }

  current = md5
  const info = parser.loaded!
  return {
    md5,
    path: info.path,
    totalLines: info.totalLines,
    levelCounts: computeLevelCounts(parser)
  }
}

/**
 * Return the parser for the current log, or throw a 409 when none is loaded.
 * The GET routes call this first.
 */
export function requireCurrentParser(): Parser {
  if (current === null) {
    throw createError({
      statusCode: 409,
      statusMessage: 'No log is loaded. POST a log to /api/log/path first.'
    })
  }
  const entry = registry.get(current)
  if (!entry) {
    // Defensive: pointer without an entry should never happen.
    current = null
    throw createError({ statusCode: 409, statusMessage: 'No log is loaded.' })
  }
  return entry.parser
}

/** Count entries per numeric `level` via a single grouped SQL scan. */
export function computeLevelCounts(parser: Parser): Record<string, number> {
  const levelExpr = extractExpr('level')
  const rows = parser.query<{ level: number | null, n: number }>(
    `SELECT ${levelExpr} AS level, COUNT(*) AS n FROM logs GROUP BY ${levelExpr}`
  )
  const counts: Record<string, number> = {}
  for (const { level, n } of rows) {
    if (typeof level === 'number') counts[String(level)] = n
  }
  // Re-key in ascending numeric level order for a stable, readable response.
  const sorted: Record<string, number> = {}
  for (const key of Object.keys(counts).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = counts[key]!
  }
  return sorted
}
