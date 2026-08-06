/**
 * ErrorDetector — scans a parsed Renovate log for build-breaking problems and
 * (non-breaking) warnings, producing the stable machine-readable report used by
 * the `detect-errors` command and CI.
 *
 * The category model is fixed: every known category is always present in
 * `counts` (zeros included) so runs diff cleanly over time. Categories are independent — an entry that is both a
 * `level:50` error and carries an `err` object yields two findings — with the
 * sole exception of `repo-problem`, which is de-duplicated against overlapping
 * `log-warn` messages.
 *
 * Detection walks the whole log once (all repositories); findings carry a
 * `repository` when the source entry has one. Line numbers are 0-indexed,
 * matching the parser's rowid == source-line invariant.
 *
 * The error/warning split is scoped to problems Renovate would *not* otherwise
 * surface in a PR comment: `host-error-abort`, `log-error`, `log-fatal`,
 * `config-migration`, `invalid-config`, and `abandoned-package` are errors
 * (exit 1); `log-warn`, `err-object`, and `repo-problem` are warnings.
 */
import { ERROR_LEVELS, WARN_LEVEL } from "./levels.js";
import type { Parser } from "./parser.js";
import { matchIgnoreRule, type IgnoreRule } from "./ignore-file.js";
import { buildQuery } from "./query-builder.js";
import type { Filter } from "./filters.js";

/** Ordered list of every known finding category (drives the `counts` map). */
export const CATEGORIES = [
  "host-error-abort",
  "log-warn",
  "log-error",
  "log-fatal",
  "err-object",
  "config-migration",
  "invalid-config",
  "abandoned-package",
  "repo-problem",
] as const;

/** A finding category. */
export type Category = (typeof CATEGORIES)[number];

/** Finding severity. */
export type Severity = "error" | "warning";

/** Severity for each category. */
export const SEVERITY: Readonly<Record<Category, Severity>> = {
  "host-error-abort": "error",
  "log-warn": "warning",
  "log-error": "error",
  "log-fatal": "error",
  "err-object": "warning",
  "config-migration": "error",
  "invalid-config": "error",
  "abandoned-package": "error",
  "repo-problem": "warning",
};

/** The `msg` that marks a per-repository run summary. */
const REPOSITORY_FINISHED_MSG = "Repository finished";

/** The `result` on a "Repository finished" entry that signals an aborting host error. */
const HOST_ERROR_RESULT = "external-host-error";

/** The exact `msg` that marks a required config migration. */
const CONFIG_MIGRATION_MSG = "Config migration necessary";

/**
 * The exact `msg` Renovate logs when a repository's own Renovate config could
 * not be used — either because the file is not parseable, or because it parses
 * but fails schema validation. Both cases abort the repository during `init`,
 * so nothing is extracted, looked up or updated.
 */
const INVALID_CONFIG_MSG = "Repository has invalid config";

/** The exact `msg` that carries abandoned-package statistics. */
const ABANDONED_PACKAGE_MSG = "Abandoned package statistics";

/** A single detected problem. */
export interface Finding {
  category: Category;
  severity: Severity;
  /** Human-facing message; also the target of ignore-rule message globs. */
  message: string;
  /** 0-indexed source line (parser rowid). */
  line: number;
  /** Repository the entry belongs to, when present. */
  repository?: string;
  /** Category-specific extra context. */
  details?: Record<string, unknown>;
  /** True when an active ignore rule suppressed this finding. */
  ignored: boolean;
}

/** The machine-readable report (schema v1). */
export interface DetectionReport {
  version: 1;
  logFile: string;
  logMd5: string;
  generatedAt: string;
  exitCode: number;
  summary: { errorCount: number; warningCount: number };
  counts: Record<Category, number>;
  findings: Finding[];
}

/** Options for {@link ErrorDetector.run}. */
export interface DetectOptions {
  /** Active ignore rules (already filtered for expiry). */
  ignoreRules?: readonly IgnoreRule[];
  /** When true, non-ignored warnings also force a non-zero exit code. */
  failOnWarn?: boolean;
}

