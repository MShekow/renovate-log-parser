/**
 * Filter model / QueryBuilder tests.
 *
 * STUB: These are scaffolding for Phase 1. Assertions cover the parts that need
 * no log fixture (pure SQL generation). Fill in richer cases once committable
 * real-world log fixtures exist (see docs/renovate-log-parser-plan.md, Q25).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKeyValueFilter, extractExpr } from "../filters.js";
import { buildQuery, buildCountQuery } from "../query-builder.js";

test("parseKeyValueFilter splits on the first colon", () => {
  const f = parseKeyValueFilter("repository:foo/bar:baz");
  assert.equal(f.type, "equals");
  assert.equal(f.field, "repository");
  assert.equal(f.value, "foo/bar:baz");
});

test("parseKeyValueFilter rejects tokens without a colon", () => {
  assert.throws(() => parseKeyValueFilter("nocolon"));
});

test("extractExpr quotes keys with special characters", () => {
  assert.equal(
    extractExpr("dotnet-version"),
    `json_extract(logentry, '$."dotnet-version"')`,
  );
});

test("buildQuery AND's an equals filter and orders by rowid", () => {
  const { sql, params } = buildQuery([
    { type: "equals", field: "repository", value: "foo/bar" },
  ]);
  assert.match(sql, /WHERE json_extract\(logentry, '\$\."repository"'\) = \?/);
  assert.match(sql, /ORDER BY rowid ASC$/);
  assert.deepEqual(params, ["foo/bar"]);
});

test("buildQuery applies line range, limit and offset", () => {
  const { sql, params } = buildQuery([], {
    lineFrom: 5,
    lineTo: 10,
    limit: 50,
    offset: 100,
  });
  assert.match(sql, /rowid >= \? AND rowid <= \?/);
  assert.match(sql, /LIMIT \? OFFSET \?$/);
  assert.deepEqual(params, [5, 10, 50, 100]);
});

test("buildCountQuery drops ORDER BY and selects a count", () => {
  const { sql } = buildCountQuery([{ type: "presence", field: "err" }]);
  assert.match(sql, /SELECT COUNT\(\*\) AS n FROM logs/);
  assert.doesNotMatch(sql, /ORDER BY/);
});

test("negated equals is null-safe", () => {
  const { sql } = buildQuery([
    { type: "equals", field: "repository", value: "x", negate: true },
  ]);
  assert.match(sql, /IS NULL OR .* <> \?/);
});

// TODO(Q25): add QueryBuilder glob-mode cases and level-filter edge cases once
// fixtures are available.
