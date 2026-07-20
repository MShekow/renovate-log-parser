/**
 * QueryBuilder — translates the shared {@link Filter} model into a single
 * parameterized SQL SELECT against the parser's `logs` table.
 *
 * All filters are AND'd (see docs/renovate-log-parser-plan.md, Q4). WHERE
 * fragments reuse the exact `json_extract(...)` expressions that the parser
 * indexes, so the query planner can use those expression indices.
 *
 * The builder never interpolates user values into SQL text; every value is a
 * bound parameter. Wildcard (`like`) filters compare a single field with a
 * case-insensitive SQLite `LIKE ... ESCAPE` (Q28.1); the `*`-to-`%` translation
 * and escaping happen in {@link globStarToLike}.
 */
import {
  extractExpr,
  globStarToLike,
  type Filter,
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
    case "like": {
      // Case-insensitive wildcard match on one field. CAST to TEXT so numeric/
      // boolean fields are still comparable; `\` escapes LIKE metacharacters.
      const expr = extractExpr(filter.field, COLUMN);
      const text = `CAST(${expr} AS TEXT)`;
      const param = globStarToLike(filter.pattern);
      // Negation is null-safe: entries missing the field are kept when hiding a
      // pattern (they clearly do not match it).
      const sql = filter.negate
        ? `(${expr} IS NULL OR ${text} NOT LIKE ? ESCAPE '\\')`
        : `${text} LIKE ? ESCAPE '\\'`;
      return { sql, params: [param] };
    }
  }
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
