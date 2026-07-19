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

| Q    | Decision                                                                                                                                                                                              | Rationale                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1    | Storage via **`node:sqlite`** (built-in), used by CLI + server                                                                                                                                        | Zero deps, no native build, present on Node ≥26                                 |
| 2    | Single `logentry` JSON column; **expression indices** (`json_extract`) on level/repository/branch, and `err IS NOT NULL`                                                                              | Stays true to single-column spec; QueryBuilder centralizes matching expressions |
| 3    | Malformed lines -> synthetic `{"_parseError":true,"_raw":…}` row; blank -> `{"_blank":true}`                                                                                                          | Guarantees rowid == line number; contiguous counts; surfaces corruption         |
| 4    | Filter API: root-level keys only in v1 (JSON-path internally); `equals` matches scalars only                                                                                                          | Matches every documented example; simpler; non-breaking to extend later         |
| 5    | Config-migration detection: broad, **provisional** case-insensitive patterns in a documented constant                                                                                                 | TBD in spec; no real "needs migration" sample available — must verify later     |
| 6    | Machine-readable output: v1 schema, category-keyed, zero-counts included, ignored findings emitted with `ignored:true`                                                                                | Stable run-over-run CI comparison                                               |
| 7    | Ignore file `renovate-log-parser.ignore.json` (`--ignore-file` override); match by category + optional message-glob + optional repository; optional `expires` (expired => inactive + warn) + `reason` | Line numbers shift; temporary silencing needs stable keys + expiry              |
| 8    | Exit codes: `0` clean, `1` non-ignored errors, `2` tool/usage error; `--fail-on-warn` opt-in (no `--max-warnings`)                                                                                    | Distinguishes "analyzer broke" from "log had errors"                            |
| 9    | `abandoned-package`: **reserve** category (count always 0), no detection yet                                                                                                                          | Keeps schema/counts forward-compatible without fabricated logic                 |
| 10   | `level>=50` = build-breaking errors; `level:40` + `repoProblems` (de-duped vs overlapping level:40) + `branchesInformation[].result==="error"` = warnings                                             | Matches Renovate severity; avoids double counting                               |
| 11   | `analyze` no-args: **pretty JSON** stats to stdout (`--format=text` deferred)                                                                                                                         | Primary consumer is an AI agent                                                 |
| 12   | `analyze --print`: **JSONL** to stdout, truncation notices to stderr, `_oL` = 0-indexed line, ordering range -> filter -> limit                                                                       | Mirrors source log; stream-friendly; clean stdout                               |
| 13   | `depNames`/`packageNames`: union of root-level keys + `packageFiles with updates` config-object dep arrays, deduped                                                                                   | Fullest dependency picture; cheap (1–2 lines/repo)                              |
| 14   | Web server **shares** Parser + QueryBuilder + SQLite cache                                                                                                                                            | One code path; cache reuse; scales                                              |
| 15   | Shared code at **`src/core/`**, consumed by CLI natively + Nitro via alias (inlined into `.output`)                                                                                                   | Single source of truth; honors existing 2-part layout                           |
| 16   | GET rows: SQL filtering + `offset`/`limit` paging + client virtualization; return `total`                                                                                                             | Only option that scales to large real logs                                      |
| 17   | Details: **3/4-width `USlideover`** + recursive collapsible JSON tree (all expanded, `msg` excluded)                                                                                                  | Matches spec; fixed row heights play well with virtualization                   |
| 18   | One reactive filter object (static dropdowns + `enabled`-toggleable pills); stateless-per-request client state; debounced refetch; **no** URL-sync in v1                                              | Simple, matches spec's static/dynamic split                                     |
| 19   | Free-text search: `json_tree()` + `GLOB`, 4 modes, **case-sensitive** (toggle deferred)                                                                                                               | GLOB natively supports `*`/`?`; SQL-side keeps paging valid                     |
| 20   | Context menus: level/repo actions drive **static dropdowns**; message + JSON-field actions create **pills**; `field==value` item scalar-only                                                          | Prevents pill/dropdown contradictions                                           |
| 21   | CLI resolves abs path -> `?log=` handoff; POST-path reads **any** local abs path (unrestricted); file-picker uses temp file + hash                                                                    | Local single-user tool                                                          |
| 22   | **Stateful** Nitro server: in-memory registry `md5 -> {path, DatabaseSync}` + current pointer; GET routes always use current log; **no** `md5` override; loading new file replaces current            | Long-lived single-user process; reuse open handles                              |
| 23   | Skill: generic **parameterized** `gh` recipe (placeholders), org values in a local git-ignored copy                                                                                                   | Keep published tool org-neutral                                                 |
| 24   | Cache: `os.tmpdir()/renovate-log-parser-<md5>.db`; transactional parse (crash => 0 rows => rebuild); zero-row orphan cleanup on load; content-md5 key; no TTL/size cap in v1                          | Robust, simple                                                                  |
| 25   | Tests: `node:test`, **stubs only** — no real log committed (sample is private)                                                                                                                        | User adds committable fixtures later                                            |
| 26   | Level glyphs `T/D/I/W/E/F`; **info=green**, warn=amber, error=red, fatal=red-filled, trace/debug=muted; unknown => raw number                                                                         | Per spec + user preference                                                      |
| 27   | Both `detect-errors` and `analyze` **require an explicit path**                                                                                                                                       | Predictable; no magic default filename                                          |
| 28.1 | `analyze --filter key:val` = scalar equals on root key, repeatable, AND'd                                                                                                                             | Shared primitive                                                                |
| 28.2 | `detect-errors` analyzes whole log across all repos; findings carry `repository` when present                                                                                                         | —                                                                               |
| 28.3 | Web repo dropdown lists distinct `repository` verbatim (incl. git-URL sub-repos) + "Repository-independent" pseudo-entry                                                                              | —                                                                               |
| 28.4 | Analyzer identifies dependency `config` strictly by `msg === "packageFiles with updates"`                                                                                                             | Avoid confusing with `File config` etc.                                         |
| 28.5 | Do **not** gitignore the private sample files                                                                                                                                                         | User's choice                                                                   |
| 28.6 | `node:sqlite` needs **no** experimental flag                                                                                                                                                          | User verified                                                                   |

