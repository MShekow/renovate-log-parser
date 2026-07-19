/**
 * QueryBuilder — translates the shared {@link Filter} model into a single
 * parameterized SQL SELECT against the parser's `logs` table.
 *
 * All filters are AND'd (see docs/renovate-log-parser-plan.md, Q4). WHERE
 * fragments reuse the exact `json_extract(...)` expressions that the parser
 * indexes, so the query planner can use those expression indices.
 *
 * The builder never interpolates user values into SQL text; every value is a
 * bound parameter. Glob search is delegated to SQLite `json_tree` + `GLOB`
 * (Q19), with value matches restricted to leaf scalars via `json_tree.atom`.
 */
import {
  extractExpr,
  type Filter,
  type GlobFilter,
  type ScalarValue,
} from "./filters.js";

/** A parameter bound into a prepared statement. */
export type SqlParam = string | number | bigint | null | Uint8Array;

/** A fully-built, parameterized query ready for {@link Parser.query}. */
export interface BuiltQuery {
  sql: string;
  params: SqlParam[];
}

/** Options that shape the SELECT independent of row-matching filters. */
export interface QueryOptions {
  /** Restrict to rows with rowid >= this (original 0-indexed line). */
  lineFrom?: number;
  /** Restrict to rows with rowid <= this (original 0-indexed line). */
  lineTo?: number;
  /** Maximum number of rows to return. */
  limit?: number;
  /** Number of matching rows to skip (for pagination). */
  offset?: number;
  /** Sort direction by rowid (line order). Defaults to ascending. */
  order?: "asc" | "desc";
}

const TABLE = "logs";
const COLUMN = "logentry";
const LEVEL_EXPR = extractExpr("level", COLUMN);

/** Convert a scalar filter value to a bound SQL parameter. */
function scalarParam(value: ScalarValue): SqlParam {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/** Build the WHERE fragment + params for a single filter. */
function buildFilter(filter: Filter): { sql: string; params: SqlParam[] } {
  switch (filter.type) {
    case "equals": {
      const expr = extractExpr(filter.field, COLUMN);
      const param = scalarParam(filter.value);
      // Negation is null-safe: entries missing the field are kept when hiding a
      // specific value (they clearly are not that value).
      const sql = filter.negate
        ? `(${expr} IS NULL OR ${expr} <> ?)`
        : `${expr} = ?`;
      return { sql, params: [param] };
    }
    case "presence": {
      const expr = extractExpr(filter.field, COLUMN);
      const sql = filter.negate ? `${expr} IS NULL` : `${expr} IS NOT NULL`;
      return { sql, params: [] };
    }
    case "levelIn": {
      if (filter.levels.length === 0) {
        // An empty set matches nothing (or, negated, everything).
        return { sql: filter.negate ? "1=1" : "1=0", params: [] };
      }
      const placeholders = filter.levels.map(() => "?").join(", ");
      const params = filter.levels.map((l) => l as SqlParam);
      const sql = filter.negate
        ? `(${LEVEL_EXPR} IS NULL OR ${LEVEL_EXPR} NOT IN (${placeholders}))`
        : `${LEVEL_EXPR} IN (${placeholders})`;
      return { sql, params };
    }
    case "glob":
      return buildGlobFilter(filter);
  }
}

/** Build the `json_tree`-based EXISTS fragment for a glob search. */
function buildGlobFilter(filter: GlobFilter): {
  sql: string;
  params: SqlParam[];
} {
  const keyExpr = "jt.key GLOB ?";
  // Value matches are limited to leaf scalars (atom is NULL for objects/arrays)
  // and cast to text so numeric/boolean atoms are still comparable via GLOB.
  const valueExpr = "(jt.atom IS NOT NULL AND CAST(jt.atom AS TEXT) GLOB ?)";

  let condition: string;
  const params: SqlParam[] = [];

  switch (filter.mode) {
    case "key":
      condition = keyExpr;
      params.push(requirePattern(filter.keyPattern ?? filter.pattern, "key"));
      break;
    case "value":
      condition = valueExpr;
      params.push(
        requirePattern(filter.valuePattern ?? filter.pattern, "value"),
      );
      break;
    case "both": {
      const p = requirePattern(filter.pattern, "both");
      condition = `(${keyExpr} OR ${valueExpr})`;
      params.push(p, p);
      break;
    }
    case "keyValue":
      condition = `(${keyExpr} AND ${valueExpr})`;
      params.push(
        requirePattern(filter.keyPattern, "keyValue.key"),
        requirePattern(filter.valuePattern, "keyValue.value"),
      );
      break;
  }

  const exists = `EXISTS (SELECT 1 FROM json_tree(${TABLE}.${COLUMN}) AS jt WHERE ${condition})`;
  return { sql: filter.negate ? `NOT ${exists}` : exists, params };
}

function requirePattern(pattern: string | undefined, which: string): string {
  if (pattern === undefined || pattern.length === 0) {
    throw new Error(`Glob search requires a non-empty pattern for "${which}".`);
  }
  return pattern;
}

/**
 * Build a parameterized SELECT for the given filters and options.
 *
 * @param filters Row-matching filters, AND'd together.
 * @param options Line range, ordering, and pagination.
 * @param columns SELECT list. Defaults to `rowid, logentry`.
 */
export function buildQuery(
  filters: readonly Filter[] = [],
  options: QueryOptions = {},
  columns = `rowid, ${COLUMN}`,
): BuiltQuery {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  for (const filter of filters) {
    const built = buildFilter(filter);
    clauses.push(built.sql);
    params.push(...built.params);
  }

  if (options.lineFrom !== undefined) {
    clauses.push("rowid >= ?");
    params.push(options.lineFrom);
  }
  if (options.lineTo !== undefined) {
    clauses.push("rowid <= ?");
    params.push(options.lineTo);
  }

  let sql = `SELECT ${columns} FROM ${TABLE}`;
  if (clauses.length > 0) {
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }
  sql += ` ORDER BY rowid ${options.order === "desc" ? "DESC" : "ASC"}`;

  if (options.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(options.limit);
    if (options.offset !== undefined) {
      sql += " OFFSET ?";
      params.push(options.offset);
    }
  }

  return { sql, params };
}

/**
 * Build a `SELECT COUNT(*)` for the given filters (ignores pagination/order),
 * used by the web `total` count.
 */
export function buildCountQuery(
  filters: readonly Filter[] = [],
  options: Pick<QueryOptions, "lineFrom" | "lineTo"> = {},
): BuiltQuery {
  const built = buildQuery(filters, options, "COUNT(*) AS n");
  // Strip the trailing ORDER BY (harmless but pointless for a count).
  built.sql = built.sql.replace(/ ORDER BY rowid (ASC|DESC)$/, "");
  return built;
}
