/**
 * Renovate log level metadata: numeric level -> single-letter glyph + semantic
 * color. Shared by the web UI (row glyphs) and any CLI text rendering.
 *
 * Colors are expressed as semantic tokens (not raw hex) so the web layer can
 * map them onto Nuxt UI / Tailwind classes: info = green, warn = amber,
 * error = red, fatal = red (filled),
 * trace/debug = muted; unknown levels render their raw number.
 */

/** Semantic color token for a log level. */
export type LevelColor =
  "muted" | "neutral" | "green" | "amber" | "red" | "red-filled";

/** Presentation metadata for a single Renovate log level. */
export interface LevelMeta {
  /** Numeric level as emitted by Renovate (bunyan levels). */
  level: number;
  /** Human name (trace/debug/info/warn/error/fatal). */
  name: string;
  /** Single uppercase glyph shown in the UI. */
  symbol: string;
  /** Semantic color token. */
  color: LevelColor;
}

/** All known Renovate log levels, keyed by numeric level. */
export const LEVELS: Readonly<Record<number, LevelMeta>> = {
  10: { level: 10, name: "trace", symbol: "T", color: "muted" },
  20: { level: 20, name: "debug", symbol: "D", color: "neutral" },
  30: { level: 30, name: "info", symbol: "I", color: "green" },
  40: { level: 40, name: "warn", symbol: "W", color: "amber" },
  50: { level: 50, name: "error", symbol: "E", color: "red" },
  60: { level: 60, name: "fatal", symbol: "F", color: "red-filled" },
};

/** Levels considered build-breaking errors by `detect-errors`. */
export const ERROR_LEVELS: readonly number[] = [50, 60];

/** The warn level surfaced as a (non-breaking) warning by `detect-errors`. */
export const WARN_LEVEL = 40;

/**
 * Resolve presentation metadata for a level. Unknown/unexpected levels fall
 * back to their raw number rendered in a muted color.
 */
export function levelMeta(level: number): LevelMeta {
  return (
    LEVELS[level] ?? {
      level,
      name: String(level),
      symbol: String(level),
      color: "muted",
    }
  );
}
