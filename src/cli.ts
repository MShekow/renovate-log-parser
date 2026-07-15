#!/usr/bin/env node
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { detectErrorsCommand } from './commands/detect-errors.js'
import { webCommand } from './commands/web.js'

await yargs(hideBin(process.argv))
  .scriptName('renovate-log-parser')
  .usage('$0 <command> [options]')
  .command(detectErrorsCommand)
  .command(webCommand)
  .demandCommand(1, 'You need to specify a command. Try --help.')
  .strict()
  .alias('h', 'help')
  .alias('v', 'version')
  .help()
  .parseAsync()
