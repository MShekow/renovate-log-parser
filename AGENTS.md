# Coding agent instructions

- After changing web-development code (e.g. TypeScript or Nuxt), make sure to run linters and formatters as documented in [README.md](./README.md)
- When adding dependencies (e.g., with `npm`), use the `package-version-check` MCP to look up the latest versions, and always _pin_ versions to their exact version (e.g., not `^1.2.0` but `1.2.0`)
