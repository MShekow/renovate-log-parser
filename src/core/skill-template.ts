/**
 * Skill-template builder — the single source of truth for the
 * `renovate-log-analyzer` SKILL.md that the `install-analyze-skill` command
 * writes into a project (or the user's home).
 *
 * {@link buildSkillMarkdown} is a pure, dependency-free function so it can be
 * unit-tested in isolation and reused anywhere the skill text is needed. The
 * optional GitHub (`gh`) fetch section is emitted only when {@link GhConfig} is
 * provided; a base URL, when given, is threaded onto the `gh` commands as a
 * `GH_HOST=<host>` prefix (the standard way to target a GitHub Enterprise host).
 */

/** GitHub log-fetch configuration embedded into the skill's `gh` section. */
export interface GhConfig {
  /** Optional GitHub (Enterprise) host, e.g. `github.example.com`. */
  baseUrl?: string;
  /** GitHub organization / owner that hosts the repository. */
  org: string;
  /** Repository name (without the owner). */
  repo: string;
  /** Filename of the workflow that runs Renovate, e.g. `renovate.yml`. */
  workflow: string;
}

/** Options controlling the generated skill markdown. */
export interface SkillTemplateOptions {
  /** When set, include the "Fetch logs from GitHub" section. */
  gh?: GhConfig;
}

/** The skill's frontmatter description (kept in sync with its purpose). */
const DESCRIPTION =
  "Analyze Renovate Bot debug logs (JSONL, produced via the LOG_FILE env " +
  "var) token-efficiently. Use when diagnosing why Renovate did or did not " +
  "do something, investigating dependency-dashboard problems, or reading a " +
  "large Renovate log without exhausting the context window.";

/**
 * Build the full `renovate-log-analyzer` SKILL.md text.
 *
 * The output is deterministic for a given {@link SkillTemplateOptions}, ending
 * with a single trailing newline.
 */
export function buildSkillMarkdown(options: SkillTemplateOptions = {}): string {
  const sections: string[] = [
    frontmatter(),
    heading(),
    coreLoop(),
    quickStart(),
    logLevels(),
    statsFields(),
    zeroIndexNote(),
    printMode(),
    workflow(),
    detectErrors(),
  ];

  if (options.gh) sections.push(githubFetch(options.gh));

  sections.push(tips());

  return sections.join("\n").replace(/\n+$/, "") + "\n";
}

/** YAML frontmatter block. */
function frontmatter(): string {
  return `---
name: renovate-log-analyzer
description: ${DESCRIPTION}
license: MIT
---
`;
}

function heading(): string {
  return `# Renovate log analyzer

You are analyzing a **Renovate Bot debug log**: a JSONL file (one JSON object
per line) produced by self-hosted Renovate when run with the \`LOG_FILE\`
environment variable set, or downloaded from the Mend hosted app. These logs are
large (thousands of mostly \`debug\`-level lines) and the useful signal is
usually buried in \`debug\` entries, not \`warn\`/\`error\` ones.

Never open the raw log file directly — it will blow your context window. Instead
use the \`renovate-log-parser analyze\` command, which gives you a compact map of
the log first, then lets you print only the exact line ranges you need.
`;
}

function coreLoop(): string {
  return `## The core loop (do this every time)

1. **Stats** — get the whole-log map (cheap, one small JSON object):
   \`\`\`bash
   npx --yes renovate-log-parser analyze <path-to-log.jsonl>
   \`\`\`
2. **Pick lines** — from the stats, choose the repository and the interesting
   line range or key entries (\`branchesInformationLine\`, \`packageFilesLine\`,
   the repo's \`fromLine\`..\`toLine\`, etc.).
3. **Print** — read only that slice as JSONL, narrowed with filters:
   \`\`\`bash
   npx --yes renovate-log-parser analyze <path-to-log.jsonl> --print \\
     --line-from <N> --line-to <M> --filter <key:value> --limit <K>
   \`\`\`

Repeat 2–3, tightening the range and filters, until you've answered the
question. This keeps token use proportional to what you actually read, not to
the size of the log.
`;
}

