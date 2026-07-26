/**
 * Analyzer — produces the two token-efficient views the `analyze` command
 * exposes to an AI coding agent:
 *
 *  - {@link Analyzer.stats} — a single pass over the whole log summarising level
 *    counts and per-repository structure (line spans, branches, dependency
 *    inventory, repo problems). Rendered as pretty JSON by the command.
 *  - {@link Analyzer.print} — a filtered, line-ranged, limited slice of the log
 *    projected to JSONL, with ignored root fields stripped. Selection order is
 *    line-range -> filters -> limit, mirroring the source log's order.
 *
 * Repositories are keyed strictly by the root-level `repository` value; entries
 * without one, and git-URL sub-repos whose `repository` is an `https://…` URL
 * (e.g. pre-commit hooks), are excluded from the per-repo view. The dependency
 * inventory is disambiguated strictly by
 * `msg === "packageFiles with updates"`, unioned with root-level
 * `depName`/`packageName` occurrences.
 */
import type { Parser } from "./parser.js";
import type { Filter } from "./filters.js";
import { buildQuery, buildCountQuery } from "./query-builder.js";

/** A parsed log entry (Renovate emits many optional fields). */
type LogEntry = Record<string, unknown>;

/** The `msg` that marks the entry carrying the dependency inventory. */
const PACKAGE_FILES_MSG = "packageFiles with updates";
/** The `msg` that marks the entry carrying `branchesInformation`. */
const BRANCHES_INFO_MSG = "branches info extended";

/** Per-repository structural summary emitted by {@link Analyzer.stats}. */
export interface RepoStats {
  /** The `repository` value verbatim (owner/repo or a git URL). */
  name: string;
  /** rowid (0-indexed line) of this repo's first entry. */
  fromLine: number;
  /** rowid (0-indexed line) of this repo's last entry. */
  toLine: number;
  /** Unique root-level `branch` values, in order of appearance. */
  branches: string[];
  /** rowid of the `branches info extended` entry, or null. */
  branchesInformationLine: number | null;
  /** rowid of the `packageFiles with updates` entry, or null. */
  packageFilesLine: number | null;
  /** Unique `repoProblems` strings, in order of appearance. */
  repoProblems: string[];
  /** Union of root-level `depName` + packageFiles config deps, deduped. */
  depNames: string[];
  /** Union of root-level `packageName` + packageFiles config deps, deduped. */
  packageNames: string[];
}

/** Whole-log statistics emitted in stats mode (pretty JSON). */
export interface AnalyzeStats {
  logFile: string;
  md5: string;
  totalLines: number;
  /** Count of entries per numeric level, keyed by the level as a string. */
  levelCounts: Record<string, number>;
  repos: RepoStats[];
}

/** Options for {@link Analyzer.print}. */
export interface PrintOptions {
  /** Root keys to strip from each entry (`msg` is never strippable). */
  ignoredFields: readonly string[];
  /** Inclusive 0-indexed rowid lower bound. */
  lineFrom?: number;
  /** Inclusive 0-indexed rowid upper bound. */
  lineTo?: number;
  /** Maximum number of lines to emit. */
  limit: number;
  /** Scalar-equals / wildcard filters, AND'd (from `--filter` / `--filter-with-wildcard`). */
  filters: readonly Filter[];
  /** When true, add `_oL` (0-indexed source line) to each emitted object. */
  includeOriginalLine: boolean;
}

/** Result of {@link Analyzer.print}. */
export interface PrintResult {
  /** The stripped entries to write, in line order. */
  entries: Record<string, unknown>[];
  /** Total rows matching range + filters (before the limit). */
  totalMatched: number;
  /** Number of entries actually emitted (== entries.length). */
  emitted: number;
  /** True when the limit capped the result (totalMatched > emitted). */
  truncated: boolean;
}

/** Mutable per-repo accumulator used during the single stats pass. */
interface RepoAccumulator {
  name: string;
  fromLine: number;
  toLine: number;
  branches: Set<string>;
  branchesInformationLine: number | null;
  packageFilesLine: number | null;
  repoProblems: Set<string>;
  depNames: Set<string>;
  packageNames: Set<string>;
}

/**
 * Computes the `analyze` command's stats and print views against an
 * already-loaded {@link Parser}.
 */
export class Analyzer {
  constructor(private readonly parser: Parser) {}

