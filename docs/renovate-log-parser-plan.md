# renovate-log-parser — Implementation Plan

> Single source of truth for implementing `renovate-log-parser`. Every agent session
> should read this file first. Decisions below were agreed in a requirements
> interview and should not be re-litigated without updating this doc.

## Purpose

A CLI that parses Renovate Bot debug logs (JSONL) to:

1. **`detect-errors`** — deterministically find build-breaking problems in CI (exit 1).
2. **`analyze`** — emit token-efficient structure/stats for an AI coding agent.
3. **`web`** — a Nuxt UI for interactive, filtered log exploration.

---

## Architecture overview

Shared core in **`src/core/`**, consumed natively by the CLI (`tsc`) and by the Nitro
server via an alias so it's inlined into `web/.output`. Storage via **`node:sqlite`**
(built-in, Node ≥26, no experimental flag needed). One canonical filter model powers
all three commands.

```
src/
  cli.ts                     # yargs entry (exists)
  commands/
    detect-errors.ts         # replace stub
    analyze.ts               # new
    web.ts                   # exists; add ?log= handoff support
  core/
    parser.ts                # Parser: load() + query()
    query-builder.ts         # QueryBuilder: filter model -> SQL
    error-detector.ts        # ErrorDetector
    analyzer.ts              # Analyzer (stats + --print)
    filters.ts               # shared filter types + JSON-path helpers
    levels.ts                # level -> symbol/color metadata
    ignore-file.ts           # detect-errors ignore rules
  core/__tests__/            # node:test stubs
web/
  server/api/log/path.post.ts
  server/api/log/contents.post.ts
  server/api/rows.get.ts
  server/api/fields.get.ts
  server/api/repositories.get.ts
  server/utils/log-registry.ts   # stateful singleton
  app/pages/index.vue            # main viewer
  app/components/                # LogRow, DetailsPanel, JsonTree, filter controls, pills
  app/composables/useFilters.ts  # reactive filter state
.agents/skills/renovate-log-analyzer/SKILL.md
```

---

## Log structure reference (from real-world sample analysis)

- JSONL, one JSON object per line. Order of entries is sufficient (`time` ignorable).
- Ignorable root keys: `name` (always "renovate"), `hostname`, `pid`, `logContext`, `v`, `time`.
- Levels: `10` trace, `20` debug, `30` info, `40` warn, `50` error, `60` fatal.
- Key root fields: `level`, `msg`, `repository`, `branch`, `branchesInformation` (array
  of `{branchName, result, upgrades}`; `result` ∈ pr-created/pending/no-work/done/
  already-existed/error/…), `err` (object), `repoProblems` (string[]), `depName`,
  `packageName`.
- `repository` may be `owner/repo` **or** a git URL (e.g. pre-commit sub-repos). Many
  lines have no `repository`.
- Dependency inventory lives in the entry where `msg === "packageFiles with updates"`,
  under `config` (keyed by package manager). `config` also appears elsewhere (e.g.
  `msg === "File config"`) — must be disambiguated strictly by `msg`.

---

## Decisions (Q# -> decision -> rationale)

