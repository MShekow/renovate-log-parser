/**
 * The Express application that backs the `web` command.
 *
 * It does two things:
 *   1. serves the JSON API under `/api` (see {@link ./api.js}), and
 *   2. serves the statically-rendered Nuxt SPA (`web/.output/public`), falling
 *      back to `index.html` for unknown paths so client-side routing works.
 *
 * There is deliberately no server-side rendering: the SPA is a static bundle,
 * so this process only ever pushes bytes and answers API calls.
 */
import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApiRouter, apiErrorHandler } from "./api.js";

/** Options for {@link createApp}. */
export interface AppOptions {
  /**
   * Directory holding the built SPA. Defaults to the `web/.output/public`
   * shipped inside this package. When it does not exist, only `/api` is served.
   */
  staticDir?: string;
}

/**
 * Directory of the prebuilt SPA shipped in this package.
 * Layout after `tsc`: dist/server/index.js → ../../web/.output/public
 */
export function defaultStaticDir(): string {
  return fileURLToPath(new URL("../../web/.output/public", import.meta.url));
}

/** Build the Express app (API + static SPA). */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const staticDir = options.staticDir ?? defaultStaticDir();

  app.use("/api", createApiRouter());
  app.use("/api", apiErrorHandler);

  const indexHtml = join(staticDir, "index.html");
  if (existsSync(indexHtml)) {
    app.use(express.static(staticDir));
    // SPA fallback: anything not matched above (and not an API call) gets the
    // app shell, which then routes client-side.
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile("index.html", { root: staticDir });
    });
  }

  return app;
}

/** Options for {@link startServer}. */
export interface ServeOptions extends AppOptions {
  port: number;
  host: string;
}

/** Start the HTTP server and resolve once it is listening. */
export function startServer(options: ServeOptions): Promise<void> {
  const app = createApp(options);
  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host, () => {
      console.log(
        `renovate-log-parser web UI listening on http://${options.host}:${options.port}`,
      );
      resolve();
    });
    server.on("error", reject);
  });
}
