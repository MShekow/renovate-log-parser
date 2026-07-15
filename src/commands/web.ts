import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type { CommandModule } from 'yargs'

interface WebArgs {
  port: number
  host: string
  open: boolean
}

/**
 * Resolve the prebuilt Nitro server entry that ships inside this package.
 * Layout after `tsc`: dist/commands/web.js  →  ../../web/.output/server/index.mjs
 */
function resolveServerEntry(): string {
  return fileURLToPath(
    new URL('../../web/.output/server/index.mjs', import.meta.url)
  )
}

/** Best-effort, dependency-free browser opener. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]

  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // Opening the browser is non-critical; ignore failures.
  }
}

/**
 * `web` — starts the bundled Nuxt (Nitro) production server.
 */
export const webCommand: CommandModule<object, WebArgs> = {
  command: 'web',
  describe: 'Start the Nuxt-based web UI',
  builder: (yargs) =>
    yargs
      .option('port', {
        type: 'number',
        default: 3000,
        describe: 'Port to listen on'
      })
      .option('host', {
        type: 'string',
        default: 'localhost',
        describe: 'Host to bind to'
      })
      .option('open', {
        type: 'boolean',
        default: true,
        describe: 'Open the web UI in your browser'
      }),
  handler: (argv) => {
    const serverEntry = resolveServerEntry()

    if (!existsSync(serverEntry)) {
      console.error(
        'The web UI has not been built yet.\n' +
          'Expected server bundle at:\n  ' +
          serverEntry +
          '\nRun "npm run build" from the package source before using the "web" command.'
      )
      process.exitCode = 1
      return
    }

    const url = `http://${argv.host}:${argv.port}`
    console.log(`Starting renovate-log-parser web UI on ${url}`)

    const child = spawn(process.execPath, [serverEntry], {
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(argv.port),
        HOST: argv.host,
        NITRO_PORT: String(argv.port),
        NITRO_HOST: argv.host
      }
    })

    if (argv.open) {
      // Give Nitro a moment to bind before opening the browser.
      setTimeout(() => openBrowser(url), 1000)
    }

    const forward = (signal: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(signal)
    }
    process.on('SIGINT', forward('SIGINT'))
    process.on('SIGTERM', forward('SIGTERM'))

    child.on('exit', (code) => {
      process.exitCode = code ?? 0
    })
  }
}
