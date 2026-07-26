/**
 * Maps the semantic {@link LevelColor} tokens from the shared core onto concrete
 * Nuxt UI / Tailwind classes for the log-level glyph. Keeping the mapping in a
 * single place (the `LEVEL_CLASS` map below) means the CLI and web layers
 * agree on level semantics while the visual treatment lives here.
 */
import type { LevelColor } from 'renovate-core/levels'

/**
 * Tailwind classes applied to a level glyph badge, keyed by its semantic color.
 * `red-filled` (fatal) is the only inverted/filled treatment; the rest are
 * text-color only. Includes a fixed-size, centered, monospace base so glyphs
 * line up in the virtualized list.
 */
export const LEVEL_CLASS: Record<LevelColor, string> = {
  'muted': 'text-dimmed',
  'neutral': 'text-toned',
  'green': 'text-success',
  'amber': 'text-warning',
  'red': 'text-error font-semibold',
  'red-filled': 'bg-error text-inverted font-semibold rounded-sm'
}

/** Shared base classes for the level glyph box (fixed width for alignment). */
export const LEVEL_GLYPH_BASE
  = 'inline-flex items-center justify-center w-5 h-5 shrink-0 font-mono text-xs leading-none'
