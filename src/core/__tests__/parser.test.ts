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
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

// TODO(Q25): add cache-invalidation-on-content-change and orphan-cleanup tests.
