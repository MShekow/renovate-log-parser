/**
 * GET /api/findings — the error-detector report for the current log.
 *
 * Runs the shared {@link ErrorDetector} (no ignore rules) over the current
 * parser and returns `{ summary, counts, findings }`. Per-finding `details` are
 * stripped: the Problems panel only needs category/severity/message/line/repo,
 * and the full entry is already reachable via `GET /api/rows` + the details
 * slide-over. The report is memoized per log in the registry.
 */
import type { Finding } from 'renovate-core/error-detector'

/** A finding trimmed for the wire (no bulky `details`). */
type FindingDTO = Omit<Finding, 'details'>

export default defineEventHandler(() => {
  const report = requireCurrentFindings()
  const findings: FindingDTO[] = report.findings.map(
    ({ details: _details, ...rest }) => rest
  )
  return {
    summary: report.summary,
    counts: report.counts,
    findings
  }
})
