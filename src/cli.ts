#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { detectErrorsCommand } from "./commands/detect-errors.js";
import { analyzeCommand } from "./commands/analyze.js";
import { webCommand } from "./commands/web.js";

await yargs(hideBin(process.argv))
  .scriptName("renovate-log-parser")
  .usage("$0 <command> [options]")
  .command(detectErrorsCommand)
  .command(analyzeCommand)
  .command(webCommand)
  .demandCommand(1, "You need to specify a command. Try --help.")
  .strict()
  .alias("h", "help")
  .alias("v", "version")
  .fail((msg, err) => {
    // Genuine thrown errors propagate; usage/validation failures exit with the
    // tool/usage exit code (2).
    if (err) throw err;
    console.error(msg);
    console.error("\nRun with --help for usage.");
    process.exit(2);
  })
  .help()
  .parseAsync();
