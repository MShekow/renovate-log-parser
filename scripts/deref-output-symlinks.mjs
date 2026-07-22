#!/usr/bin/env node
// Replace every symlink under web/.output with a real copy of its target.
//
// Why: `nuxt build` produces a Nitro server whose isolated `node_modules`
// (e.g. `unhead` -> `hookable`) is wired up with symlinks into a shared
// `.nitro/<pkg>@<version>` store. `npm pack`/`npm publish` silently DROP
// symlinks from the tarball, so the published package can't resolve those
// deps and the `web` command 500s with ERR_MODULE_NOT_FOUND. Dereferencing
// the symlinks into real directories makes `web/.output` self-contained and
// survive packing.
import { readdir, lstat, readlink, rm, cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../web/.output",
);

/** Collect every symlink path under `dir` (recursing into real dirs only). */
async function findSymlinks(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return found;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      found.push(full);
    } else if (entry.isDirectory()) {
      found.push(...(await findSymlinks(full)));
    }
  }
  return found;
}

const links = await findSymlinks(outputDir);
if (links.length === 0) {
  console.log(`deref-output-symlinks: no symlinks under ${outputDir}`);
} else {
  for (const link of links) {
    const target = resolve(dirname(link), await readlink(link));
    const stat = await lstat(target).catch(() => null);
    if (!stat) {
      throw new Error(`Dangling symlink ${link} -> ${target}`);
    }
    await rm(link);
    // dereference: copy the real target contents in place of the symlink.
    await cp(target, link, { recursive: true, dereference: true });
    console.log(`deref-output-symlinks: ${link} <= ${target}`);
  }
  console.log(`deref-output-symlinks: dereferenced ${links.length} symlink(s)`);
}