| Q    | Decision                                                                                                                                                                                                                                                            | Rationale                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | Storage via **`node:sqlite`** (built-in), used by CLI + server                                                                                                                                                                                                      | Zero deps, no native build, present on Node ≥26                                            |
| 2    | Single `logentry` JSON column; **expression indices** (`json_extract`) on level/repository/branch, and `err IS NOT NULL`                                                                                                                                            | Stays true to single-column spec; QueryBuilder centralizes matching expressions            |
| 3    | Malformed lines -> synthetic `{"_parseError":true,"_raw":…}` row; blank -> `{"_blank":true}`                                                                                                                                                                        | Guarantees rowid == line number; contiguous counts; surfaces corruption                    |
| 4    | Filter API: root-level keys only in v1 (JSON-path internally); `equals` matches scalars only                                                                                                                                                                        | Matches every documented example; simpler; non-breaking to extend later                    |
| 5    | Config-migration detection: broad, **provisional** case-insensitive patterns in a documented constant                                                                                                                                                               | TBD in spec; no real "needs migration" sample available — must verify later                |
| 6    | Machine-readable output: v1 schema, category-keyed, zero-counts included, ignored findings emitted with `ignored:true`                                                                                                                                              | Stable run-over-run CI comparison                                                          |
| 7    | Ignore file `renovate-log-parser.ignore.json` (`--ignore-file` override); match by category + optional message-glob + optional repository; optional `expires` (expired => inactive + warn) + `reason`                                                               | Line numbers shift; temporary silencing needs stable keys + expiry                         |
| 8    | Exit codes: `0` clean, `1` non-ignored errors, `2` tool/usage error; `--fail-on-warn` opt-in (no `--max-warnings`)                                                                                                                                                  | Distinguishes "analyzer broke" from "log had errors"                                       |
| 9    | `abandoned-package`: **reserve** category (count always 0), no detection yet                                                                                                                                                                                        | Keeps schema/counts forward-compatible without fabricated logic                            |
| 10   | Errors (exit 1) are problems Renovate would _not_ otherwise flag in a PR comment: `host-error-abort`, `level:50/60`, `config-migration`, `abandoned-package` (per package); warnings: `level:40` + `err`-object + `repoProblems` (de-duped vs overlapping level:40) | Matches Renovate severity; avoids double counting                                          |
| 11   | `analyze` no-args: **pretty JSON** stats to stdout (`--format=text` deferred)                                                                                                                                                                                       | Primary consumer is an AI agent                                                            |
| 12   | `analyze --print`: **JSONL** to stdout, truncation notices to stderr, `_oL` = 0-indexed line, ordering range -> filter -> limit                                                                                                                                     | Mirrors source log; stream-friendly; clean stdout                                          |
| 13   | `depNames`/`packageNames`: union of root-level keys + `packageFiles with updates` config-object dep arrays, deduped                                                                                                                                                 | Fullest dependency picture; cheap (1–2 lines/repo)                                         |
| 14   | Web server **shares** Parser + QueryBuilder + SQLite cache                                                                                                                                                                                                          | One code path; cache reuse; scales                                                         |
| 15   | Shared code at **`src/core/`**, consumed by CLI natively + Nitro via alias (inlined into `.output`)                                                                                                                                                                 | Single source of truth; honors existing 2-part layout                                      |
| 16   | GET rows: SQL filtering + `offset`/`limit` paging + client virtualization; return `total`                                                                                                                                                                           | Only option that scales to large real logs                                                 |
| 17   | Details: **3/4-width `USlideover`** + recursive collapsible JSON tree (all expanded, `msg` excluded)                                                                                                                                                                | Matches spec; fixed row heights play well with virtualization                              |
| 18   | One reactive filter object (static dropdowns + `enabled`-toggleable pills); stateless-per-request client state; debounced refetch; **no** URL-sync in v1                                                                                                            | Simple, matches spec's static/dynamic split                                                |
| 19   | Free-text search: field-scoped SQLite `LIKE` (`*` = any run; `?`/character-classes unsupported), **case-insensitive**                                                                                                                                               | Simpler than GLOB; `*`-only wildcard covers the need; case-insensitive per user preference |
| 20   | Context menus: level/repo actions drive **static dropdowns**; message + JSON-field actions create **pills**; `field==value` item scalar-only                                                                                                                        | Prevents pill/dropdown contradictions                                                      |
| 21   | CLI resolves abs path -> `?log=` handoff; POST-path reads **any** local abs path (unrestricted); file-picker uses temp file + hash                                                                                                                                  | Local single-user tool                                                                     |
| 22   | **Stateful** Nitro server: in-memory registry `md5 -> {path, DatabaseSync}` + current pointer; GET routes always use current log; **no** `md5` override; loading new file replaces current                                                                          | Long-lived single-user process; reuse open handles                                         |
| 23   | Skill: generic **parameterized** `gh` recipe (placeholders), org values in a local git-ignored copy                                                                                                                                                                 | Keep published tool org-neutral                                                            |
| 24   | Cache: `os.tmpdir()/renovate-log-parser-<md5>.db`; transactional parse (crash => 0 rows => rebuild); zero-row orphan cleanup on load; content-md5 key; no TTL/size cap in v1                                                                                        | Robust, simple                                                                             |
| 25   | Tests: `node:test`, **stubs only** — no real log committed (sample is private)                                                                                                                                                                                      | User adds committable fixtures later                                                       |
| 26   | Level glyphs `T/D/I/W/E/F`; **info=green**, warn=amber, error=red, fatal=red-filled, trace/debug=muted; unknown => raw number                                                                                                                                       | Per spec + user preference                                                                 |
| 27   | Both `detect-errors` and `analyze` **require an explicit path**                                                                                                                                                                                                     | Predictable; no magic default filename                                                     |
| 28.1 | `analyze --filter key:val` = scalar equals on root key (CLI value typed via `coerceScalar` so numeric/boolean fields match); `analyze --filter-with-wildcard key:pattern` = case-insensitive `LIKE` where `*` is the only wildcard. Both repeatable, AND'd          | Shared primitive; wildcard + value coercion added after Phase 3 per user request           |
| 28.2 | `detect-errors` analyzes whole log across all repos; findings carry `repository` when present                                                                                                                                                                       | —                                                                                          |
| 28.3 | Web repo dropdown lists distinct `repository` verbatim (incl. git-URL sub-repos) + "Repository-independent" pseudo-entry                                                                                                                                            | —                                                                                          |
| 28.4 | Analyzer identifies dependency `config` strictly by `msg === "packageFiles with updates"`                                                                                                                                                                           | Avoid confusing with `File config` etc.                                                    |
| 28.5 | Do **not** gitignore the private sample files                                                                                                                                                                                                                       | User's choice                                                                              |
| 28.6 | `node:sqlite` needs **no** experimental flag                                                                                                                                                                                                                        | User verified                                                                              |

