import type { CommandModule } from "yargs";

interface DetectErrorsArgs {
  file?: string;
}

/**
 * `detect-errors` — placeholder command for the log-parsing feature.
 * For now it performs basic I/O (prints "hello world").
 */
export const detectErrorsCommand: CommandModule<object, DetectErrorsArgs> = {
  command: "detect-errors [file]",
  describe: "Detect issues in a Renovate log file (currently a stub)",
  builder: (yargs) =>
    yargs.positional("file", {
      type: "string",
      describe: "Path to a Renovate debug log file to analyse",
    }),
  handler: (argv) => {
    console.log("hello world");

    if (argv.file) {
      console.log(`(stub) would parse log file: ${argv.file}`);
    }
  },
};
