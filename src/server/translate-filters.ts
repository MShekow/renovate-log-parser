/**
 * Translate the web UI's reactive filter object (the `filters` wire format) into
 * the shared {@link Filter} model that the {@link buildQuery} query builder
 * understands.
 *
 * Wire shape (all keys optional):
 * ```jsonc
 * {
 *   "levels": [20, 30, 40],
 *   "repositories": { "mode": "include"|"exclude", "values": [...], "independent": true },
 *   "ignoredFields": ["v", "time", ...],          // response projection, NOT a WHERE clause
 *   "search": { "field": "msg", "pattern": "*abort*" },
 *   "pills": [ { "id": "…", "enabled": true, "filter": { …core Filter… } } ]
 * }
 * ```
 * Disabled pills are dropped. `ignoredFields` is returned separately because it
 * shapes the row projection rather than row matching.
 */
import type { Filter } from "../core/filters.js";
import { createError } from "./http-error.js";

/** Repository include/exclude selection. */
interface RepositoriesSelection {
  mode?: "include" | "exclude";
  values?: unknown;
  independent?: unknown;
}

/** A single dynamic pill wrapping a core Filter with an enable toggle. */
interface Pill {
  id?: string;
  enabled?: boolean;
  filter?: Filter;
}

/** The full reactive filter object sent by the client. */
export interface FilterWire {
  levels?: unknown;
  repositories?: RepositoriesSelection;
  ignoredFields?: unknown;
  search?: { field?: unknown; pattern?: unknown; scope?: unknown };
  pills?: Pill[];
}

/** Result of translating the wire object. */
export interface TranslatedFilters {
  filters: Filter[];
  /** Root keys to strip from each row (`msg` is never strippable). */
  ignoredFields: string[];
}

/** The `repository` root key the repositories selection targets. */
const REPOSITORY_FIELD = "repository";

/**
 * Parse the JSON-encoded `filters` query parameter into a {@link FilterWire}.
 * Returns an empty object for a missing/blank value so an unfiltered request
 * still works; malformed JSON is a 400.
 */
export function parseFilterWire(raw: string | undefined): FilterWire {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid "filters" parameter: not valid JSON.',
    });
  }
  return {};
}

/** Translate the wire object into concrete filters + the projection list. */
export function translateFilters(wire: FilterWire): TranslatedFilters {
  const filters: Filter[] = [];

  // Levels -> a single levelIn filter (empty/absent means "all levels").
  const levels = toNumberArray(wire.levels);
  if (levels.length > 0) {
    filters.push({ type: "levelIn", levels });
  }

  // Repositories -> a single inSet filter with explicit null handling for the
  // "Repository-independent" pseudo-group. include => keep the set; exclude =>
  // hide the set (negated). `independent` toggles whether the no-repository
  // group participates.
  const repo = wire.repositories;
  if (repo && (repo.mode === "include" || repo.mode === "exclude")) {
    const values = toStringArray(repo.values);
    const independent = repo.independent === true;
    // Skip a no-op include of nothing (no set, no independent group).
    if (values.length > 0 || independent) {
      filters.push({
        type: "inSet",
        field: REPOSITORY_FIELD,
        values,
        includeNull: independent,
        negate: repo.mode === "exclude",
      });
    }
  }

  // Free-text search. `scope: 'raw'` searches the whole line (a raw filter);
  // otherwise it is a case-insensitive wildcard (like) filter on one field.
  const search = wire.search;
  if (
    search &&
    typeof search.pattern === "string" &&
    search.pattern.length > 0
  ) {
    if (search.scope === "raw") {
      filters.push({ type: "raw", pattern: search.pattern });
    } else if (typeof search.field === "string" && search.field.length > 0) {
      filters.push({
        type: "like",
        field: search.field,
        pattern: search.pattern,
      });
    }
  }

  // Pills -> their embedded core filters, only when enabled and well-formed.
  for (const pill of wire.pills ?? []) {
    if (pill.enabled === false) continue;
    if (isFilter(pill.filter)) filters.push(pill.filter);
  }

  return { filters, ignoredFields: toStringArray(wire.ignoredFields) };
}

/** Coerce an unknown value into a numeric array (non-numbers dropped). */
function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number");
}

/** Coerce an unknown value into a string array (non-strings dropped). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Structurally validate an embedded pill filter against the core union. */
function isFilter(value: unknown): value is Filter {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  switch (f.type) {
    case "equals":
      return typeof f.field === "string" && isScalar(f.value);
    case "presence":
      return typeof f.field === "string";
    case "like":
      return typeof f.field === "string" && typeof f.pattern === "string";
    case "raw":
      return typeof f.pattern === "string";
    case "levelIn":
      return (
        Array.isArray(f.levels) && f.levels.every((l) => typeof l === "number")
      );
    case "inSet":
      return (
        typeof f.field === "string" &&
        Array.isArray(f.values) &&
        f.values.every(isScalar)
      );
    default:
      return false;
  }
}

/** True for the scalar types accepted by equals/inSet filters. */
function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
