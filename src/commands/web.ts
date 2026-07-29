import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandModule } from "yargs";

interface WebArgs {
  path?: string;
  port: number;
  host: string;
  open: boolean;
}

/**
 * Resolve the Express server entry that ships inside this package.
 * Layout after `tsc`: dist/commands/web.js  →  ../server/server-main.js
 */
function resolveServerEntry(): string {
  return fileURLToPath(new URL("../server/server-main.js", import.meta.url));
}

/**
 * Resolve the statically-rendered SPA that the server serves.
 * Layout after `tsc`: dist/commands/web.js  →  ../../web/.output/public
 */
function resolveSpaIndex(): string {
  return fileURLToPath(
    new URL("../../web/.output/public/index.html", import.meta.url),
  );
}

/** Best-effort, dependency-free browser opener. */
function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    spawn(command, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Opening the browser is non-critical; ignore failures.
  }
}

/**
 * `web` — starts the bundled Express server, which serves the JSON API and the
 * statically-rendered Nuxt SPA.
 */
export const webCommand: CommandModule<object, WebArgs> = {
  command: "web [path]",
  describe: "Start the web UI",
  builder: (yargs) =>
    yargs
      .positional("path", {
        type: "string",
        describe: "Optional Renovate JSONL log to open automatically in the UI",
      })
      .option("port", {
        type: "number",
        default: 3000,
        describe: "Port to listen on",
      })
      .option("host", {
        type: "string",
        default: "localhost",
        describe: "Host to bind to",
      })
      .option("open", {
        type: "boolean",
        default: true,
        describe: "Open the web UI in your browser",
      }),
  handler: (argv) => {
    const serverEntry = resolveServerEntry();
    const spaIndex = resolveSpaIndex();

    const missing = !existsSync(serverEntry)
      ? serverEntry
      : !existsSync(spaIndex)
        ? spaIndex
        : null;
    if (missing) {
      console.error(
        "The web UI has not been built yet.\n" +
          "Missing:\n  " +
          missing +
          '\nRun "npm run build" from the package source before using the "web" command.',
      );
      process.exitCode = 1;
      return;
    }

    const baseUrl = `http://${argv.host}:${argv.port}`;
    // When a log path is given, resolve it to an absolute path and hand it off
    // to the UI via `?log=` — the frontend reads it on mount and POSTs it to
    // /api/log/path. The server itself does not need the path.
    let openUrl = baseUrl;
    if (argv.path) {
      const absolutePath = resolve(argv.path);
      if (!existsSync(absolutePath)) {
        console.error(`Log file not found: ${absolutePath}`);
        process.exitCode = 2;
        return;
      }
      openUrl = `${baseUrl}/?log=${encodeURIComponent(absolutePath)}`;
    }

    console.log(`Starting renovate-log-parser web UI on ${baseUrl}`);

    const child = spawn(process.execPath, [serverEntry], {
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(argv.port),
        HOST: argv.host,
      },
    });

    if (argv.open) {
      // Give the server a moment to bind before opening the browser.
      setTimeout(() => openBrowser(openUrl), 1000);
    }

    const forward = (signal: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(signal);
    };
    process.on("SIGINT", forward("SIGINT"));
    process.on("SIGTERM", forward("SIGTERM"));

    child.on("exit", (code) => {
      process.exitCode = code ?? 0;
    });
  },
};