/** A parsed log entry (shape is loose; Renovate emits many optional fields). */
type LogEntry = Record<string, unknown>;

/**
 * Detects problems in a loaded {@link Parser}. Construct with an already-loaded
 * parser, then call {@link run}.
 */
export class ErrorDetector {
  constructor(private readonly parser: Parser) {}

  /** Run detection and build the report. */
  run(options: DetectOptions = {}): DetectionReport {
    const loaded = this.parser.loaded;
    if (!loaded) {
      throw new Error("No log loaded. Call parser.load() before detection.");
    }

    // Fetch only rows that can yield a finding, instead of scanning
    // the ENTIRE log (hogging memory). QueryBuilder AND's filters, so the disjunction
    // of finding predicates is expressed as separate queries, merged by line.
    const filterGroups: Filter[][] = [
      [{ type: "levelIn", levels: [WARN_LEVEL, ...ERROR_LEVELS] }],
      [{ type: "presence", field: "err" }],
      [{ type: "presence", field: "repoProblems" }],
      [
        {
          type: "inSet",
          field: "msg",
          values: [
            REPOSITORY_FINISHED_MSG,
            CONFIG_MIGRATION_MSG,
            INVALID_CONFIG_MSG,
            ABANDONED_PACKAGE_MSG,
          ],
        },
      ],
    ];

    // A row can match more than one group (e.g. a level:50 entry that also
    // carries an `err`), so dedupe by line before walking.
    const byLine = new Map<number, LogEntry>();
    for (const filters of filterGroups) {
      const { sql, params } = buildQuery(
        filters,
        { order: "asc" },
        "line, logentry",
      );
      for (const { line, entry } of this.parser.queryEntries<LogEntry>(
        sql,
        params,
      )) {
        byLine.set(line, entry);
      }
    }
    const rows = [...byLine.entries()]
      .sort(([a], [b]) => a - b)
      .map(([line, entry]) => ({ line, entry }));

    // First pass: collect every log-warn message so repo-problems that merely
    // echo a level:40 message are not counted twice.
    const warnLogMessages = new Set<string>();
    for (const { entry } of rows) {
      if (entry.level === WARN_LEVEL && typeof entry.msg === "string") {
        warnLogMessages.add(entry.msg);
      }
    }

    const findings: Finding[] = [];
    for (const { line, entry } of rows) {
      collectFindings(entry, line, warnLogMessages, findings);
    }

    // Apply ignore rules.
    const rules = options.ignoreRules ?? [];
    for (const finding of findings) {
      finding.ignored =
        rules.length > 0 && matchIgnoreRule(finding, rules) !== undefined;
    }

    const counts = emptyCounts();
    let errorCount = 0;
    let warningCount = 0;
    for (const finding of findings) {
      counts[finding.category] += 1;
      if (finding.ignored) continue;
      if (finding.severity === "error") errorCount += 1;
      else warningCount += 1;
    }

    const exitCode =
      errorCount > 0 || (options.failOnWarn === true && warningCount > 0)
        ? 1
        : 0;

    return {
      version: 1,
      logFile: loaded.path,
      logMd5: loaded.md5,
      generatedAt: new Date().toISOString(),
      exitCode,
      summary: { errorCount, warningCount },
      counts,
      findings,
    };
  }
}

/** Build a counts map with every category initialised to zero. */
function emptyCounts(): Record<Category, number> {
  const counts = {} as Record<Category, number>;
  for (const category of CATEGORIES) counts[category] = 0;
  return counts;
}