---

## Component specs

> The **Core** section below documents the API **as actually implemented in Phase 1** —
> Phases 2–6 should import these exact signatures. Command/route sections are the
> concrete contracts to build.

### Core: filters (`src/core/filters.ts`) — DELIVERED

```ts
type FieldName = string;
type ScalarValue = string | number | boolean;

interface EqualsFilter {
  type: "equals";
  field: FieldName;
  value: ScalarValue;
  negate?: boolean;
}
interface PresenceFilter {
  type: "presence";
  field: FieldName;
  negate?: boolean;
}
interface LevelFilter {
  type: "levelIn";
  levels: number[];
  negate?: boolean;
}
interface LikeFilter {
  type: "like";
  field: FieldName;
  pattern: string; // raw user glob; `*` is the only wildcard
  negate?: boolean;
}
interface RawFilter {
  type: "raw"; // whole-line search: `*` wildcard, case-insensitive
  pattern: string; // matched against the entire `logentry` JSON text
  negate?: boolean;
}
type Filter =
  EqualsFilter | PresenceFilter | LevelFilter | LikeFilter | RawFilter;

function jsonPath(field): string; // -> $."field"  (escapes embedded ")
function extractExpr(field, column = "logentry"): string; // -> json_extract(column, '$."field"')
function parseKeyValueFilter(token): EqualsFilter; // "key:val" (splits on FIRST colon; coerceScalar on value)
function parseWildcardFilter(token): LikeFilter; // "key:pattern" (splits on FIRST colon)
function globStarToLike(pattern): string; // escape \ % _, then * -> %
function coerceScalar(value): ScalarValue; // "true"/"false" -> bool; strict numeric -> number; else string
```