  /** Build the whole-log statistics view (single pass, all repositories). */
  stats(): AnalyzeStats {
    const loaded = this.requireLoaded();

    const rows = this.parser.queryEntries<LogEntry>(
      "SELECT line, logentry FROM logs ORDER BY rowid",
    );

    const levelCounts: Record<string, number> = {};
    const repos = new Map<string, RepoAccumulator>();

    for (const { line, entry } of rows) {
      // Synthetic parser rows (blank / malformed) carry no structural signal.
      if (entry._blank === true || entry._parseError === true) continue;

      if (typeof entry.level === "number") {
        const key = String(entry.level);
        levelCounts[key] = (levelCounts[key] ?? 0) + 1;
      }

      const repository =
        typeof entry.repository === "string" ? entry.repository : undefined;
      // Skip entries with no repository, and git-URL sub-repos (e.g. pre-commit
      // hooks) whose `repository` is an `https://…` URL rather than an
      // `owner/repo` target — they are noise in the per-repo structure view.
      if (repository === undefined || repository.startsWith("https://")) {
        continue;
      }

      let acc = repos.get(repository);
      if (acc === undefined) {
        acc = newAccumulator(repository, line);
        repos.set(repository, acc);
      }
      // Rows arrive in ascending rowid order, so toLine grows monotonically.
      acc.toLine = line;

      if (typeof entry.branch === "string") acc.branches.add(entry.branch);

      if (Array.isArray(entry.repoProblems)) {
        for (const problem of entry.repoProblems) {
          if (typeof problem === "string") acc.repoProblems.add(problem);
        }
      }

      if (typeof entry.depName === "string") acc.depNames.add(entry.depName);
      if (typeof entry.packageName === "string") {
        acc.packageNames.add(entry.packageName);
      }

      if (
        entry.msg === BRANCHES_INFO_MSG &&
        acc.branchesInformationLine === null
      ) {
        acc.branchesInformationLine = line;
      }

      if (entry.msg === PACKAGE_FILES_MSG) {
        if (acc.packageFilesLine === null) acc.packageFilesLine = line;
        collectConfigDeps(entry.config, acc.depNames, acc.packageNames);
      }
    }

    return {
      logFile: loaded.path,
      md5: loaded.md5,
      totalLines: loaded.totalLines,
      levelCounts: sortLevelCounts(levelCounts),
      // Map iteration order is first-appearance order == fromLine ascending.
      repos: [...repos.values()].map(finalizeRepo),
    };
  }

  /** Build the filtered, ranged, limited JSONL slice (print mode). */
  print(options: PrintOptions): PrintResult {
    this.requireLoaded();

    const range = { lineFrom: options.lineFrom, lineTo: options.lineTo };

    const countQuery = buildCountQuery(options.filters, range);
    const totalMatched =
      this.parser.query<{ n: number }>(countQuery.sql, countQuery.params)[0]
        ?.n ?? 0;

    const dataQuery = buildQuery(
      options.filters,
      { ...range, limit: options.limit },
      "line, logentry",
    );
    const rows = this.parser.queryEntries<LogEntry>(
      dataQuery.sql,
      dataQuery.params,
    );

    // `msg` is never strippable, even if the caller lists it.
    const stripped = new Set(
      options.ignoredFields.filter((field) => field !== "msg"),
    );

    const entries = rows.map(({ line, entry }) => {
      const projected: Record<string, unknown> = {};
      if (options.includeOriginalLine) projected._oL = line;
      for (const [key, value] of Object.entries(entry)) {
        if (stripped.has(key)) continue;
        projected[key] = value;
      }
      return projected;
    });

    return {
      entries,
      totalMatched,
      emitted: entries.length,
      truncated: totalMatched > entries.length,
    };
  }

  private requireLoaded() {
    const loaded = this.parser.loaded;
    if (!loaded) {
      throw new Error("No log loaded. Call parser.load() before analysis.");
    }
    return loaded;
  }
}

/** Create a fresh accumulator for a newly-seen repository. */
function newAccumulator(name: string, line: number): RepoAccumulator {
  return {
    name,
    fromLine: line,
    toLine: line,
    branches: new Set(),
    branchesInformationLine: null,
    packageFilesLine: null,
    repoProblems: new Set(),
    depNames: new Set(),
    packageNames: new Set(),
  };
}

/** Convert an accumulator into the immutable {@link RepoStats} shape. */
function finalizeRepo(acc: RepoAccumulator): RepoStats {
  return {
    name: acc.name,
    fromLine: acc.fromLine,
    toLine: acc.toLine,
    branches: [...acc.branches],
    branchesInformationLine: acc.branchesInformationLine,
    packageFilesLine: acc.packageFilesLine,
    repoProblems: [...acc.repoProblems],
    depNames: [...acc.depNames],
    packageNames: [...acc.packageNames],
  };
}

/**
 * Collect dependency and package names from a `packageFiles with updates`
 * `config` object. The documented shape is `config[manager] = PackageFile[]`,
 * each package file carrying a `deps` array of `{ depName, packageName }`.
 * Non-conforming shapes are skipped defensively.
 */
function collectConfigDeps(
  config: unknown,
  depNames: Set<string>,
  packageNames: Set<string>,
): void {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return;
  }
  for (const managerFiles of Object.values(config as Record<string, unknown>)) {
    if (!Array.isArray(managerFiles)) continue;
    for (const packageFile of managerFiles) {
      if (packageFile === null || typeof packageFile !== "object") continue;
      const deps = (packageFile as LogEntry).deps;
      if (!Array.isArray(deps)) continue;
      for (const dep of deps) {
        if (dep === null || typeof dep !== "object") continue;
        const { depName, packageName } = dep as LogEntry;
        if (typeof depName === "string") depNames.add(depName);
        if (typeof packageName === "string") packageNames.add(packageName);
      }
    }
  }
}

/** Re-key the level counts in ascending numeric level order. */
function sortLevelCounts(
  counts: Record<string, number>,
): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(counts).sort((a, b) => Number(a) - Number(b))) {
    sorted[key] = counts[key]!;
  }
  return sorted;
}