function quickStart(): string {
  return `## Quick start

\`\`\`bash
# Whole-log map: level counts + per-repository structure
npx --yes renovate-log-parser analyze renovate.jsonl

# Read a single key entry (e.g. the per-branch summary at line 1132)
npx --yes renovate-log-parser analyze renovate.jsonl --print \\
  --line-from 1132 --line-to 1132 --limit 1

# Read one repo's range, keeping only npm-manager entries, first 20 matches
npx --yes renovate-log-parser analyze renovate.jsonl --print \\
  --line-from 37 --line-to 1146 --filter manager:npm --limit 20

# Find every entry whose msg starts with "Found match" (case-insensitive)
npx --yes renovate-log-parser analyze renovate.jsonl --print \\
  --filter-with-wildcard "msg:Found match*"
\`\`\`
`;
}

function logLevels(): string {
  return `## Log levels (the numbers in \`level\` and \`levelCounts\`)

Renovate uses Bunyan numeric levels. The stats \`levelCounts\` map is keyed by
these numbers:

| \`level\` | Name  | Notes                                              |
| ------- | ----- | -------------------------------------------------- |
| \`10\`    | trace | very verbose                                       |
| \`20\`    | debug | the bulk of the log — most diagnostic signal here  |
| \`30\`    | info  | normal progress                                    |
| \`40\`    | warn  | warnings (also surfaced in \`repoProblems\`)          |
| \`50\`    | error | errors                                             |
| \`60\`    | fatal | fatal errors                                       |

Do not stop at \`warn\`/\`error\`. Renovate frequently records *why* it made a
decision only at \`debug\` (\`20\`). Filter to a level with \`--filter level:20\`
(the value is auto-typed to the number).
`;
}

function statsFields(): string {
  return `## Reading the stats output

Stats mode prints one pretty-JSON object:

- \`logFile\`, \`md5\`, \`totalLines\` — identity and size of the log.
- \`levelCounts\` — number of entries per numeric \`level\` (see the table above).
- \`repos\` — one object per repository Renovate processed, in order of first
  appearance. Each has:

| Field                     | Meaning                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| \`name\`                    | The \`repository\` value (\`owner/repo\`).                                                                                                                                             |
| \`fromLine\` / \`toLine\`     | First / last line for this repo — **0-indexed**. Feed straight into \`--line-from\`/\`--line-to\`.                                                                                     |
| \`branches\`                | Unique \`renovate/*\` branch names seen for this repo.                                                                                                                               |
| \`branchesInformationLine\` | 0-indexed line of the \`branches info extended\` entry (or \`null\`). This **one** line summarizes every branch: PR number, PR title, \`result\` (e.g. \`pr-created\`), and \`upgrades\`. Read it first to see what Renovate actually did per branch. |
| \`packageFilesLine\`        | 0-indexed line of the \`packageFiles with updates\` entry (or \`null\`). Carries the detected dependency/update inventory grouped by manager (npm, docker, nuget, github-actions, …). Read it to see what updates Renovate found. |
| \`repoProblems\`            | The warning strings Renovate posts to the repo's **Dependency Dashboard** issue (e.g. ignored custom registries, unicode warnings). These are the subtle problems that often go unnoticed — inspect them.                       |
| \`depNames\`                | Dependency names seen (root-level \`depName\` unioned with the \`packageFiles\` config).                                                                                              |
| \`packageNames\`            | Package names seen (root-level \`packageName\` unioned with the \`packageFiles\` config).                                                                                             |

If \`branchesInformationLine\` or \`packageFilesLine\` is \`null\`, that entry was not
emitted for the repo (often a sign Renovate bailed early — check \`repoProblems\`
and the repo's line range for errors).
`;
}

function zeroIndexNote(): string {
  return `## Line numbers are 0-indexed

Every line reference is **0-indexed** and they all agree with each other:
\`fromLine\`, \`toLine\`, \`branchesInformationLine\`, \`packageFilesLine\`, the
\`--line-from\` / \`--line-to\` bounds (both inclusive), and the \`_oL\` field added
by \`--include-original-line\`. So a \`branchesInformationLine\` of \`1132\` is read
with \`--line-from 1132 --line-to 1132\`.
`;
}

