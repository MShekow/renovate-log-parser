/**
 * skill-template tests.
 *
 * Assert the pure `buildSkillMarkdown` contract: the frontmatter and the key
 * explanatory sections are always present, and the optional GitHub-fetch section
 * is included/threaded correctly (org/repo/workflow, and the `GH_HOST=` prefix
 * only when a base URL is provided).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSkillMarkdown } from "../skill-template.js";

test("base skill (no gh) contains the core explanatory sections", () => {
  const md = buildSkillMarkdown();

  assert.match(md, /^---\nname: renovate-log-analyzer\n/);
  assert.match(md, /license: MIT/);
  // Level mapping.
  assert.match(md, /`20`\s*\|\s*debug/);
  assert.match(md, /`10`\s*\|\s*trace/);
  assert.match(md, /`60`\s*\|\s*fatal/);
  // Stats fields.
  assert.match(md, /branchesInformationLine/);
  assert.match(md, /packageFilesLine/);
  assert.match(md, /repoProblems/);
  assert.match(md, /fromLine/);
  assert.match(md, /toLine/);
  // 0-indexing note.
  assert.match(md, /0-indexed/);
  // The core loop uses npx.
  assert.match(md, /npx --yes renovate-log-parser analyze/);
  // No gh section.
  assert.doesNotMatch(md, /gh run list/);
  assert.doesNotMatch(md, /GH_HOST=/);
  // Single trailing newline.
  assert.ok(md.endsWith("\n"));
  assert.ok(!md.endsWith("\n\n"));
});

test("gh section without base URL omits the GH_HOST prefix", () => {
  const md = buildSkillMarkdown({
    gh: { org: "acme", repo: "app", workflow: "renovate.yml" },
  });

  assert.match(md, /Fetch the log from GitHub/);
  assert.match(md, /gh run list --workflow renovate\.yml -R acme\/app/);
  assert.match(md, /gh run download <run-id> -R acme\/app/);
  assert.doesNotMatch(md, /GH_HOST=/);
});

test("gh section with base URL threads GH_HOST onto commands", () => {
  const md = buildSkillMarkdown({
    gh: {
      org: "acme",
      repo: "app",
      workflow: "renovate.yml",
      baseUrl: "github.example.com",
    },
  });

  assert.match(md, /GH_HOST=github\.example\.com gh run list/);
  assert.match(md, /GH_HOST=github\.example\.com gh run download/);
  assert.match(md, /gh auth login --hostname github\.example\.com/);
});
