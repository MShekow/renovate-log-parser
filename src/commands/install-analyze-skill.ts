import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { CommandModule } from "yargs";
import { buildSkillMarkdown, type GhConfig } from "../core/skill-template.js";

/** Where the skill is written, relative to the chosen root. */
const SKILL_SUBPATH = join(".agents", "skills", "renovate-log-analyzer");
const SKILL_FILENAME = "SKILL.md";

type Scope = "local" | "global";

interface InstallSkillArgs {
  scope?: string;
  "with-gh"?: boolean;
  "gh-base-url"?: string;
  "gh-org"?: string;
  "gh-repo"?: string;
  "gh-workflow"?: string;
  yes: boolean;
}

/**
 * `install-analyze-skill` — write (or update) the `renovate-log-analyzer`
 * SKILL.md that teaches an AI coding agent to analyze Renovate logs with the
 * `analyze` command.
 *
 * Answers come from flags when provided; otherwise the command prompts
 * interactively on a TTY. With `--yes` (or on a non-TTY) prompts are skipped and
 * missing required answers are an error.
 *
 * The skill is written to `<root>/.agents/skills/renovate-log-analyzer/SKILL.md`
 * where `<root>` is the current working directory (local) or the user's home
 * directory (global).
 *
 * Exit codes: 0 = success; 2 = tool/usage error (missing required answer, IO).
 */
export const installAnalyzeSkillCommand: CommandModule<
  object,
  InstallSkillArgs
> = {
  command: "install-analyze-skill",
  describe: "Install the renovate-log-analyzer SKILL.md for an AI coding agent",
  builder: (yargs) =>
    yargs
      .option("scope", {
        type: "string",
        choices: ["local", "global"] as const,
        describe:
          "Install location: local (<cwd>/.agents/skills) or global (~/.agents/skills)",
      })
      .option("with-gh", {
        type: "boolean",
        describe:
          "Include a section on fetching Renovate logs from GitHub via the gh CLI",
      })
      .option("gh-base-url", {
        type: "string",
        describe:
          "GitHub Enterprise host for the gh section (e.g. github.example.com); omit for github.com",
      })
      .option("gh-org", {
        type: "string",
        describe: "GitHub organization/owner (gh section)",
      })
      .option("gh-repo", {
        type: "string",
        describe: "Repository name (gh section)",
      })
      .option("gh-workflow", {
        type: "string",
        describe:
          "Filename of the workflow that runs Renovate, e.g. renovate.yml (gh section)",
      })
      .option("yes", {
        type: "boolean",
        default: false,
        describe: "Skip all prompts; fail if a required answer is missing",
      }),
  handler: async (argv) => {
    try {
      const interactive = !argv.yes && stdin.isTTY === true;
      const answers = await resolveAnswers(argv, interactive);

      const root = answers.scope === "global" ? homedir() : process.cwd();
      const dir = resolve(root, SKILL_SUBPATH);
      const file = join(dir, SKILL_FILENAME);
      const updating = existsSync(file);

      const content = buildSkillMarkdown({ gh: answers.gh });
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, content);

      process.stdout.write(
        `${updating ? "Updated" : "Created"} ${file}\n` +
          (answers.gh
            ? `Included GitHub fetch section for ${answers.gh.org}/${answers.gh.repo} ` +
              `(workflow ${answers.gh.workflow}${
                answers.gh.baseUrl ? `, host ${answers.gh.baseUrl}` : ""
              }).\n`
            : ""),
      );
    } catch (err) {
      console.error(`install-analyze-skill: ${(err as Error).message}`);
      process.exitCode = 2;
    }
  },
};

/** The fully-resolved set of answers used to build and place the skill. */
interface ResolvedAnswers {
  scope: Scope;
  gh?: GhConfig;
}

/**
 * Resolve every answer from flags, falling back to interactive prompts when a
 * flag is absent and a TTY is available. When not interactive, a missing
 * required answer throws (tool/usage error).
 */