Semantics: all filters are AND'd. `equals` compares scalars only; **negated** equals is
null-safe (`expr IS NULL OR expr <> ?`) so entries missing the field are kept when hiding a
value. `presence` = `IS [NOT] NULL`. `levelIn` empty set => matches nothing (negated =>
everything); negated is null-safe. `like` is a field-scoped, **case-insensitive** wildcard:
`globStarToLike` escapes LIKE's `%`/`_`/`\` then maps `*` -> `%`, and QueryBuilder emits
`CAST(expr AS TEXT) LIKE ? ESCAPE '\'` (null-safe when negated). CLI `equals` values are typed
by `coerceScalar` (`true`/`false` -> boolean; strict numeric literal -> number; else string) so
`--filter level:30` compares against the numeric `level` (SQLite never equates `30` with `'30'`).
Root-level keys only in v1 (paths are built as `$."key"` so nesting is a later non-breaking
extension).

> **Note (deviation from original plan):** the original `GlobFilter`
> (`json_tree` + `GLOB`, 4 modes, case-sensitive) was removed in favour of the
> simpler field-scoped `LikeFilter` above (Q19/Q28.1). The web free-text search
> (Phase 5b) will reuse `LikeFilter`.

> **Note (added in Phase 5b fix):** a `RawFilter` (`{ type:"raw", pattern,
negate? }`) was added for the web "Raw search" mode — the requirement's
> "find one string in any JSON key or any value". Rather than walk `json_tree`,
> it does a case-insensitive `*`-wildcard `LIKE` against the **entire** raw
> `logentry` line (`logentry [NOT] LIKE ? ESCAPE '\'`), so a match anywhere in
> the serialized JSON (key or value) qualifies. `logentry` is `NOT NULL`, so the
> negated form needs no null-guard. Non-breaking (new union member).

> **Note (added in Phase 4):** a fifth filter, `InSetFilter`
> (`{ type:"inSet", field, values, includeNull?, negate? }`), was added — the
> arbitrary-field analogue of `LevelFilter`. It gives the OR semantics the AND'd
> `EqualsFilter`s cannot express, so the web repository include/exclude
> selection maps to a single filter: include => `inSet(repository, values,
includeNull=independent)`; exclude => the same, negated. `includeNull` matches
> the no-`repository` "Repository-independent" group; all null handling is
> explicit and the negated forms stay null-safe. Non-breaking (new union member).

### Core: levels (`src/core/levels.ts`) — DELIVERED

```ts
type LevelColor =
  "muted" | "neutral" | "green" | "amber" | "red" | "red-filled";
interface LevelMeta {
  level: number;
  name: string;
  symbol: string;
  color: LevelColor;
}
const LEVELS: Record<number, LevelMeta>; // 10 T muted, 20 D neutral, 30 I green,
// 40 W amber, 50 E red, 60 F red-filled
const ERROR_LEVELS = [50, 60]; // build-breaking for detect-errors
const WARN_LEVEL = 40;
function levelMeta(level): LevelMeta; // unknown => { symbol:String(level), color:"muted" }
```

The web layer maps `LevelColor` tokens to Nuxt UI/Tailwind classes (mapping table TBD in
Phase 5a — keep it in one place, e.g. a `LEVEL_CLASS: Record<LevelColor,string>` in the UI).

### Core: QueryBuilder (`src/core/query-builder.ts`) — DELIVERED

```ts
type SqlParam = string | number | bigint | null | Uint8Array;
interface BuiltQuery {
  sql: string;
  params: SqlParam[];
}
interface QueryOptions {
  lineFrom?: number;
  lineTo?: number;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
}

function buildQuery(
  filters?: readonly Filter[],
  options?: QueryOptions,
  columns = "rowid, logentry",
): BuiltQuery;
function buildCountQuery(
  filters?: readonly Filter[],
  options?: Pick<QueryOptions, "lineFrom" | "lineTo">,
): BuiltQuery; // SELECT COUNT(*) AS n
```

