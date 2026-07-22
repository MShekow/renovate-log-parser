/**
 * GET /api/repositories — the distinct `repository` values across the current
 * log, verbatim (plan Q28.3). This includes git-URL sub-repos (e.g. pre-commit
 * hooks) exactly as they appear. The UI adds a "Repository-independent"
 * pseudo-entry for entries with no `repository` — that is not returned here.
 */
import { extractExpr } from 'renovate-core/filters'

export default defineEventHandler(() => {
  const parser = requireCurrentParser()
  const expr = extractExpr('repository')

  const rows = parser.query<{ repo: string }>(
    `SELECT DISTINCT ${expr} AS repo FROM logs WHERE ${expr} IS NOT NULL ORDER BY repo`
  )
  return rows.map(r => r.repo)
})
