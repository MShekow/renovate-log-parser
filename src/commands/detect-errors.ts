import { resolve, isAbsolute } from "node:path";
import { writeFileSync } from "node:fs";
import type { CommandModule } from "yargs";
import { Parser } from "../core/parser.js";
import {
  ErrorDetector,
  SEVERITY,
  type DetectionReport,
  type Finding,
} from "../core/error-detector.js";
import { loadIgnoreRules, DEFAULT_IGNORE_FILE } from "../core/ignore-file.js";

interface DetectErrorsArgs {
  path: string;
  out?: string;
  "ignore-file"?: string;
  "fail-on-warn": boolean;
}

/**
 * `detect-errors <path>` — deterministically scan a Renovate JSONL log for
 * build-breaking problems (exit 1) and warnings, optionally writing a stable
 * machine-readable JSON report.
 *
 * Exit codes: 0 = no non-ignored errors; 1 = ≥1 non-ignored error (or, with
 * `--fail-on-warn`, ≥1 non-ignored warning); 2 = tool/usage error.
 */
export const detectErrorsCommand: CommandModule<object, DetectErrorsArgs> = {
  command: "detect-errors <path>",
  describe: "Detect build-breaking problems in a Renovate log (CI-friendly)",
  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Path to the Renovate JSONL log",
        demandOption: true,
      })
      .option("out", {
        type: "string",
        describe: "Also write the machine-readable JSON report to this path",
      })
      .option("ignore-file", {
        type: "string",
        describe: `Ignore-rules file (default: ./${DEFAULT_IGNORE_FILE})`,
      })
      .option("fail-on-warn", {
        type: "boolean",
        default: false,
        describe: "Make warning findings affect the exit code",
      }),
  handler: (argv) => {
    const parser = new Parser();
    try {
      const logPath = resolve(process.cwd(), argv.path);

      const ignorePathArg = argv["ignore-file"];
      const explicitIgnore = ignorePathArg !== undefined;
      const ignorePath = explicitIgnore
        ? isAbsolute(ignorePathArg)
          ? ignorePathArg
          : resolve(process.cwd(), ignorePathArg)
        : resolve(process.cwd(), DEFAULT_IGNORE_FILE);

      const ignoreRules = loadIgnoreRules(ignorePath, {
        explicit: explicitIgnore,
      });

      parser.load(logPath);
      const report = new ErrorDetector(parser).run({
        ignoreRules,
        failOnWarn: argv["fail-on-warn"],
      });

      if (argv.out) {
        const outPath = isAbsolute(argv.out)
          ? argv.out
          : resolve(process.cwd(), argv.out);
        writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
      }

      process.stdout.write(renderHumanSummary(report));
      process.exitCode = report.exitCode;
    } catch (err) {
      // Tool/usage error (bad path, unreadable, malformed ignore file, …).
      console.error(`detect-errors: ${(err as Error).message}`);
      process.exitCode = 2;
    } finally {
      parser.close();
    }
  },
};

/** Format a finding as a single human-readable line. */
function formatFinding(finding: Finding): string {
  const location =
    finding.repository !== undefined
      ? `line ${finding.line}, ${finding.repository}`
      : `line ${finding.line}`;
  return `  [${finding.category}] ${finding.message} (${location})`;
}

/**
 * Render the human summary for stdout: findings grouped by severity, with
 * ignored findings under their own section. Ignored findings are excluded from
 * the headline counts.
 */
function renderHumanSummary(report: DetectionReport): string {
  const lines: string[] = [];
  lines.push(`Renovate log: ${report.logFile}`);

  const { errorCount, warningCount } = report.summary;
  lines.push(
    `${plural(errorCount, "error")}, ${plural(warningCount, "warning")}`,
  );

  const active = report.findings.filter((f) => !f.ignored);
  const errors = active.filter((f) => SEVERITY[f.category] === "error");
  const warnings = active.filter((f) => SEVERITY[f.category] === "warning");
  const ignored = report.findings.filter((f) => f.ignored);

  if (errors.length > 0) {
    lines.push("", "Errors:");
    for (const f of errors) lines.push(formatFinding(f));
  }
  if (warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const f of warnings) lines.push(formatFinding(f));
  }
  if (ignored.length > 0) {
    lines.push("", `Ignored (${ignored.length}):`);
    for (const f of ignored) lines.push(formatFinding(f));
  }
  if (errors.length === 0 && warnings.length === 0) {
    lines.push("", "No problems detected.");
  }

  return lines.join("\n") + "\n";
}

/** Pluralise a count/noun pair. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