WHERE reuses the same `json_extract(...)`/level expressions the parser indexes. Always
`ORDER BY rowid <asc|desc>` (stripped by `buildCountQuery`). `LIMIT`/`OFFSET` appended when set.

### Core: Parser (`src/core/parser.ts`) — DELIVERED

```ts
interface LoadResult {
  path: string;
  md5: string;
  dbPath: string;
  totalLines: number;
  cached: boolean;
}
interface ParseErrorEntry {
  _parseError: true;
  _raw: string;
}
interface BlankEntry {
  _blank: true;
}

class Parser {
  get loaded(): LoadResult | undefined;
  load(absolutePath: string): LoadResult; // sync; md5-cached; throws if file missing
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParam[],
  ): T[];
  queryEntries<T>(sql: string, params?): { line: number; entry: T }[]; // parses `logentry`
  close(): void; // idempotent
}
```

Schema: `CREATE TABLE logs (line INTEGER PRIMARY KEY, logentry TEXT NOT NULL)` (`line` aliases
rowid = 0-indexed file line). Indices: `idx_level`, `idx_repository`, `idx_branch` (expression
indices on `json_extract`), `idx_err` (partial, `err IS NOT NULL`). Cache at
`os.tmpdir()/renovate-log-parser-<contentMd5>.db`; reused iff table has ≥1 row; zero-row/invalid
caches deleted on every load; parse wrapped in `BEGIN/COMMIT` (crash => 0 rows => rebuilt).
Malformed line => `ParseErrorEntry`; blank line => `BlankEntry`; a single trailing newline does
**not** create an extra row (matches `wc -l`).

> **Note (deviation from original plan):** `query()` takes an optional `params` array for
> safe binding — the plan originally wrote `query(sql)`. Non-breaking; a bare SQL string works.

---

### Command: `detect-errors <path>` (Phase 2)

**Synopsis**

```
renovate-log-parser detect-errors <path> [--out <file>] [--ignore-file <file>] [--fail-on-warn]
```

| Arg / flag       | Type    | Default                             | Meaning                                           |
| ---------------- | ------- | ----------------------------------- | ------------------------------------------------- |
| `<path>`         | string  | **required**                        | Absolute/relative path to the JSONL log           |
| `--out`          | string  | (none)                              | Also write the machine-readable JSON to this path |
| `--ignore-file`  | string  | `./renovate-log-parser.ignore.json` | Ignore-rules file (missing file = no rules)       |
| `--fail-on-warn` | boolean | `false`                             | Make warning findings affect the exit code        |

**Exit codes:** `0` = no non-ignored errors; `1` = ≥1 non-ignored error (or, with
`--fail-on-warn`, ≥1 non-ignored warning); `2` = tool/usage error (bad path, unreadable, bad args).

**Detection rules** (each finding = one category + severity):

| Category            | Severity | Rule                                                                                                                            |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `host-error-abort`  | error    | `msg === "Repository finished"` **and** `result === "external-host-error"`                                                      |
| `log-error`         | error    | `level === 50`                                                                                                                  |
| `log-fatal`         | error    | `level === 60`                                                                                                                  |
| `config-migration`  | error    | `msg === "Config migration necessary"` **and** entry carries both `oldConfig` and `newConfig`                                   |
| `abandoned-package` | error    | `msg === "Abandoned package statistics"` → one finding per package (each datasource-named object maps `package -> lastUpdated`) |
| `log-warn`          | warning  | `level === 40`                                                                                                                  |
| `err-object`        | warning  | entry has root-level `err` object (`presence` filter on `err`)                                                                  |
| `repo-problem`      | warning  | each string in a `repoProblems` array, **de-duped** against overlapping `log-warn` messages                                     |

The error/warning split is scoped to problems Renovate would _not_ otherwise
surface in a PR comment (host-error abort, level 50/60, config migration,
abandoned packages); warnings echo problems already visible elsewhere.

