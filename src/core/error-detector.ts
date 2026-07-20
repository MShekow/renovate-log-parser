/**
 * ErrorDetector — scans a parsed Renovate log for build-breaking problems and
 * (non-breaking) warnings, producing the stable machine-readable report used by
 * the `detect-errors` command and CI.
 *
 * The category model is fixed (see docs/renovate-log-parser-plan.md, Q6/Q9/Q10):
 * every known category is always present in `counts` (zeros included) so runs
 * diff cleanly over time. Categories are independent — an entry that is both a
 * `level:50` error and carries an `err` object yields two findings — with the
 * sole exception of `repo-problem`, which is de-duplicated against overlapping
 * `warn-log` messages.
 *
 * Detection walks the whole log once (all repositories); findings carry a
 * `repository` when the source entry has one. Line numbers are 0-indexed,
 * matching the parser's rowid == source-line invariant.
 */
import { ERROR_LEVELS, WARN_LEVEL } from "./levels.js";
import type { Parser } from "./parser.js";
import { matchIgnoreRule, type IgnoreRule } from "./ignore-file.js";

/** Ordered list of every known finding category (drives the `counts` map). */
export const CATEGORIES = [
  "host-error-abort",
  "log-error",
  "log-fatal",
  "err-object",
  "config-migration",
  "abandoned-package",
  "warn-log",
  "repo-problem",
  "branch-error",
] as const;

/** A finding category. */
export type Category = (typeof CATEGORIES)[number];

/** Finding severity. */
export type Severity = "error" | "warning";

/** Severity for each category. */
export const SEVERITY: Readonly<Record<Category, Severity>> = {
  "host-error-abort": "error",
  "log-error": "error",
  "log-fatal": "error",
  "err-object": "error",
  "config-migration": "error",
  "abandoned-package": "warning",
  "warn-log": "warning",
  "repo-problem": "warning",
  "branch-error": "warning",
};

/**
 * ⚠ Provisional config-migration detection patterns (Q5). No real
 * "needs migration" sample is available yet; these case-insensitive `msg`
 * patterns and the config-object keys below must be verified against a real log.
 */
export const CONFIG_MIGRATION_MSG_PATTERNS: readonly RegExp[] = [
  /config.*needs migration/i,
  /migration needed/i,
];

/** ⚠ Provisional: presence of any of these root keys signals a migration. */
export const CONFIG_MIGRATION_KEYS: readonly string[] = [
  "migratedConfig",
  "configMigrationCheck",
];

/** The exact `msg` that marks an aborting external-host error. */
const HOST_ERROR_ABORT_MSG = "External host error causing abort";

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

    const rows = this.parser.queryEntries<LogEntry>(
      "SELECT line, logentry FROM logs ORDER BY rowid",
    );

    // First pass: collect every warn-log message so repo-problems that merely
    // echo a level:40 message are not counted twice (Q10).
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

  // host-error-abort — exact message match.
  if (msg === HOST_ERROR_ABORT_MSG) {
    push("host-error-abort", msg, errDetails(entry));
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

  // config-migration — provisional message/key heuristics (⚠ Q5).
  const migrationKey = CONFIG_MIGRATION_KEYS.find(
    (key) => entry[key] !== undefined,
  );
  const migrationPattern = CONFIG_MIGRATION_MSG_PATTERNS.find((re) =>
    re.test(msg),
  );
  if (migrationKey !== undefined || migrationPattern !== undefined) {
    push("config-migration", msg, {
      matchedKey: migrationKey,
      matchedPattern: migrationPattern?.source,
    });
  }

  // warn-log — by level.
  if (level === WARN_LEVEL) push("warn-log", msg);

  // repo-problem — each string, de-duped against warn-log messages.
  if (Array.isArray(entry.repoProblems)) {
    for (const problem of entry.repoProblems) {
      if (typeof problem !== "string") continue;
      if (warnLogMessages.has(problem)) continue;
      push("repo-problem", problem, { problem });
    }
  }

  // branch-error — any branchesInformation[].result === "error".
  if (Array.isArray(entry.branchesInformation)) {
    for (const branch of entry.branchesInformation) {
      if (
        branch !== null &&
        typeof branch === "object" &&
        (branch as LogEntry).result === "error"
      ) {
        const branchName =
          typeof (branch as LogEntry).branchName === "string"
            ? ((branch as LogEntry).branchName as string)
            : "(unknown branch)";
        push("branch-error", branchName, { branchName, result: "error" });
      }
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
