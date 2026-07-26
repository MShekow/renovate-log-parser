/**
 * GET /api/rows — the paginated, filtered row feed for the current log.
 * Query params:
 *   - `filters` : URL-encoded JSON of the reactive filter object (optional)
 *   - `offset`  : rows to skip (default 0)
 *   - `limit`   : max rows to return (default 100)
 *
 * Returns `{ total, offset, limit, rows }` where each row is a `RowDTO`:
 * `{ _oL, ...entry }` with the ignored root fields stripped (`msg` is never
 * stripped). `total` is the count matching the filters, ignoring pagination, so
 * the client can drive virtualization.
 */
import { buildQuery, buildCountQuery } from 'renovate-core/query-builder'

/** Default page size when the client does not specify a limit. */
const DEFAULT_LIMIT = 100

export default defineEventHandler((event) => {
  const parser = requireCurrentParser()
  const params = getQueryParams(event)

  const wire = parseFilterWire(params.get('filters') ?? undefined)
  const { filters, ignoredFields } = translateFilters(wire)

  const offset = Math.max(0, parseIntParam(params.get('offset'), 0))
  const limit = Math.max(0, parseIntParam(params.get('limit'), DEFAULT_LIMIT))

  const countQuery = buildCountQuery(filters)
  const total
    = parser.query<{ n: number }>(countQuery.sql, countQuery.params)[0]?.n ?? 0

  const dataQuery = buildQuery(filters, { limit, offset }, 'line, logentry')
  const rows = parser
    .queryEntries<Record<string, unknown>>(dataQuery.sql, dataQuery.params)
    .map(({ line, entry }) => projectRow(line, entry, ignoredFields))

  return { total, offset, limit, rows }
})

/** Build a RowDTO: original line + entry with ignored fields stripped. */
function projectRow(
  line: number,
  entry: Record<string, unknown>,
  ignoredFields: readonly string[]
): Record<string, unknown> {
  const stripped = new Set(ignoredFields.filter(f => f !== 'msg'))
  const dto: Record<string, unknown> = { _oL: line }
  for (const [key, value] of Object.entries(entry)) {
    if (stripped.has(key)) continue
    dto[key] = value
  }
  return dto
}

/** Parse a query-string integer, falling back to a default when absent/NaN. */
function parseIntParam(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}
