/**
 * Ignore-file support for `detect-errors`.
 *
 * Line numbers in a Renovate log shift as the log grows, so ignore rules key on
 * stable attributes instead: a required `category`, plus optional `message`
 * glob, optional exact `repository`, an optional human `reason`, and an optional
 * `expires` ISO date. A finding is ignored iff an **active** rule matches on
 * category AND (message glob, if present) AND (repository, if present).
 *
 * Expired rules (past `expires`) are inactive and reported to stderr on load, so
 * a temporary silence surfaces again once its window closes.
 */
import { existsSync, readFileSync } from "node:fs";

/** Default ignore-file location, resolved relative to the current directory. */
export const DEFAULT_IGNORE_FILE = "renovate-log-parser.ignore.json";

/** A single ignore rule as authored in the JSON file. */
export interface IgnoreRule {
  /** Required finding category to silence (e.g. `err-object`). */
  category: string;
  /** Optional glob matched against `finding.message` (`*`/`?` wildcards). */
  message?: string;
  /** Optional exact `repository` match. */
  repository?: string;
  /** Optional human-facing justification (unused by matching). */
  reason?: string;
  /** Optional ISO date; once past, the rule is inactive. */
  expires?: string;
}

/** On-disk ignore-file shape. */
export interface IgnoreFile {
  version: number;
  rules: IgnoreRule[];
}

/** The subset of a finding needed to evaluate ignore rules. */
export interface IgnorableFinding {
  category: string;
  message: string;
  repository?: string;
}

/** Options controlling how the ignore file is loaded. */
export interface LoadIgnoreOptions {
  /** Sink for non-fatal warnings (defaults to `console.error`). */
  warn?: (message: string) => void;
  /** Whether the path was explicitly supplied via `--ignore-file`. */
  explicit?: boolean;
}

/**
 * Load and validate the active ignore rules from a file.
 *
 * A missing file yields an empty rule set (missing file = no rules). Expired
 * rules are dropped with a warning. A malformed file throws (surfaced by the
 * caller as a tool/usage error).
 */
export function loadIgnoreRules(
  path: string,
  options: LoadIgnoreOptions = {},
): IgnoreRule[] {
  const warn = options.warn ?? ((m: string) => console.error(m));

  if (!existsSync(path)) {
    if (options.explicit) {
      warn(`Ignore file not found (continuing with no rules): ${path}`);
    }
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse ignore file ${path}: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const file = parsed as Partial<IgnoreFile>;
  if (!file || typeof file !== "object" || !Array.isArray(file.rules)) {
    throw new Error(
      `Invalid ignore file ${path}: expected an object with a "rules" array.`,
    );
  }

  const now = Date.now();
  const active: IgnoreRule[] = [];
  for (const [index, raw] of file.rules.entries()) {
    const rule = raw as Partial<IgnoreRule>;
    if (!rule || typeof rule.category !== "string" || rule.category === "") {
      throw new Error(
        `Invalid ignore file ${path}: rule #${index} is missing a "category".`,
      );
    }
    if (rule.expires !== undefined && isExpired(rule.expires, now)) {
      warn(
        `Ignore rule for "${rule.category}" expired on ${rule.expires}; it is no longer active.`,
      );
      continue;
    }
    active.push({
      category: rule.category,
      message: rule.message,
      repository: rule.repository,
      reason: rule.reason,
      expires: rule.expires,
    });
  }
  return active;
}

/** True when `expires` is a valid date that lies in the past. */
function isExpired(expires: string, now: number): boolean {
  const ts = Date.parse(expires);
  return !Number.isNaN(ts) && ts < now;
}

/**
 * Return the first active rule that ignores the given finding, or `undefined`.
 * All present rule fields must match; absent fields are wildcards.
 */
export function matchIgnoreRule(
  finding: IgnorableFinding,
  rules: readonly IgnoreRule[],
): IgnoreRule | undefined {
  return rules.find((rule) => {
    if (rule.category !== finding.category) return false;
    if (
      rule.repository !== undefined &&
      rule.repository !== finding.repository
    ) {
      return false;
    }
    if (
      rule.message !== undefined &&
      !globToRegExp(rule.message).test(finding.message)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Compile a glob (`*` = any run, `?` = one char) into an anchored, case-
 * sensitive RegExp — matching the case-sensitive `GLOB` semantics used
 * elsewhere in the tool. All other characters are matched literally.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}
