/**
 * GET /api/repositories — the distinct `repository` values across the current
 * log, excluding git-URL sub-repos (e.g. pre-commit hooks) whose
 * `repository` is an `https://…` URL rather than an `owner/repo` slug — these
 * aren't real repos and just clutter the dropdown (mirrors the exclusion in
 * `analyzer.ts`'s per-repo stats). The UI adds a "Repository-independent"
 * pseudo-entry for entries with no `repository` — that is not returned here.
 */
import { extractExpr } from 'renovate-core/filters'

export default defineEventHandler(() => {
  const parser = requireCurrentParser()
  const expr = extractExpr('repository')

  const rows = parser.query<{ repo: string }>(
    `SELECT DISTINCT ${expr} AS repo FROM logs WHERE ${expr} IS NOT NULL ORDER BY repo`
  )
  return rows.map(r => r.repo).filter(repo => !repo.startsWith('https://'))
})