**Machine-readable output schema (v1)** — written to `--out`; the counts map includes **every**
known category (zeros too) for stable CI diffing:

```jsonc
{
  "version": 1,
  "logFile": "/abs/path/renovate.jsonl",
  "logMd5": "…",
  "generatedAt": "2026-…Z",
  "exitCode": 1,
  "summary": { "errorCount": 3, "warningCount": 6 },
  "counts": {
    "host-error-abort": 1,
    "log-error": 0,
    "log-fatal": 0,
    "err-object": 2,
    "config-migration": 0,
    "abandoned-package": 0,
    "log-warn": 6,
    "repo-problem": 0,
  },
  "findings": [
    {
      "category": "err-object",
      "severity": "error",
      "message": "lock file error",
      "line": 873,
      "repository": "owner/repo",
      "details": {/* category-specific */},
      "ignored": false,
    },
  ],
}
```

Human summary -> stdout (grouped by severity; ignored findings under a separate "ignored"
section). Ignored findings appear in `findings` with `ignored:true` and are **excluded** from
`summary`/exit-code.

**Ignore-file schema** (`renovate-log-parser.ignore.json`):

```jsonc
{
  "version": 1,
  "rules": [
    {
      "category": "err-object", // required
      "message": "*lock file error*", // optional glob (matched against finding.message)
      "repository": "owner/repo", // optional exact match
      "reason": "flaky nuget restore, JIRA-123", // optional, for humans
      "expires": "2026-09-01",
    }, // optional ISO date; past => rule inactive + warn
  ],
}
```

A finding is ignored iff an **active** rule matches on category AND (message glob if present)
AND (repository if present). Expired rules are skipped with a warning to stderr.

### Command: `analyze <path> [args]` (Phase 3)

**Synopsis**

```
renovate-log-parser analyze <path>
renovate-log-parser analyze <path> --print [--ignored-fields <csv>] [--line-from <n>]
    [--line-to <n>] [--limit <n>] [--filter <key:val> …]
    [--filter-with-wildcard <key:pattern> …] [--include-original-line]
```

| Flag                        | Default                               | Meaning                                                        |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `<path>`                    | **required**                          | Path to JSONL log                                              |
| `--print`                   | off                                   | Switch from stats mode to line-printing mode                   |
| `--ignored-fields`          | `v,time,logContext,pid,hostname,name` | CSV of root keys to strip (`msg` never strippable)             |
| `--line-from` / `--line-to` | (none)                                | 0-indexed inclusive rowid range (either optional)              |
| `--limit`                   | `50`                                  | Max lines to print                                             |
| `--filter`                  | (none)                                | `key:val` scalar-equals, repeatable, AND'd                     |
| `--filter-with-wildcard`    | (none)                                | `key:pattern` case-insensitive `*`-wildcard, repeatable, AND'd |
| `--include-original-line`   | `false`                               | Add `_oL` = 0-indexed source line to each object               |

**Stats mode (no `--print`)** — pretty JSON to stdout:

```jsonc
{
  "logFile": "/abs/path", "md5": "…", "totalLines": 2028,
  "levelCounts": { "20": 2003, "30": 18, "40": 6 },
  "repos": [
    { "name": "owner/repo",
      "fromLine": 12, "toLine": 640,                 // rowid span of this repo's entries
      "branches": ["renovate/x", …],                  // unique branch names
      "branchesInformationLine": 512,                 // rowid of `branches info extended`, or null
      "packageFilesLine": 649,                        // rowid of `packageFiles with updates`, or null
      "repoProblems": ["⚠️ WARN: …"],
      "depNames": ["react", …],                       // union: root-level depName + packageFiles config
      "packageNames": ["…"] }                          // union: root-level packageName + packageFiles config
  ]
}
```

Repo grouping keyed by the `repository` value. Entries with no `repository`, and
git-URL sub-repos whose `repository` is an `https://…` URL (e.g. pre-commit
hooks), are excluded from the per-repo view (their entries still count toward
`levelCounts`). `depNames`/
`packageNames` union root-level keys with the dependency arrays inside the `config` of the
entry where `msg === "packageFiles with updates"`, deduped.

