/**
 * The `/api` Express router — the whole web backend.
 *
 * Every route operates on the process-wide "current log" held by the
 * {@link ./log-registry.js log registry}; the two POST routes are what make a
 * log current. Handlers throw {@link HttpError}s, which {@link apiErrorHandler}
 * renders as JSON.
 */
import express, {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { buildQuery, buildCountQuery } from "../core/query-builder.js";
import { extractExpr } from "../core/filters.js";
import type { Finding } from "../core/error-detector.js";
import { createError, HttpError } from "./http-error.js";
import {
  loadLogFromBytes,
  loadLogFromPath,
  requireCurrentFindings,
  requireCurrentParser,
} from "./log-registry.js";
import { parseFilterWire, translateFilters } from "./translate-filters.js";

/** Default page size for `GET /api/rows` when the client omits a limit. */
const DEFAULT_LIMIT = 100;

/** Upload cap for `POST /api/log/contents` — Renovate debug logs get big. */
const MAX_UPLOAD_SIZE = "2gb";

/** A finding trimmed for the wire (no bulky `details`). */
type FindingDTO = Omit<Finding, "details">;

/** Build the API router. */
export function createApiRouter(): Router {
  const router = Router();

  /**
   * GET /api/fields — the distinct set of root-level JSON keys across the
   * current log. Powers the "ignored fields" checkboxes in the UI. The
   * synthetic keys the Parser uses for blank / malformed lines are excluded.
   */
  router.get("/fields", (_req, res) => {
    const parser = requireCurrentParser();
    const rows = parser.query<{ key: string }>(
      "SELECT DISTINCT je.key AS key FROM logs, json_each(logs.logentry) AS je",
    );
    const synthetic = new Set(["_blank", "_parseError", "_raw"]);
    res.json(
      rows
        .map((r) => r.key)
        .filter((key) => !synthetic.has(key))
        .sort(),
    );
  });

  /**
   * GET /api/repositories — the distinct `repository` values across the current
   * log, excluding git-URL sub-repos (e.g. pre-commit hooks) whose `repository`
   * is an `https://…` URL rather than an `owner/repo` slug — these aren't real
   * repos and just clutter the dropdown (mirrors the exclusion in
   * `analyzer.ts`'s per-repo stats). The UI adds a "Repository-independent"
   * pseudo-entry for entries with no `repository` — that is not returned here.
   */
  router.get("/repositories", (_req, res) => {
    const parser = requireCurrentParser();
    const expr = extractExpr("repository");
    const rows = parser.query<{ repo: string }>(
      `SELECT DISTINCT ${expr} AS repo FROM logs WHERE ${expr} IS NOT NULL ORDER BY repo`,
    );
    res.json(
      rows.map((r) => r.repo).filter((repo) => !repo.startsWith("https://")),
    );
  });

  /**
   * GET /api/findings — the error-detector report for the current log.
   *
   * Per-finding `details` are stripped: the Problems panel only needs
   * category/severity/message/line/repo, and the full entry is already reachable
   * via `GET /api/rows` + the details slide-over.
   */
  router.get("/findings", (_req, res) => {
    const report = requireCurrentFindings();
    const findings: FindingDTO[] = report.findings.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- drop `details` from the wire payload
      ({ details, ...rest }) => rest,
    );
    res.json({
      summary: report.summary,
      counts: report.counts,
      findings,
    });
  });

  /**
   * GET /api/rows — the paginated, filtered row feed for the current log.
   * Query params:
   *   - `filters` : URL-encoded JSON of the reactive filter object (optional)
   *   - `offset`  : rows to skip (default 0)
   *   - `limit`   : max rows to return (default 100)
   *
   * Returns `{ total, offset, limit, rows }` where each row is a `RowDTO`:
   * `{ _oL, ...entry }` with the ignored root fields stripped (`msg` is never
   * stripped). `total` is the count matching the filters, ignoring pagination,
   * so the client can drive virtualization.
   */
  router.get("/rows", (req, res) => {
    const parser = requireCurrentParser();

    const wire = parseFilterWire(queryParam(req, "filters"));
    const { filters, ignoredFields } = translateFilters(wire);

    const offset = Math.max(0, parseIntParam(queryParam(req, "offset"), 0));
    const limit = Math.max(
      0,
      parseIntParam(queryParam(req, "limit"), DEFAULT_LIMIT),
    );

    const countQuery = buildCountQuery(filters);
    const total =
      parser.query<{ n: number }>(countQuery.sql, countQuery.params)[0]?.n ?? 0;

    const dataQuery = buildQuery(filters, { limit, offset }, "line, logentry");
    const rows = parser
      .queryEntries<Record<string, unknown>>(dataQuery.sql, dataQuery.params)
      .map(({ line, entry }) => projectRow(line, entry, ignoredFields));

    res.json({ total, offset, limit, rows });
  });

  /**
   * POST /api/log/path — load a log from an absolute local path and make it the
   * current log. Body: `{ "path": "<absolute>" }`. Blocks until the log is
   * parsed (or a valid cache is reused). Returns the load metadata.
   *
   * This reads any local absolute path unrestricted — the tool is a local,
   * single-user utility.
   */
  router.post("/log/path", express.json(), (req, res) => {
    const path = (req.body as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string") {
      throw createError({
        statusCode: 400,
        statusMessage: 'Request body must include a string "path".',
      });
    }
    res.json(loadLogFromPath(path));
  });

  /**
   * POST /api/log/contents — load a log from uploaded bytes (file picker). The
   * bytes are written to a temp file named by their md5, which becomes the log's
   * `path`. The file contents are sent as the raw request body.
   */
  router.post(
    "/log/contents",
    express.raw({ type: () => true, limit: MAX_UPLOAD_SIZE }),
    (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) {
        throw createError({
          statusCode: 400,
          statusMessage: "Request body was empty.",
        });
      }
      res.json(loadLogFromBytes(bytes));
    },
  );

  return router;
}

/**
 * Render errors as JSON. The client composables read `statusMessage` (h3's
 * shape), so keep that key even though there is no h3 anymore.
 */
export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const statusMessage =
    err instanceof HttpError
      ? err.statusMessage
      : err instanceof Error
        ? err.message
        : "Internal server error.";
  if (statusCode >= 500) console.error(err);
  res
    .status(statusCode)
    .json({ statusCode, statusMessage, message: statusMessage });
}

/** Build a RowDTO: original line + entry with ignored fields stripped. */
function projectRow(
  line: number,
  entry: Record<string, unknown>,
  ignoredFields: readonly string[],
): Record<string, unknown> {
  const stripped = new Set(ignoredFields.filter((f) => f !== "msg"));
  const dto: Record<string, unknown> = { _oL: line };
  for (const [key, value] of Object.entries(entry)) {
    if (stripped.has(key)) continue;
    dto[key] = value;
  }
  return dto;
}

/** Read a query parameter as a string (repeated/structured params ignored). */
function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

/** Parse a query-string integer, falling back to a default when absent/NaN. */
function parseIntParam(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
