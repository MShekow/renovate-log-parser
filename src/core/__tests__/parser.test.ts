/**
 * Parser tests.
 *
 * STUB: Phase 1 scaffolding. These build a tiny synthetic JSONL file in a temp
 * dir (no committed real log — the sample is private, see
 * docs/renovate-log-parser-plan.md, Q25) and assert the core guarantees:
 * rowid == line number, malformed/blank line handling, and cache reuse.
 * Extend with real fixtures later.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Parser } from "../parser.js";

function writeTempLog(lines: string[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rlp-test-"));
  const path = join(dir, "renovate.jsonl");
  writeFileSync(path, lines.join("\n") + "\n");
  return { dir, path };
}

test("parser maps rowid to 0-indexed line number", () => {
  const { dir, path } = writeTempLog([
    JSON.stringify({ level: 30, msg: "first" }),
    JSON.stringify({ level: 20, msg: "second" }),
  ]);
  const parser = new Parser();
  try {
    const info = parser.load(path);
    assert.equal(info.totalLines, 2);
    const rows = parser.queryEntries<{ msg: string }>(
      "SELECT line, logentry FROM logs ORDER BY rowid",
    );
    assert.equal(rows[0].line, 0);
    assert.equal(rows[0].entry.msg, "first");
    assert.equal(rows[1].line, 1);
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parser stores synthetic entries for blank and malformed lines", () => {
  const { dir, path } = writeTempLog([
    JSON.stringify({ level: 30, msg: "ok" }),
    "",
    "{not valid json",
  ]);
  const parser = new Parser();
  try {
    parser.load(path);
    const rows = parser.queryEntries<Record<string, unknown>>(
      "SELECT line, logentry FROM logs ORDER BY rowid",
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[1].entry._blank, true);
    assert.equal(rows[2].entry._parseError, true);
    assert.equal(rows[2].entry._raw, "{not valid json");
  } finally {
    parser.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parser reuses a valid cache on reload", () => {
  // Unique content per run so the md5 cache key is fresh (the temp-dir cache
  // persists across runs and is keyed by file content).
  const nonce = `${Date.now()}-${Math.random()}`;
  const { dir, path } = writeTempLog([
    JSON.stringify({ level: 30, msg: nonce }),
  ]);
  const first = new Parser();
  const second = new Parser();
  let dbPath: string | undefined;
  try {
    const a = first.load(path);
    dbPath = a.dbPath;
    assert.equal(a.cached, false);
    first.close();
    const b = second.load(path);
    assert.equal(b.cached, true);
    assert.equal(a.md5, b.md5);
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
    if (dbPath) rmSync(dbPath, { force: true });
  }
});

test("parser re-parses (does not reuse a stale cache) when content changes", () => {
  // The cache key is the md5 of the file *content*, so editing the file in
  // place must produce a fresh md5/dbPath and a cache miss — never the old rows.
  const nonce = `${Date.now()}-${Math.random()}`;
  const { dir, path } = writeTempLog([
    JSON.stringify({ level: 30, msg: `first-${nonce}` }),
  ]);
  const first = new Parser();
  const second = new Parser();
  let firstDbPath: string | undefined;
  let secondDbPath: string | undefined;
  try {
    const a = first.load(path);
    firstDbPath = a.dbPath;
    assert.equal(a.cached, false);
    assert.equal(a.totalLines, 1);
    first.close();

    // Overwrite the same path with different (and longer) content.
    writeFileSync(
      path,
      [
        JSON.stringify({ level: 30, msg: `second-${nonce}` }),
        JSON.stringify({ level: 40, msg: `third-${nonce}` }),
      ].join("\n") + "\n",
    );

    const b = second.load(path);
    secondDbPath = b.dbPath;
    // Changed content => new md5, new cache file, and a cache miss.
    assert.notEqual(b.md5, a.md5);
    assert.notEqual(b.dbPath, a.dbPath);
    assert.equal(b.cached, false);
    assert.equal(b.totalLines, 2);

    // The reused handle reflects the new content, not the old cache.
    const rows = second.queryEntries<{ msg: string }>(
      "SELECT line, logentry FROM logs ORDER BY rowid",
    );
    assert.equal(rows[0].entry.msg, `second-${nonce}`);
    assert.equal(rows[1].entry.msg, `third-${nonce}`);
  } finally {
    first.close();
    second.close();
    rmSync(dir, { recursive: true, force: true });
    if (firstDbPath) rmSync(firstDbPath, { force: true });
    if (secondDbPath) rmSync(secondDbPath, { force: true });
  }
});

test("load() deletes orphaned zero-row caches but keeps valid ones", () => {
  // A crashed parse leaves a cache with a `logs` table but zero rows; load()
  // runs cleanupOrphans() and must remove it while preserving valid caches.
  const nonce = `${Date.now()}-${Math.random()}`;
  const { dir, path } = writeTempLog([
    JSON.stringify({ level: 30, msg: `valid-${nonce}` }),
  ]);
  const parser = new Parser();
  const secondParser = new Parser();

  const orphanPath = join(
    tmpdir(),
    `renovate-log-parser-orphan-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}.db`,
  );

  let validDbPath: string | undefined;
  try {
    // First load builds a valid cache for our log.
    const a = parser.load(path);
    validDbPath = a.dbPath;
    parser.close();
    assert.ok(existsSync(validDbPath));

    // Only now plant a valid-but-empty SQLite orphan: same naming scheme, real
    // `logs` table, zero rows — exactly what isValidCache rejects via `n > 0`.
    // (Created after the first load so that load's own cleanup can't pre-empt.)
    const orphanDb = new DatabaseSync(orphanPath);
    orphanDb.exec(
      "CREATE TABLE logs (line INTEGER PRIMARY KEY, logentry TEXT NOT NULL)",
    );
    orphanDb.close();
    assert.ok(existsSync(orphanPath));

    // Second load triggers cleanupOrphans(): the orphan goes, the valid cache
    // (reused as a hit) stays.
    const b = secondParser.load(path);
    assert.equal(b.cached, true);
    assert.equal(existsSync(orphanPath), false);
    assert.ok(existsSync(validDbPath));
  } finally {
    parser.close();
    secondParser.close();
    rmSync(dir, { recursive: true, force: true });
    if (validDbPath) rmSync(validDbPath, { force: true });
    rmSync(orphanPath, { force: true });
  }
});
