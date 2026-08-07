/**
 * API route tests.
 *
 * These boot the real Express app on an ephemeral port and drive it over HTTP.
 * The point of interest is log identity: the reads are stateless and name their
 * log with an `md5` parameter, so loading a second log must not disturb reads of
 * the first. That is what lets two browser tabs hold two different logs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../index.js";

/** Metadata `POST /api/log/*` returns. */
interface LoadedLogInfo {
  md5: string;
  path: string;
  totalLines: number;
}

/** Write a JSONL log into a fresh temp dir. */
function writeTempLog(lines: object[]): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "rlp-api-test-"));
  const path = join(dir, "renovate.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return { dir, path };
}

/** Start the API on an ephemeral port; returns its base URL and a stopper. */
async function startApi(): Promise<{
  base: string;
  stop: () => Promise<void>;
}> {
  // No staticDir, so only /api is mounted — that is all these tests touch.
  const server: Server = await new Promise((resolve) => {
    const s = createApp({ staticDir: "/nonexistent" }).listen(
      0,
      "127.0.0.1",
      () => resolve(s),
    );
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("reads are scoped by md5, so two logs stay independent", async (t) => {
  const first = writeTempLog([
    { level: 30, msg: "first-a", repository: "acme/one" },
    { level: 30, msg: "first-b", repository: "acme/one" },
    { level: 30, msg: "first-c", repository: "acme/one" },
  ]);
  const second = writeTempLog([
    { level: 40, msg: "second-a", repository: "acme/two" },
  ]);
  const { base, stop } = await startApi();
  t.after(async () => {
    await stop();
    rmSync(first.dir, { recursive: true, force: true });
    rmSync(second.dir, { recursive: true, force: true });
  });

  const load = async (path: string): Promise<LoadedLogInfo> => {
    const res = await fetch(`${base}/api/log/path`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
    });
    assert.equal(res.status, 200);
    return (await res.json()) as LoadedLogInfo;
  };

  const a = await load(first.path);
  // Loading `b` used to move a process-wide "current" pointer, which silently
  // re-pointed every later read — including reads meant for `a`.
  const b = await load(second.path);
  assert.notEqual(a.md5, b.md5);

  const rowsA = (await (
    await fetch(`${base}/api/rows?md5=${a.md5}`)
  ).json()) as { total: number; rows: { msg: string }[] };
  const rowsB = (await (
    await fetch(`${base}/api/rows?md5=${b.md5}`)
  ).json()) as { total: number; rows: { msg: string }[] };

  assert.equal(rowsA.total, 3);
  assert.equal(rowsA.rows[0].msg, "first-a");
  assert.equal(rowsB.total, 1);
  assert.equal(rowsB.rows[0].msg, "second-a");

  // The derived endpoints must follow the same md5, not the most recent load.
  const reposA = (await (
    await fetch(`${base}/api/repositories?md5=${a.md5}`)
  ).json()) as string[];
  assert.deepEqual(reposA, ["acme/one"]);

  const findingsA = (await (
    await fetch(`${base}/api/findings?md5=${a.md5}`)
  ).json()) as { summary: unknown };
  assert.ok(findingsA.summary);

  const fieldsA = (await (
    await fetch(`${base}/api/fields?md5=${a.md5}`)
  ).json()) as string[];
  assert.deepEqual(fieldsA, ["level", "msg", "repository"]);
});

test("GET /api/log/:md5 restores metadata for a loaded log", async (t) => {
  const log = writeTempLog([{ level: 30, msg: "only" }]);
  const { base, stop } = await startApi();
  t.after(async () => {
    await stop();
    rmSync(log.dir, { recursive: true, force: true });
  });

  const loaded = (await (
    await fetch(`${base}/api/log/path`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: log.path }),
    })
  ).json()) as LoadedLogInfo;

  const res = await fetch(`${base}/api/log/${loaded.md5}`);
  assert.equal(res.status, 200);
  const restored = (await res.json()) as LoadedLogInfo;
  assert.equal(restored.md5, loaded.md5);
  assert.equal(restored.path, loaded.path);
  assert.equal(restored.totalLines, 1);
});

test("reads reject a missing md5 with 400 and an unknown one with 404", async (t) => {
  const { base, stop } = await startApi();
  t.after(stop);

  const missing = await fetch(`${base}/api/rows`);
  assert.equal(missing.status, 400);

  const unknown = await fetch(`${base}/api/rows?md5=deadbeef`);
  assert.equal(unknown.status, 404);

  // The restore route reports the same 404, which is how a tab detects that its
  // `?md5=` outlived the server that served it.
  const restore = await fetch(`${base}/api/log/deadbeef`);
  assert.equal(restore.status, 404);
});
