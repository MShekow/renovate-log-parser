/**
 * Pixel-exact screenshot regression support for the browser E2E tests.
 *
 * The baselines in `e2e/screenshots/` are committed, so a `web` UI regression
 * shows up as a failing test and a reviewable image diff instead of quietly
 * shipping. Any differing pixel fails — there is no tolerance — which is only
 * a meaningful contract because the comparison runs in one frozen environment:
 * the container built from `e2e/Dockerfile` (pinned base image, pinned Chromium,
 * fixed fontconfig). Chromium, FreeType and font files all decide what the PNG
 * looks like, so "the same pixels on any machine" is not achievable and is not
 * what this promises.
 *
 * Consequently the screenshot cases self-skip unless `RLP_SCREENSHOTS` is set,
 * which only the `test:e2e:screenshots*` npm scripts (and CI) do:
 *
 *   npm run test:e2e:screenshots          # compare against the committed PNGs
 *   npm run test:e2e:screenshots:update   # rewrite them after an intended change
 *
 * A plain `npm run test:e2e` on the host keeps working and reports them skipped.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Page } from "playwright-core";

/** Repository root (this file lives in `<root>/e2e`). */
const REPO_ROOT = resolve(import.meta.dirname, "..");

/** Committed baselines. Reviewed like source: a diff here is a UI change. */
const BASELINE_DIR = join(REPO_ROOT, "e2e", "screenshots");

/** Shared with the other browser tests; gitignored, uploaded by CI on failure. */
const ARTIFACT_DIR = join(REPO_ROOT, "e2e-artifacts");

/** Command that regenerates the baselines, quoted in every failure message. */
const UPDATE_COMMAND = "npm run test:e2e:screenshots:update";

/**
 * How long `stabilize` waits for the web font. Generous: the point is to
 * distinguish "not loaded yet" from "will never load", not to time anything.
 */
const FONT_TIMEOUT_MS = 10_000;

/** `compare` asserts against the baselines, `update` rewrites them. */
type ScreenshotMode = "compare" | "update";

function readMode(): ScreenshotMode | undefined {
  const raw = process.env.RLP_SCREENSHOTS;
  if (raw === undefined || raw === "") return undefined;
  if (raw === "compare" || raw === "update") return raw;
  // Silently skipping on a typo would turn the whole suite into a no-op.
  throw new Error(
    `RLP_SCREENSHOTS must be "compare" or "update", got ${JSON.stringify(raw)}`,
  );
}

const MODE = readMode();

/**
 * `false` when screenshots should run, otherwise the reason node:test prints —
 * feed straight into a test's `skip` option.
 */
export const SCREENSHOT_SKIP: false | string =
  MODE === undefined
    ? "pixel comparison only runs in the pinned container (npm run test:e2e:screenshots)"
    : false;

/**
 * Put the page into the one state a byte-comparable screenshot can be taken in.
 *
 * Every step here fixes a real source of run-to-run variance: the OS colour
 * scheme (Nuxt UI follows it), CSS transitions that may be mid-flight, and web
 * fonts that swap in after first paint and reflow everything.
 */
export async function stabilize(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.waitForLoadState("networkidle");

  // `font-display: swap` means the first paint can use the fallback font; wait
  // for the real one and fail loudly if it never arrives, because a silent
  // fallback would bake the wrong glyphs into a baseline.
  //
  // Poll rather than sample once. `document.fonts.ready` hands back the promise
  // that already resolved during page load, so for a case that opens a panel
  // after that point the freshly inserted text can put a face back into
  // `loading` — and `check()` is false for anything not `loaded`. Reading both
  // in the same frame, repeatedly, closes that window; a genuinely absent face
  // still fails, just via the timeout.
  try {
    await page.waitForFunction(
      async () => {
        await document.fonts.ready;
        return document.fonts.check('16px "Public Sans"');
      },
      undefined,
      { timeout: FONT_TIMEOUT_MS },
    );
  } catch {
    throw new Error(
      'the self-hosted "Public Sans" face never loaded — the UI is rendering ' +
        "in a fallback font, so any baseline taken now would be meaningless",
    );
  }

  // Let the layout that the font may have shifted settle before capturing.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      }),
  );
}

/** Write a PNG next to the other failure artifacts, creating the dir lazily. */
function writeArtifact(name: string, data: Buffer): string {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const path = join(ARTIFACT_DIR, name);
  writeFileSync(path, data);
  return path;
}

/**
 * Capture the viewport and assert it matches `e2e/screenshots/<name>.png`
 * exactly, or rewrite that file when running in update mode.
 *
 * On a mismatch the expected, actual and diff images land in `e2e-artifacts/`
 * (CI uploads them), because a pixel count alone is not reviewable.
 */
export async function assertScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  if (MODE === undefined) {
    throw new Error("assertScreenshot called with screenshots disabled");
  }

  const actualPng = await page.screenshot({
    // Freeze CSS animations at their end state, hide the blinking caret and
    // capture in CSS pixels so a device-pixel-ratio change cannot rescale the
    // baseline: three otherwise guaranteed sources of flakiness.
    animations: "disabled",
    caret: "hide",
    scale: "css",
  });

  const baseline = join(BASELINE_DIR, `${name}.png`);

  if (MODE === "update") {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(baseline, actualPng);
    console.log(`  updated baseline e2e/screenshots/${name}.png`);
    return;
  }

  if (!existsSync(baseline)) {
    writeArtifact(`${name}-actual.png`, actualPng);
    throw new Error(
      `no baseline for "${name}" — the capture was written to ` +
        `e2e-artifacts/${name}-actual.png. Create it with \`${UPDATE_COMMAND}\`.`,
    );
  }

  const expectedPng = readFileSync(baseline);
  const expected = PNG.sync.read(expectedPng);
  const actual = PNG.sync.read(actualPng);

  if (expected.width !== actual.width || expected.height !== actual.height) {
    writeArtifact(`${name}-expected.png`, expectedPng);
    writeArtifact(`${name}-actual.png`, actualPng);
    throw new Error(
      `"${name}" changed size: baseline is ${expected.width}x${expected.height}, ` +
        `got ${actual.width}x${actual.height} (see e2e-artifacts/). ` +
        `If intended, run \`${UPDATE_COMMAND}\`.`,
    );
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const differing = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    expected.width,
    expected.height,
    // The strictest setting available: no colour-distance slack, and
    // anti-aliased pixels count as differences like any other.
    { threshold: 0, includeAA: true },
  );

  if (differing > 0) {
    writeArtifact(`${name}-expected.png`, expectedPng);
    writeArtifact(`${name}-actual.png`, actualPng);
    writeArtifact(`${name}-diff.png`, PNG.sync.write(diff));
    const total = expected.width * expected.height;
    const percent = ((differing / total) * 100).toFixed(4);
    throw new Error(
      `"${name}" does not match its baseline: ${differing} of ${total} pixels ` +
        `differ (${percent}%). Compare e2e-artifacts/${name}-expected.png, ` +
        `${name}-actual.png and ${name}-diff.png. ` +
        `If the change is intended, run \`${UPDATE_COMMAND}\` and commit the ` +
        `updated baseline.`,
    );
  }
}