function printMode(): string {
  return `## Print mode reference

\`--print\` streams matching entries as JSONL to stdout (one object per line).
Rows are selected in the order: **line range → filters → limit** (first N in
line order). A truncation notice (when \`--limit\` caps the result) is written to
**stderr**, so stdout stays a clean, pipeable JSONL stream.

| Option                     | Effect                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| \`--line-from\` / \`--line-to\` | Inclusive 0-indexed line bounds.                                                                                            |
| \`--filter key:value\`        | Exact match on a root-level key. Repeatable, AND'd. Value is **auto-typed**: \`level:30\` matches the number \`30\`, \`true\`/\`false\` become booleans; \`007\` / \`1.2.3\` stay strings. |
| \`--filter-with-wildcard key:pat\` | Case-insensitive wildcard match where \`*\` = any run of characters (only \`*\` is special). Anchored as written — use leading/trailing \`*\` for contains, e.g. \`msg:*lock file*\`. Repeatable, AND'd. |
| \`--limit N\`                 | Max lines to print (default \`50\`).                                                                                          |
| \`--ignored-fields csv\`      | Root keys to strip from output (default \`v,time,logContext,pid,hostname,name\`; \`msg\` is never stripped).                     |
| \`--include-original-line\`   | Add \`_oL\` (the 0-indexed source line) to each printed object — handy to pinpoint an entry for a follow-up query.            |

Useful root keys to filter on: \`level\`, \`repository\`, \`branch\`, \`manager\`,
\`depName\`, \`packageName\`, \`msg\`, \`err\`.
`;
}

function workflow(): string {
  return `## Suggested investigation workflow

1. Run **stats**. Note \`totalLines\`, \`levelCounts\`, and each repo's range.
2. For the repo in question, print its \`branchesInformationLine\` — this tells
   you the outcome for every branch/PR in one line.
3. Print its \`repoProblems\` context and any \`level:40\`/\`50\`/\`60\` lines within
   the repo's range to catch surfaced issues.
4. To understand a specific decision ("why no PR for X?"), filter within the
   repo range by \`depName\`/\`packageName\` and read the surrounding \`debug\`
   (\`level:20\`) lines — that is where Renovate explains itself.
5. Use \`--include-original-line\` to get \`_oL\`, then zoom into a tiny
   \`--line-from\`/\`--line-to\` window around it for full context.
`;
}

function detectErrors(): string {
  return `## Tip: deterministic first pass

For a quick, deterministic scan of build-breaking problems and warnings before
manual analysis, run:

\`\`\`bash
npx --yes renovate-log-parser detect-errors <path-to-log.jsonl>
\`\`\`

It surfaces host-error aborts, config migrations, abandoned packages, \`err\`
objects, and \`repoProblems\` — a good starting list of what to investigate with
\`analyze\`.
`;
}

/**
 * The optional GitHub-fetch section. When {@link GhConfig.baseUrl} is set, every
 * `gh` command is prefixed with `GH_HOST=<host>` to target a GHES host.
 */
function githubFetch(gh: GhConfig): string {
  const host = gh.baseUrl?.trim();
  const prefix = host ? `GH_HOST=${host} ` : "";
  const repoRef = `${gh.org}/${gh.repo}`;
  const hostNote = host
    ? `This repository is hosted on GitHub Enterprise at \`${host}\`, so every ` +
      `\`gh\` command is prefixed with \`GH_HOST=${host}\` (ensure you have run ` +
      `\`gh auth login --hostname ${host}\` once).`
    : `Ensure you are authenticated with \`gh auth status\`.`;

  return `## Fetch the log from GitHub (via \`gh\`)

The Renovate log for \`${repoRef}\` is produced by the \`${gh.workflow}\` GitHub
Actions workflow, which uploads it as a build artifact. ${hostNote}

1. Find recent Renovate runs:
   \`\`\`bash
   ${prefix}gh run list --workflow ${gh.workflow} -R ${repoRef} --limit 10
   \`\`\`
2. Download the artifact(s) from the run you want (use the run ID from step 1):
   \`\`\`bash
   ${prefix}gh run download <run-id> -R ${repoRef} --dir ./renovate-log
   \`\`\`
   Omit \`-n <artifact-name>\` to download all artifacts; add it to fetch a
   specific one if the run publishes several. List a run's artifacts with
   \`${prefix}gh run view <run-id> -R ${repoRef}\`.
3. Locate the JSONL log inside \`./renovate-log\` and analyze it with the core
   loop above:
   \`\`\`bash
   npx --yes renovate-log-parser analyze ./renovate-log/<log-file>.jsonl
   \`\`\`
`;
}

function tips(): string {
  return `## Reminders

- Always start with stats; never \`cat\`/read the whole log.
- Most answers live in \`debug\` (\`level:20\`) lines — don't ignore them.
- All line numbers are 0-indexed and inclusive.
- Keep \`--limit\` small and widen only when needed; truncation is reported on
  stderr.
`;
}
