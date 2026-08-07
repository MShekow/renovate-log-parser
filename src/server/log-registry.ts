/**
 * Process-wide log registry for the web backend.
 *
 * The `web` command runs a single long-lived Express process for one user, so we
 * keep every loaded log's open {@link Parser} (and its SQLite handle) in memory
 * keyed by content md5. There is no "current log": the registry holds no pointer
 * and the GET routes name the log they want via a required `md5` request
 * parameter (see {@link getParser}). That keeps the reads stateless, so several
 * browser tabs can each view a different log against the same server without
 * clobbering one another.
 */
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Parser } from "../core/parser.js";
import { extractExpr } from "../core/filters.js";
import { ErrorDetector, type DetectionReport } from "../core/error-detector.js";
import { createError } from "./http-error.js";

/** A single cached, loaded log. */
interface RegistryEntry {
  /** Absolute path of the source log (or the temp file for uploads). */
  path: string;
  /** The open parser / SQLite handle for this log. */
  parser: Parser;
  /**
   * Lazily-computed error-detector report, memoized per entry. A given md5's
   * findings never change, so the first request computes it and later ones reuse
   * it.
   */
  report?: DetectionReport;
}

/** Public metadata returned to the client after a successful load. */
export interface LoadedLogInfo {
  md5: string;
  path: string;
  totalLines: number;
  levelCounts: Record<string, number>;
}

/** md5 -> loaded log. Persists for the lifetime of the server process. */
const registry = new Map<string, RegistryEntry>();

/** Prefix for uploaded-file temp copies (distinct from Parser's cache files). */
const UPLOAD_PREFIX = "renovate-log-parser-upload-";
const UPLOAD_SUFFIX = ".jsonl";

/**
 * Load a log from an absolute filesystem path and register it.
 *
 * @throws {HttpError} when the path is not absolute / missing, or the parse
 *   fails — the route layer maps these to HTTP responses.
 */
export function loadLogFromPath(rawPath: string): LoadedLogInfo {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A "path" is required.',
    });
  }
  if (!isAbsolute(rawPath)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Path must be absolute: ${rawPath}`,
    });
  }
  if (!existsSync(rawPath)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Log file not found: ${rawPath}`,
    });
  }
  return loadInto(rawPath);
}

/**
 * Persist uploaded bytes to a temp file (named by their md5) and load it. The
 * temp copy becomes the log's `path`, mirroring the on-disk load path.
 */
export function loadLogFromBytes(bytes: Uint8Array): LoadedLogInfo {
  if (bytes.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Uploaded file is empty.",
    });
  }
  const md5 = createHash("md5").update(bytes).digest("hex");
  const tempPath = join(tmpdir(), `${UPLOAD_PREFIX}${md5}${UPLOAD_SUFFIX}`);
  if (!existsSync(tempPath)) {
    writeFileSync(tempPath, bytes);
  }
  return loadInto(tempPath);
}

/** Shared load path: reuse the cached parser if present, else parse fresh. */
function loadInto(absolutePath: string): LoadedLogInfo {
  let md5: string;
  let parser: Parser;

  // Reuse an already-open parser whose source path matches (cheap re-select).
  const existing = [...registry.values()].find((e) => e.path === absolutePath);
  if (existing) {
    parser = existing.parser;
    md5 = parser.loaded!.md5;
  } else {
    parser = new Parser();
    let result;
    try {
      result = parser.load(absolutePath);
    } catch (err) {
      parser.close();
      throw createError({
        statusCode: 400,
        statusMessage:
          err instanceof Error ? err.message : "Failed to parse log file.",
      });
    }
    md5 = result.md5;
    registry.set(md5, { path: absolutePath, parser });
  }

  return describe(md5, parser);
}

/**
 * Return the parser for a registered log, or throw a 404 when that md5 is
 * unknown (never loaded, or the server restarted since). The GET routes call
 * this first with the md5 the client asked for.
 */
export function getParser(md5: string): Parser {
  return requireEntry(md5).parser;
}

/**
 * Return the error-detector report for a registered log, computing (and
 * caching) it on first request. Runs without ignore rules — the web surfaces
 * every finding. Throws a 404 for an unknown md5 (via {@link requireEntry}).
 */
export function getFindings(md5: string): DetectionReport {
  const entry = requireEntry(md5);
  if (!entry.report) {
    entry.report = new ErrorDetector(entry.parser).run();
  }
  return entry.report;
}

/**
 * Rebuild the load metadata for an already-registered log. Lets a client that
 * only holds an md5 (e.g. a tab restoring itself from its URL after a reload)
 * recover the full {@link LoadedLogInfo} without re-uploading the file.
 *
 * @throws {HttpError} 404 when the md5 is not registered.
 */
export function getLogInfo(md5: string): LoadedLogInfo {
  return describe(md5, requireEntry(md5).parser);
}

/** Build the client-facing metadata for a loaded parser. */
function describe(md5: string, parser: Parser): LoadedLogInfo {
  const info = parser.loaded!;
  return {
    md5,
    path: info.path,
    totalLines: info.totalLines,
    levelCounts: computeLevelCounts(parser),
  };
}

/** Resolve a registry entry by md5, or throw a 404 when it is not loaded. */
function requireEntry(md5: string): RegistryEntry {
  const entry = registry.get(md5);
  if (!entry) {
    throw createError({
      statusCode: 404,
      statusMessage: `Log ${md5} is not loaded. POST it to /api/log/path or /api/log/contents first.`,
    });
  }
  return entry;
}

/** Count entries per numeric `level` via a single grouped SQL scan. */
export function computeLevelCounts(parser: Parser): Record<string, number> {
  const levelExpr = extractExpr("level");
  const rows = parser.query<{ level: number | null; n: number }>(
    `SELECT ${levelExpr} AS level, COUNT(*) AS n FROM logs GROUP BY ${levelExpr}`,
  );
  const counts: Record<string, number> = {};
  for (const { level, n } of rows) {
    if (typeof level === "number") counts[String(level)] = n;
  }
  // Re-key in ascending numeric level order for a stable, readable response.
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = counts[key]!;
  }
  return sorted;
}