async function resolveAnswers(
  argv: InstallSkillArgs,
  interactive: boolean,
): Promise<ResolvedAnswers> {
  const rl = interactive
    ? createInterface({ input: stdin, output: stdout })
    : undefined;
  try {
    const scope = await resolveScope(argv.scope, rl);
    const gh = await resolveGh(argv, rl);
    return { scope, gh };
  } finally {
    rl?.close();
  }
}

type Rl = ReturnType<typeof createInterface>;

/** Resolve the install scope (local/global). */
async function resolveScope(
  flag: string | undefined,
  rl: Rl | undefined,
): Promise<Scope> {
  if (flag === "local" || flag === "global") return flag;
  if (flag !== undefined) {
    throw new Error(`Invalid --scope "${flag}". Expected "local" or "global".`);
  }
  if (!rl) {
    throw new Error(
      'Missing --scope (expected "local" or "global"). Provide it as a flag when running non-interactively.',
    );
  }
  const answer = (
    await rl.question("Install the skill locally or globally? [local/global] ")
  )
    .trim()
    .toLowerCase();
  if (answer === "" || answer === "l" || answer === "local") return "local";
  if (answer === "g" || answer === "global") return "global";
  throw new Error(`Invalid choice "${answer}". Expected "local" or "global".`);
}

/**
 * Resolve the optional GitHub-fetch config. `--with-gh` (or an interactive
 * yes/no) gates it; the org/repo/workflow are required once enabled, the base
 * URL is optional.
 */
async function resolveGh(
  argv: InstallSkillArgs,
  rl: Rl | undefined,
): Promise<GhConfig | undefined> {
  const anyGhFlag =
    argv["gh-org"] !== undefined ||
    argv["gh-repo"] !== undefined ||
    argv["gh-workflow"] !== undefined ||
    argv["gh-base-url"] !== undefined;

  let include: boolean;
  if (argv["with-gh"] !== undefined) {
    include = argv["with-gh"];
  } else if (anyGhFlag) {
    // gh details supplied without the boolean gate — treat as opt-in.
    include = true;
  } else if (rl) {
    include = await promptYesNo(
      rl,
      "Include instructions to fetch logs from GitHub via the gh CLI?",
      false,
    );
  } else {
    include = false;
  }

  if (!include) return undefined;

  const org = await resolveRequired(
    argv["gh-org"],
    rl,
    "GitHub organization/owner",
    "--gh-org",
  );
  const repo = await resolveRequired(
    argv["gh-repo"],
    rl,
    "Repository name",
    "--gh-repo",
  );
  const workflow = await resolveRequired(
    argv["gh-workflow"],
    rl,
    "Workflow filename that runs Renovate (e.g. renovate.yml)",
    "--gh-workflow",
  );
  const baseUrl = await resolveOptional(
    argv["gh-base-url"],
    rl,
    "GitHub base URL/host (blank for github.com)",
  );

  return { org, repo, workflow, baseUrl: baseUrl || undefined };
}

/** Resolve a required free-text answer from a flag or a prompt. */
async function resolveRequired(
  flag: string | undefined,
  rl: Rl | undefined,
  label: string,
  flagName: string,
): Promise<string> {
  if (flag !== undefined && flag.trim() !== "") return flag.trim();
  if (!rl) {
    throw new Error(
      `Missing ${flagName} (${label}). Provide it as a flag when running non-interactively.`,
    );
  }
  const answer = (await rl.question(`${label}: `)).trim();
  if (answer === "") throw new Error(`${label} must not be empty.`);
  return answer;
}

/** Resolve an optional free-text answer from a flag or a prompt. */
async function resolveOptional(
  flag: string | undefined,
  rl: Rl | undefined,
  label: string,
): Promise<string> {
  if (flag !== undefined) return flag.trim();
  if (!rl) return "";
  return (await rl.question(`${label}: `)).trim();
}

/** Prompt a yes/no question with a default. */
async function promptYesNo(
  rl: Rl,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`${question} ${hint} `))
    .trim()
    .toLowerCase();
  if (answer === "") return defaultValue;
  return answer === "y" || answer === "yes";
}
