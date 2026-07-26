/**
 * GET /api/fields — the distinct set of root-level JSON keys across the current
 * log. Powers the "ignored fields" checkboxes in the UI. The
 * synthetic keys the Parser uses for blank / malformed lines are excluded.
 */
export default defineEventHandler(() => {
  const parser = requireCurrentParser()

  const rows = parser.query<{ key: string }>(
    'SELECT DISTINCT je.key AS key FROM logs, json_each(logs.logentry) AS je'
  )

  const synthetic = new Set(['_blank', '_parseError', '_raw'])
  return rows
    .map(r => r.key)
    .filter(key => !synthetic.has(key))
    .sort()
})
