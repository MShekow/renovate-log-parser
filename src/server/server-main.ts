/**
 * Entry point of the web server process.
 *
 * The `web` CLI command spawns this file as a child process with `PORT`/`HOST`
 * in the environment. It is also the dev-mode entry (`npm run dev:api`), in
 * which case the Nuxt dev server proxies `/api` here and the static SPA
 * directory is simply absent.
 *
 * Configuration: `--port` / `--host` flags win over the `PORT` / `HOST`
 * environment variables (flags keep the dev script platform-independent).
 */
import { startServer } from "./index.js";

/** Read a `--name value` / `--name=value` flag from argv. */
function flag(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1) return argv[index + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const port = Number.parseInt(flag("port") ?? process.env.PORT ?? "3000", 10);
const host = flag("host") ?? process.env.HOST ?? "localhost";

startServer({
  port: Number.isNaN(port) ? 3000 : port,
  host,
}).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