**Print mode (`--print`)** — **JSONL** to stdout (one stripped entry per line). Selection order:
line-range -> filters -> `--limit` (first N by line order). Truncation notice (when `--limit`
capped results) -> **stderr** so stdout stays clean. `_oL` added only when
`--include-original-line`.

### Command: `web` — stateful Nitro server (Phase 4)

`server/utils/log-registry.ts` = module singleton: `Map<md5, { path, db: Parser }>` + a
`current: md5 | null` pointer. A successful POST sets `current`; GET routes always use
`current` (**no** `md5` param). Loading a new file replaces `current`.

**Routes**

| Method + path            | Request                                  | Response                                                       |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------- |
| `POST /api/log/path`     | `{ "path": "<absolute>" }`               | `{ md5, path, totalLines, levelCounts }` (blocks until parsed) |
| `POST /api/log/contents` | raw/multipart bytes of an uploaded file  | `{ md5, path: "<temp>", totalLines, levelCounts }`             |
| `GET  /api/rows`         | `?filters=<url-enc JSON>&offset=&limit=` | `{ total, offset, limit, rows: RowDTO[] }`                     |
| `GET  /api/fields`       | —                                        | `string[]` (distinct root-level keys across the log)           |
| `GET  /api/repositories` | —                                        | `string[]` (distinct `repository` values, verbatim)            |

`RowDTO = { _oL: number, ...entryWithIgnoredFieldsStripped }` (`msg` never stripped). Errors:
no current log => `409`; bad path / parse failure => `400`; unreadable => `500`.

> **Note (implementation, Phase 4):** the shared core is exposed to Nitro via the
> **`renovate-core`** alias (not `#core` — Nuxt strips `#`-prefixed aliases from
> the generated tsconfig `paths`), set in both `nuxt.config` `alias` and
> `nitro.alias`; `src/core` is inlined into `web/.output` and `node:sqlite` stays
> external. The registry + helpers live in auto-imported `web/server/utils/`
> (`log-registry.ts`, `translate-filters.ts`, `request.ts`). Nuxt 4.4 / Nitro
> 2.13 ship a mixed h3 v1 (runtime app router) / v2 (auto-imported helpers)
> setup, so `readBody`/`readRawBody`/`getHeader`/`getQuery` throw at runtime
> (`event.req.text is not a function`). `request.ts` sidesteps this by reading
> straight from `event.node.req` (the Node request, present on both event
> shapes); Phase 5+ server code should use those helpers, not the h3 auto-imports.
> The upload route reads the **raw** request body (multipart was dropped — the
> Phase 5 file picker will POST raw bytes).

**`filters` wire format** — the JSON-encoded value of the reactive filter object (Phase 5),
translated server-side into `Filter[]` + `QueryOptions`:

```jsonc
{
  "levels": [20, 30, 40],                 // -> LevelFilter (empty/absent = all)
  "repositories": {                        // -> EqualsFilter(s) on `repository`
    "mode": "include" | "exclude",
    "values": ["owner/repo", …],
    "independent": true                    // include/exclude the no-`repository` pseudo-group
  },
  "ignoredFields": ["v","time", …],        // -> field stripping on RowDTO (not a WHERE clause)
  "search": { "field": "msg", "pattern": "*abort*", "scope": "field" }, // scope:"field" -> LikeFilter on the field; scope:"raw" -> RawFilter (whole line, field ignored)
  "pills": [ { "id": "…", "enabled": true,
               "filter": { "type": "equals", "field": "msg", "value": "…", "negate": true } } ]
}
```

Disabled pills (`enabled:false`) are omitted from the query. `ignoredFields` shapes the
response projection, not row matching.

### Web frontend (Phase 5a list+details, 5b filters+search)

