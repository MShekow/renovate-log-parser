/**
 * Shared filter model for renovate-log-parser.
 *
 * All three commands (detect-errors, analyze, web) describe the same kinds of
 * filters. They are represented here as a small, closed set of primitives that
 * the {@link QueryBuilder} translates into parameterized SQL. Filters are always
 * AND'd together.
 *
 * Design decisions (see docs/renovate-log-parser-plan.md, Q4/Q19/Q28.1):
 *  - Only root-level JSON keys are addressable in v1 (`$.<key>`), though the
 *    helpers below already build JSON paths so nested support is a non-breaking
 *    extension later.
 *  - `equals` matches scalar (string/number/boolean) values only. Against a
 *    non-scalar value it simply does not match.
 *  - `like` is a simple, case-insensitive wildcard match on a single field
 *    where `*` (and only `*`) is a wildcard. It is translated to a SQLite
 *    `LIKE ... ESCAPE` comparison (see {@link globStarToLike}).
 */

/** Root-level JSON key name (e.g. `repository`, `err`, `msg`). */
export type FieldName = string;

/** Scalar values usable in an `equals` filter. */
export type ScalarValue = string | number | boolean;

/** Match log entries where a root-level `field` equals a scalar `value`. */
export interface EqualsFilter {
  type: "equals";
  field: FieldName;
  value: ScalarValue;
  /** When true, matches entries that do NOT equal the value. */
  negate?: boolean;
}

/** Match log entries where a root-level `field` is present (non-null). */
export interface PresenceFilter {
  type: "presence";
  field: FieldName;
  /** When true, matches entries where the field is absent. */
  negate?: boolean;
}

/** Match log entries whose `level` is in (or, when negated, not in) the set. */
export interface LevelFilter {
  type: "levelIn";
  levels: number[];
  negate?: boolean;
}

/**
 * Case-insensitive wildcard match on a single root-level `field`, where `*`
 * (and only `*`) is a wildcard. Translated to a SQLite `LIKE ... ESCAPE`
 * comparison by the {@link QueryBuilder}. The `pattern` is the raw user glob;
 * {@link globStarToLike} performs the escaping/translation at build time.
 */
export interface LikeFilter {
  type: "like";
  field: FieldName;
  /** Raw user pattern where `*` matches any run of characters. */
  pattern: string;
  /** When true, matches entries that do NOT match the pattern. */
  negate?: boolean;
}

/** Any supported filter. All filters in a query are AND'd. */
export type Filter = EqualsFilter | PresenceFilter | LevelFilter | LikeFilter;

/**
 * Build a SQLite JSON path for a root-level key.
 *
 * Uses `$."key"` quoting so keys containing dots, spaces or reserved characters
 * (common in Renovate logs, e.g. datasource URLs used as keys) are handled
 * safely. Embedded double quotes are escaped per the JSON path grammar.
 */
export function jsonPath(field: FieldName): string {
  const escaped = field.replace(/"/g, '""');
  return `$."${escaped}"`;
}

/** SQL expression that extracts a root-level key from the `logentry` column. */
export function extractExpr(field: FieldName, column = "logentry"): string {
  return `json_extract(${column}, '${jsonPath(field)}')`;
}

/** Parse a `key:val` CLI filter token into an {@link EqualsFilter}. */
export function parseKeyValueFilter(token: string): EqualsFilter {
  const { field, value } = splitKeyValue(token);
  return { type: "equals", field, value };
}

/**
 * Parse a `key:pattern` CLI token into a {@link LikeFilter}, where `*` in the
 * pattern is a wildcard (matching is case-insensitive; see {@link globStarToLike}).
 */
export function parseWildcardFilter(token: string): LikeFilter {
  const { field, value } = splitKeyValue(token);
  return { type: "like", field, pattern: value };
}

/** Split a `key:value` token on its FIRST colon, validating a non-empty key. */
function splitKeyValue(token: string): { field: string; value: string } {
  const idx = token.indexOf(":");
  if (idx === -1) {
    throw new Error(
      `Invalid filter "${token}". Expected the form key:value (e.g. repository:foo/bar).`,
    );
  }
  const field = token.slice(0, idx);
  const value = token.slice(idx + 1);
  if (field.length === 0) {
    throw new Error(`Invalid filter "${token}". The key must not be empty.`);
  }
  return { field, value };
}

/**
 * Translate a simple `*`-only user glob into a SQLite `LIKE` pattern.
 *
 * `LIKE`'s own metacharacters (`%`, `_`) and the escape character (`\`) are
 * escaped so they match literally; then `*` is mapped to `%` (any run of
 * characters). The resulting pattern must be used with `ESCAPE '\'`. Matching
 * is anchored exactly as written — a leading/trailing `*` is required for
 * prefix/suffix/contains behaviour.
 */
export function globStarToLike(pattern: string): string {
  return pattern.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "%");
}
