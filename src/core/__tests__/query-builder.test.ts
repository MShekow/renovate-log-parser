/**
 * Filter model / QueryBuilder tests.
 *
 * STUB: These are scaffolding for Phase 1. Assertions cover the parts that need
 * no log fixture (pure SQL generation). Fill in richer cases once committable
 * real-world log fixtures exist (see docs/renovate-log-parser-plan.md, Q25).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseKeyValueFilter,
  parseWildcardFilter,
  globStarToLike,
  extractExpr,
} from "../filters.js";
import { buildQuery, buildCountQuery } from "../query-builder.js";

test("parseKeyValueFilter splits on the first colon", () => {
  const f = parseKeyValueFilter("repository:foo/bar:baz");
  assert.equal(f.type, "equals");
  assert.equal(f.field, "repository");
  assert.equal(f.value, "foo/bar:baz");
});

test("parseKeyValueFilter coerces numeric and boolean values", () => {
  // Numeric root fields (level/pid/v) are stored as numbers; SQLite won't
  // equate 30 with '30', so the CLI value must be typed.
  assert.equal(parseKeyValueFilter("level:30").value, 30);
  assert.equal(parseKeyValueFilter("x:-3").value, -3);
  assert.equal(parseKeyValueFilter("x:1.5").value, 1.5);
  assert.equal(parseKeyValueFilter("x:0").value, 0);
  assert.equal(parseKeyValueFilter("flag:true").value, true);
  assert.equal(parseKeyValueFilter("flag:false").value, false);
});

test("parseKeyValueFilter keeps identifiers and version-like values as strings", () => {
  assert.equal(
    parseKeyValueFilter("repository:owner/repo").value,
    "owner/repo",
  );
  assert.equal(parseKeyValueFilter("x:007").value, "007"); // leading zero
  assert.equal(parseKeyValueFilter("x:1.2.3").value, "1.2.3"); // dotted version
  assert.equal(parseKeyValueFilter("x:True").value, "True"); // not lowercase bool
});

test("parseKeyValueFilter rejects tokens without a colon", () => {
  assert.throws(() => parseKeyValueFilter("nocolon"));
});

test("parseWildcardFilter builds a like filter, splitting on the first colon", () => {
  const f = parseWildcardFilter("msg:Found match at*");
  assert.equal(f.type, "like");
  assert.equal(f.field, "msg");
  assert.equal(f.pattern, "Found match at*");
});

test("globStarToLike maps * to % and escapes LIKE metacharacters", () => {
  assert.equal(globStarToLike("Found match at*"), "Found match at%");
  // Literal %, _ and \ are escaped; only * becomes a wildcard.
  assert.equal(globStarToLike("100%_*"), "100\\%\\_%");
  assert.equal(globStarToLike("a\\b"), "a\\\\b");
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

test("like filter builds a CAST ... LIKE ? ESCAPE clause", () => {
  const { sql, params } = buildQuery([
    { type: "like", field: "msg", pattern: "Found match at*" },
  ]);
  assert.match(
    sql,
    /CAST\(json_extract\(logentry, '\$\."msg"'\) AS TEXT\) LIKE \? ESCAPE '\\'/,
  );
  assert.deepEqual(params, ["Found match at%"]);
});

test("negated like is null-safe", () => {
  const { sql } = buildQuery([
    { type: "like", field: "msg", pattern: "x*", negate: true },
  ]);
  assert.match(sql, /IS NULL OR .* NOT LIKE \? ESCAPE '\\'/);
});

// TODO(Q25): add level-filter edge cases once fixtures are available.
