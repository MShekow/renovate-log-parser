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

/**
 * Case-insensitive wildcard match against the **entire raw log line** (the
 * whole `logentry` JSON text), where `*` (and only `*`) is a wildcard. This is
 * the "raw search" the web UI exposes: the user's term is looked for anywhere in
 * the serialized line — in any key or any value — without targeting a field.
 * Translated to a SQLite `LIKE ... ESCAPE` on the `logentry` column by the
 * {@link QueryBuilder}; `*`-to-`%` translation/escaping happens in
 * {@link globStarToLike}.
 */
export interface RawFilter {
  type: "raw";
  /** Raw user pattern where `*` matches any run of characters. */
  pattern: string;
  /** When true, matches entries whose line does NOT match the pattern. */
  negate?: boolean;
}

/**
 * Match log entries whose root-level `field` is one of a set of scalar values.
 *
 * This is the generic, arbitrary-field analogue of {@link LevelFilter} and is
 * primarily used by the web layer to translate a repository include/exclude
 * selection (potentially many values, which needs OR semantics the AND'd
 * {@link EqualsFilter}s cannot express) into a single filter. `includeNull`
 * additionally matches entries where the field is absent (used for the web's
 * "Repository-independent" pseudo-group). All null handling is explicit so the
 * negated form stays predictable (see the {@link QueryBuilder} for the emitted
 * SQL).
 */
export interface InSetFilter {
  type: "inSet";
  field: FieldName;
  values: ScalarValue[];
  /** When true, also match entries where the field is null/absent. */
  includeNull?: boolean;
  /** When true, matches entries NOT covered by the (value set + null) match. */
  negate?: boolean;
}

/** Any supported filter. All filters in a query are AND'd. */
export type Filter =
  | EqualsFilter
  | PresenceFilter
  | LevelFilter
  | LikeFilter
  | RawFilter
  | InSetFilter;

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
  return { type: "equals", field, value: coerceScalar(value) };
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

/** Strict numeric literal: an integer or simple decimal, no leading zeros. */
const NUMERIC_LITERAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Coerce a raw CLI string value to its scalar type so `equals` filters compare
 * against the correctly-typed JSON value.
 *
 * Renovate stores many root fields as numbers (`level`, `pid`, `v`) or booleans,
 * and SQLite never treats a numeric value as equal to a text value — so without
 * this, `--filter level:30` would compare `30 = '30'` and never match.
 *
 * Coercion is deliberately conservative: only `true`/`false` and strict numeric
 * literals are converted. Leading-zero (`007`) and dotted/version-like (`1.2.3`)
 * values stay strings, since those are meaningful string identifiers.
 */
export function coerceScalar(value: string): ScalarValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (NUMERIC_LITERAL.test(value)) return Number(value);
  return value;
}
