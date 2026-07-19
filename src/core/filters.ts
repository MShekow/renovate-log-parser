/**
 * Shared filter model for renovate-log-parser.
 *
 * All three commands (detect-errors, analyze, web) describe the same kinds of
 * filters. They are represented here as a small, closed set of primitives that
 * the {@link QueryBuilder} translates into parameterized SQL. Filters are always
 * AND'd together.
 *
 * Design decisions (see docs/renovate-log-parser-plan.md, Q4/Q19):
 *  - Only root-level JSON keys are addressable in v1 (`$.<key>`), though the
 *    helpers below already build JSON paths so nested support is a non-breaking
 *    extension later.
 *  - `equals` matches scalar (string/number/boolean) values only. Against a
 *    non-scalar value it simply does not match.
 *  - Glob search uses SQLite `GLOB` semantics (`*` and `?` wildcards,
 *    case-sensitive).
 */

/** Root-level JSON key name (e.g. `repository`, `err`, `msg`). */
export type FieldName = string;

/** Scalar values usable in an `equals` filter. */
export type ScalarValue = string | number | boolean;

/**
 * Which part of the JSON entry a glob search applies to.
 *  - `key`   : match against key names only
 *  - `value` : match against leaf values only
 *  - `both`  : a single pattern matches either a key or a value
 *  - `keyValue` : distinct patterns for key and value (both must match somewhere)
 */
export type GlobSearchMode = "key" | "value" | "both" | "keyValue";

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

/** Free-form glob search over keys and/or values via SQLite `json_tree`. */
export interface GlobFilter {
  type: "glob";
  mode: GlobSearchMode;
  /** Pattern applied to keys (modes `key`, `keyValue`). */
  keyPattern?: string;
  /** Pattern applied to values (modes `value`, `keyValue`). */
  valuePattern?: string;
  /** Single pattern applied to either key or value (mode `both`). */
  pattern?: string;
  negate?: boolean;
}

/** Any supported filter. All filters in a query are AND'd. */
export type Filter = EqualsFilter | PresenceFilter | LevelFilter | GlobFilter;

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
  return { type: "equals", field, value };
}