/** Apply every detection rule to a single entry, appending to `findings`. */
function collectFindings(
  entry: LogEntry,
  line: number,
  warnLogMessages: ReadonlySet<string>,
  findings: Finding[],
): void {
  // Synthetic parser rows (blank / malformed lines) carry no signal.
  if (entry._blank === true || entry._parseError === true) return;

  const repository =
    typeof entry.repository === "string" ? entry.repository : undefined;
  const msg = typeof entry.msg === "string" ? entry.msg : "";
  const level = typeof entry.level === "number" ? entry.level : undefined;

  const push = (
    category: Category,
    message: string,
    details?: Record<string, unknown>,
  ): void => {
    findings.push({
      category,
      severity: SEVERITY[category],
      message,
      line,
      ...(repository !== undefined ? { repository } : {}),
      ...(details !== undefined ? { details } : {}),
      ignored: false,
    });
  };

  // host-error-abort — a "Repository finished" summary aborted by a host error.
  if (msg === REPOSITORY_FINISHED_MSG && entry.result === HOST_ERROR_RESULT) {
    push("host-error-abort", msg, { result: entry.result });
  }

  // log-error / log-fatal — by level.
  if (level === ERROR_LEVELS[0]) push("log-error", msg, errDetails(entry));
  if (level === ERROR_LEVELS[1]) push("log-fatal", msg, errDetails(entry));

  // err-object — a root-level `err` object.
  const err = entry.err;
  if (err !== null && typeof err === "object" && !Array.isArray(err)) {
    const errMessage =
      msg !== ""
        ? msg
        : typeof (err as LogEntry).message === "string"
          ? ((err as LogEntry).message as string)
          : "error";
    push("err-object", errMessage, { err });
  }

  // config-migration — exact message plus the old/new config pair.
  if (
    msg === CONFIG_MIGRATION_MSG &&
    entry.oldConfig !== undefined &&
    entry.newConfig !== undefined
  ) {
    push("config-migration", msg, { keys: ["oldConfig", "newConfig"] });
  }

  // invalid-config — the repository's Renovate config could not be parsed or
  // validated, so the run aborted during `init` without doing any work.
  if (msg === INVALID_CONFIG_MSG) {
    push("invalid-config", msg, validationDetails(entry));
  }

  // abandoned-package — one finding per package, keyed as `datasource:package`.
  // The entry carries datasource-named objects (e.g. `npm`, `crate`) mapping a
  // package name to its last-update timestamp; string/number metadata fields are
  // skipped by only descending into plain-object root values.
  if (msg === ABANDONED_PACKAGE_MSG) {
    for (const [datasource, group] of Object.entries(entry)) {
      if (group === null || typeof group !== "object" || Array.isArray(group)) {
        continue;
      }
      for (const [pkg, lastUpdated] of Object.entries(group as LogEntry)) {
        push("abandoned-package", `${datasource}:${pkg}`, {
          datasource,
          package: pkg,
          lastUpdated,
        });
      }
    }
  }

  // log-warn — by level.
  if (level === WARN_LEVEL) push("log-warn", msg);

  // repo-problem — each string, de-duped against log-warn messages.
  if (Array.isArray(entry.repoProblems)) {
    for (const problem of entry.repoProblems) {
      if (typeof problem !== "string") continue;
      if (warnLogMessages.has(problem)) continue;
      push("repo-problem", problem, { problem });
    }
  }
}

/** Extract an `{ err }` details object when the entry carries one. */
function errDetails(entry: LogEntry): Record<string, unknown> | undefined {
  const err = entry.err;
  if (err !== null && typeof err === "object" && !Array.isArray(err)) {
    return { err };
  }
  return undefined;
}

/**
 * Lift the config-validation fields off an entry's `err` object.
 *
 * Only the three `validation*` fields are kept, deliberately: they name the
 * offending file and say what is wrong with it, which is the actionable part.
 * The full `err` (including its multi-line `stack`) is already carried by the
 * `err-object` finding produced for the very same line.
 */
function validationDetails(
  entry: LogEntry,
): Record<string, unknown> | undefined {
  const err = entry.err;
  if (err === null || typeof err !== "object" || Array.isArray(err)) {
    return undefined;
  }
  const details: Record<string, unknown> = {};
  for (const field of [
    "validationSource",
    "validationError",
    "validationMessage",
  ]) {
    const value = (err as LogEntry)[field];
    if (typeof value === "string") details[field] = value;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}