- **5a**: virtualized row list (one row per line): level glyph (`levelMeta`) + `msg`; a left
  arrow (shown when the entry has keys besides `msg`) opens a 3/4-width `USlideover` with a
  recursive collapsible JSON-tree (all keys expanded, `msg` excluded). Header shows the current
  log path + a file picker (POST `/api/log/contents`). On mount read `?log=` and POST
  `/api/log/path`. `LEVEL_CLASS: Record<LevelColor,string>` maps tokens -> Tailwind classes.
- **5b**: reactive filter object (`app/composables/useFilters.ts`) per the wire format above.
  Static dropdowns: log levels; repositories (checkboxes + "Repository-independent"); ignored
  fields (checkboxes from `/api/fields`, `msg` not listable). Dynamic **pills** with an
  `enabled` toggle + remove (label truncated + `max-w-xs` so stringified objects stay compact).
  Row context menu (level/repo actions drive the static dropdowns; message actions create pills).
  JSON-key context menu: **root-level** keys create pills (show-only/hide `<field>`; show-only/hide
  `<field>==<scalar>` — the value item only for scalar values); **nested** keys create a
  field-scoped search pill on the top-level ancestor key whose pattern is the compact JSON
  fragment (`*"<key>":<JSON.stringify(value)>*`, or `*<JSON.stringify(value)>*` for array
  elements) — i.e. "the ancestor's serialized value contains this". Free-text search box: a
  field selector whose first entry, **"Raw search"**, matches the whole line (`RawFilter`, any key
  or value); any other selection is a field-scoped case-insensitive `*`-wildcard `LikeFilter`.
  All changes debounce -> refetch `/api/rows`.

### Skill: `.agents/skills/renovate-log-analyzer/SKILL.md` (Phase 6)

Sections: (1) what the log is + the structure reference above; (2) how to invoke
`analyze <path>` (stats) then `analyze <path> --print --line-from/--line-to …` to read only
relevant ranges (token-saving loop: stats -> pick lines -> print); (3) a **parameterized** `gh`
recipe with clearly-marked placeholders `<HOST>`/`<OWNER>/<REPO>`/`<WORKFLOW>`:
`gh run list` -> latest successful run -> `gh run download` artifact -> unzip -> `analyze`.
No org identity baked in; note users keep a filled-in git-ignored local copy.

### Tests — stubs only

`node:test` via `node --import tsx --test "src/**/*.test.ts"`. Build excludes test files via
`tsconfig.build.json` (main `tsconfig.json` still lints/typechecks them). Phase 1 shipped 10
stub tests (parser + query-builder). Add ErrorDetector/Analyzer stubs in their phases; flesh
out with committable real-log fixtures later (Q25).

---

## Status / phases

Implement in dependency order; one phase per session (Phase 5 split in two).

- [x] **Phase 1 — Core**: Parser, QueryBuilder, filters, levels, `node:test` stubs.
- [x] **Phase 2 — `detect-errors`**: ErrorDetector, categories, ignore file, exit codes, JSON output.
- [x] **Phase 3 — `analyze`**: stats + `--print`.
- [x] **Phase 4 — `web` backend**: stateful registry + 5 routes + CLI `?log=` handoff.
- [x] **Phase 5a — `web` frontend (list + details)**: virtualized list, level glyphs, details slideover + JSON tree.
- [x] **Phase 5b — `web` frontend (filters + search)**: static dropdowns, pills, context menus, free-text search.
- [ ] **Phase 6 — Skill**: `SKILL.md` with parameterized `gh` recipe.

### Follow-up TODOs (revisit with real logs)

- [ ] Validate `config-migration` detection patterns against a real "migration-needed" log.
- [ ] Implement `abandoned-package` detection once a real sample exists (category already reserved).
- [ ] Add committable real-world log fixtures; flesh out stubbed tests.

### Deferred (non-goals for v1)

URL-shareable filters; case-insensitive search toggle; `analyze --format=text`;
nested-key filters; web component/E2E tests.
