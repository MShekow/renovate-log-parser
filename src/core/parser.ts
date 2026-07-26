/**
 * Parser — loads a Renovate JSONL log into a cached SQLite database and answers
 * SQL queries against it.
 *
 * Behaviour:
 *  - The cache key is the md5 of the file *content*, stored at
 *    `<os.tmpdir()>/renovate-log-parser-<md5>.db`. Identical logs at different
 *    paths share a cache; a changed file re-parses.
 *  - On every load, orphaned caches (zero rows — e.g. from a crashed parse) are
 *    deleted. Valid caches for other logs are preserved (no TTL/size cap).
 *  - The table has one JSON `logentry` column; `line` is an INTEGER PRIMARY KEY
 *    aliasing rowid and equal to the original 0-indexed file line number.
 *  - Parsing runs in a single transaction, so a crash leaves zero rows (which
 *    the orphan check then rebuilds) rather than a half-populated cache.
 *  - Malformed lines are stored as `{"_parseError":true,"_raw":"…"}`; blank
 *    lines as `{"_blank":true}`, keeping rowid == line number.
 *  - Expression indices back the hot filter fields (level/repository/branch and
 *    err-presence) so QueryBuilder-generated WHERE clauses stay fast.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SqlParam } from "./query-builder.js";

/** Prefix for cache database files in the temp directory. */
const DB_PREFIX = "renovate-log-parser-";
const DB_SUFFIX = ".db";

/** Result of a successful {@link Parser.load}. */
export interface LoadResult {
  /** Absolute path of the source log that was loaded. */
  path: string;
  /** md5 of the source file content (also the cache key). */
  md5: string;
  /** Absolute path of the backing SQLite cache file. */
  dbPath: string;
  /** Total number of log lines (rows) in the database. */
  totalLines: number;
  /** Whether an existing valid cache was reused (vs. freshly parsed). */
  cached: boolean;
}

/** A synthetic entry stored for a line that was not valid JSON. */
export interface ParseErrorEntry {
  _parseError: true;
  _raw: string;
}

/** A synthetic entry stored for a blank line. */
export interface BlankEntry {
  _blank: true;
}

export class Parser {
  private db?: DatabaseSync;
  private info?: LoadResult;

  /** Metadata about the currently-loaded log, or `undefined` if none. */
  get loaded(): LoadResult | undefined {
    return this.info;
  }

  /** The open database handle. Throws if no log has been loaded. */
  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error("No log loaded. Call load() first.");
    }
    return this.db;
  }

  /**
   * Load a log file, reusing a valid cache when possible.
   *
   * @param absolutePath Absolute path to the Renovate JSONL log.
   */
  load(absolutePath: string): LoadResult {
    if (!existsSync(absolutePath)) {
      throw new Error(`Log file not found: ${absolutePath}`);
    }

    const content = readFileSync(absolutePath);
    const md5 = createHash("md5").update(content).digest("hex");
    const dbPath = join(tmpdir(), `${DB_PREFIX}${md5}${DB_SUFFIX}`);

    // Close any previously-opened handle before switching logs.
    this.close();

    // Remove orphaned (zero-row / invalid) caches across the temp dir.
    cleanupOrphans();

    if (existsSync(dbPath) && isValidCache(dbPath)) {
      this.db = new DatabaseSync(dbPath);
      const totalLines = this.countRows();
      this.info = { path: absolutePath, md5, dbPath, totalLines, cached: true };
      return this.info;
    }

    // (Re)build the cache from scratch.
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
    this.db = new DatabaseSync(dbPath);
    const totalLines = this.build(content.toString("utf8"));
    this.info = { path: absolutePath, md5, dbPath, totalLines, cached: false };
    return this.info;
  }

  /** Create the schema, insert every line in a transaction, then index. */
  private build(raw: string): number {
    const db = this.requireDb();
    db.exec(
      "CREATE TABLE logs (line INTEGER PRIMARY KEY, logentry TEXT NOT NULL)",
    );

    const lines = splitLines(raw);
    const insert = db.prepare(
      "INSERT INTO logs (line, logentry) VALUES (?, ?)",
    );

    db.exec("BEGIN");
    try {
      for (const [i, line] of lines.entries()) {
        insert.run(i, normalizeLine(line));
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    // Expression indices matching QueryBuilder's json_extract expressions.
    db.exec(
      "CREATE INDEX idx_level ON logs (json_extract(logentry, '$.level'))",
    );
    db.exec(
      `CREATE INDEX idx_repository ON logs (json_extract(logentry, '$.repository'))`,
    );
    db.exec(
      "CREATE INDEX idx_branch ON logs (json_extract(logentry, '$.branch'))",
    );
    db.exec(
      "CREATE INDEX idx_err ON logs (json_extract(logentry, '$.err')) WHERE json_extract(logentry, '$.err') IS NOT NULL",
    );

    return lines.length;
  }

  private countRows(): number {
    const row = this.requireDb()
      .prepare("SELECT COUNT(*) AS n FROM logs")
      .get() as { n: number };
    return row.n;
  }

  /**
   * Run a SELECT statement and return rows as plain objects.
   *
   * @param sql A SELECT statement.
   * @param params Bound parameters for `?` placeholders.
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): T[] {
    const stmt = this.requireDb().prepare(sql);
    const rows = stmt.all(...params);
    // node:sqlite returns null-prototype objects; normalize to plain objects.
    return rows.map((r) => ({ ...r })) as T[];
  }

  /**
   * Run a SELECT that includes a `logentry` column and return each row's parsed
   * JSON entry alongside its line number.
   */
  queryEntries<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): { line: number; entry: T }[] {
    return this.query<{ line: number; logentry: string }>(sql, params).map(
      (r) => ({ line: r.line, entry: JSON.parse(r.logentry) as T }),
    );
  }

  /** Close the underlying database handle (idempotent). */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = undefined;
      this.info = undefined;
    }
  }
}

/**
 * Split raw file content into lines matching `wc -l` semantics: a single
 * trailing newline does not produce an extra empty line.
 */
function splitLines(raw: string): string[] {
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/** Map one source line to the JSON text stored in the `logentry` column. */
function normalizeLine(line: string): string {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (trimmed.trim().length === 0) {
    return JSON.stringify({ _blank: true } satisfies BlankEntry);
  }
  try {
    JSON.parse(trimmed);
    // Valid JSON: store as-is to preserve exact content.
    return trimmed;
  } catch {
    return JSON.stringify({
      _parseError: true,
      _raw: trimmed,
    } satisfies ParseErrorEntry);
  }
}

/** A cache is valid if it has a `logs` table containing at least one row. */
function isValidCache(dbPath: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM logs").get() as {
      n: number;
    };
    return row.n > 0;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/**
 * Delete orphaned cache files (missing/empty `logs` table) from the temp dir.
 * A currently-targeted cache that is invalid is removed here and rebuilt by the
 * caller; valid caches (including for other logs) are preserved.
 */
function cleanupOrphans(): void {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith(DB_PREFIX) || !name.endsWith(DB_SUFFIX)) continue;
    const full = join(tmpdir(), name);
    if (!isValidCache(full)) {
      try {
        rmSync(full, { force: true });
      } catch {
        // Best-effort cleanup; ignore files we cannot remove.
      }
    }
  }
}
