import { resolve } from "node:path";
import type { CommandModule } from "yargs";
import { Parser } from "../core/parser.js";
import { Analyzer } from "../core/analyzer.js";
import { parseKeyValueFilter } from "../core/filters.js";

/** Default root keys stripped from print-mode output (Q12). `msg` is never stripped. */
const DEFAULT_IGNORED_FIELDS = "v,time,logContext,pid,hostname,name";

interface AnalyzeArgs {
  path: string;
  print: boolean;
  "ignored-fields": string;
  "line-from"?: number;
  "line-to"?: number;
  limit: number;
  filter?: string[];
  "include-original-line": boolean;
}

/**
 * `analyze <path>` — emit token-efficient structure for an AI coding agent.
 *
 * Without `--print` it prints pretty-JSON whole-log stats (level counts +
 * per-repository structure). With `--print` it streams a filtered, line-ranged,
 * limited JSONL slice to stdout (truncation notices go to stderr so stdout stays
 * clean). See docs/renovate-log-parser-plan.md, Phase 3.
 *
 * Exit codes: 0 = success; 2 = tool/usage error (bad path, unreadable, bad args).
 */
export const analyzeCommand: CommandModule<object, AnalyzeArgs> = {
  command: "analyze <path>",
  describe: "Emit token-efficient structure/stats for an AI coding agent",
  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Path to the Renovate JSONL log",
        demandOption: true,
      })
      .option("print", {
        type: "boolean",
        default: false,
        describe: "Print matching log lines (JSONL) instead of stats",
      })
      .option("ignored-fields", {
        type: "string",
        default: DEFAULT_IGNORED_FIELDS,
        describe:
          "CSV of root keys to strip in print mode (msg never stripped)",
      })
      .option("line-from", {
        type: "number",
        describe: "Inclusive 0-indexed lower line bound (print mode)",
      })
      .option("line-to", {
        type: "number",
        describe: "Inclusive 0-indexed upper line bound (print mode)",
      })
      .option("limit", {
        type: "number",
        default: 50,
        describe: "Max lines to print (print mode)",
      })
      .option("filter", {
        type: "string",
        array: true,
        describe:
          "key:val scalar-equals filter, repeatable, AND'd (print mode)",
      })
      .option("include-original-line", {
        type: "boolean",
        default: false,
        describe: "Add _oL (0-indexed source line) to each printed object",
      }),
  handler: (argv) => {
    const parser = new Parser();
    try {
      const logPath = resolve(process.cwd(), argv.path);
      parser.load(logPath);
      const analyzer = new Analyzer(parser);

      if (argv.print) {
        const filters = (argv.filter ?? []).map(parseKeyValueFilter);
        const result = analyzer.print({
          ignoredFields: splitCsv(argv["ignored-fields"]),
          lineFrom: argv["line-from"],
          lineTo: argv["line-to"],
          limit: argv.limit,
          filters,
          includeOriginalLine: argv["include-original-line"],
        });

        if (result.entries.length > 0) {
          process.stdout.write(
            result.entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
          );
        }
        if (result.truncated) {
          process.stderr.write(
            `Truncated: printed ${result.emitted} of ${result.totalMatched} ` +
              `matching lines (--limit ${argv.limit}).\n`,
          );
        }
      } else {
        const stats = analyzer.stats();
        process.stdout.write(JSON.stringify(stats, null, 2) + "\n");
      }
    } catch (err) {
      // Tool/usage error (bad path, unreadable, bad --filter token, …).
      console.error(`analyze: ${(err as Error).message}`);
      process.exitCode = 2;
    } finally {
      parser.close();
    }
  },
};

/** Split a CSV option value into trimmed, non-empty tokens. */
function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}