---

## Component specs

### Core: Parser (`src/core/parser.ts`)

- `load(absolutePath)`: md5 of file content -> `os.tmpdir()/renovate-log-parser-<md5>.db`.
  Reuse if file exists **and** table has ≥1 row; else (re)create.
- On load, scan `renovate-log-parser-*.db` in tmp, delete any with **zero rows**. Preserve
  valid caches for other logs (no TTL/size cap).
- Schema: single table, `logentry` JSON column, `rowid` = 0-indexed line number.
  Expression indices on `json_extract(logentry,'$.level')`, `$.repository`, `$.branch`,
  and `json_extract(...,'$.err') IS NOT NULL`.
- Parse line-by-line inside a **transaction**. Malformed -> `_parseError`, blank -> `_blank`.
- `query(sql)`: run SELECT, return parsed objects.

### Core: QueryBuilder (`src/core/query-builder.ts`) + filters (`filters.ts`)

Primitives, all AND'd: `equals` (root key, scalar only), `presence`, `levelIn`,
`glob` (key/value/both via `json_tree()`+`GLOB`, case-sensitive), and negation of each.
Root-level keys only in v1; JSON-path internally. Parameterized SQL matching the index
expressions.

### Command: `detect-errors <path>`

- Categories: `host-error-abort`, `err-object`, `config-migration` (provisional patterns),
  `abandoned-package` (reserved, count 0, no detection).
- Severity: `level>=50` = error; `level:40` + `repoProblems` (de-duped) +
  `branchesInformation[].result==="error"` = warnings.
- Ignore file `renovate-log-parser.ignore.json` (CWD default, `--ignore-file` override).
- Human summary -> stdout; `--out <path>` writes v1 machine-readable JSON.
- Exit codes `0`/`1`/`2`; `--fail-on-warn` opt-in.

### Command: `analyze <path> [args]`

- No args -> pretty JSON stats:
  `{ logFile, md5, totalLines, levelCounts, repos:[{name, fromLine, toLine, branches,
branchesInformationLine, packageFilesLine, repoProblems, depNames, packageNames}] }`.
- `--print` -> JSONL to stdout, truncation notices to stderr.
- Args: `--ignored-fields` (default `v,time,logContext,pid,hostname,name`; `msg` never
  strippable), `--line-from/--line-to` (0-indexed), `--limit` (default 50),
  `--filter key:val` (repeatable), `--include-original-line` (adds `_oL`).
- Ordering: range -> filter -> limit.

### Command: `web` — stateful Nitro server

- Shared `Parser`/`QueryBuilder` via alias. `server/utils/log-registry.ts` = module
  singleton `md5 -> {path, DatabaseSync}` + current pointer; reuses open handles.
- Routes: `POST /api/log/path {path}`, `POST /api/log/contents` (bytes),
  `GET /api/rows?filters=<json>&offset&limit` -> `{total,offset,limit,rows}`,
  `GET /api/fields`, `GET /api/repositories`. No `md5` override.
- CLI handoff: `path.resolve` -> open `http://localhost:<port>/?log=<abs>`.

### Web frontend

- Virtualized row list; row = level glyph + `msg`; arrow -> 3/4-width `USlideover` JSON tree.
- Reactive filter object: static dropdowns (levels, repositories + "Repository-independent",
  ignored-fields with `msg` non-listable) + `enabled`-toggleable pills. Debounced refetch.
- Search: 4 modes, glob -> `GLOB`, case-sensitive.
- Context menus per Q20.

### Skill: `.agents/skills/renovate-log-analyzer/SKILL.md`

Log-structure docs, `analyze` invocation, token-saving line-range workflow, parameterized
`gh` recipe (placeholders for host/owner/repo/workflow): discover latest successful run ->
download artifact -> unzip -> analyze.

### Tests — stubs only

`node:test` scaffolding for parser/query-builder/error-detector/analyzer with placeholder
fixtures. Real committable fixtures added later.

---

## Status / phases

Implement in dependency order; one phase per session (Phase 5 split in two).

- [x] **Phase 1 — Core**: Parser, QueryBuilder, filters, levels, `node:test` stubs.
- [ ] **Phase 2 — `detect-errors`**: ErrorDetector, categories, ignore file, exit codes, JSON output.
- [ ] **Phase 3 — `analyze`**: stats + `--print`.
- [ ] **Phase 4 — `web` backend**: stateful registry + 5 routes + CLI `?log=` handoff.
- [ ] **Phase 5a — `web` frontend (list + details)**: virtualized list, level glyphs, details slideover + JSON tree.
- [ ] **Phase 5b — `web` frontend (filters + search)**: static dropdowns, pills, context menus, free-text search.
- [ ] **Phase 6 — Skill**: `SKILL.md` with parameterized `gh` recipe.

### Follow-up TODOs (revisit with real logs)

- [ ] Validate `config-migration` detection patterns against a real "migration-needed" log.
- [ ] Implement `abandoned-package` detection once a real sample exists (category already reserved).
- [ ] Add committable real-world log fixtures; flesh out stubbed tests.

### Deferred (non-goals for v1)

URL-shareable filters; case-insensitive search toggle; `analyze --format=text`;
nested-key filters; web component/E2E tests.
