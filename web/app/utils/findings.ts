/**
 * Display metadata for error-detector finding categories.
 *
 * The shared core owns the semantics (which categories exist and whether each is
 * an error or a warning); this module owns the web presentation — a human label,
 * an icon and the severity per category, plus the Nuxt UI color token for each
 * severity. Keeping it here (rather than importing the core `SEVERITY` value)
 * matters: `error-detector` transitively pulls in the Node-only `Parser`, so it
 * must never reach the client bundle. Only its *types* are imported here.
 */
import type { Category, Severity } from 'renovate-core/error-detector'

/** Human label, icon and severity for each finding category. */
export const FINDING_CATEGORY_META: Record<
  Category,
  { label: string, icon: string, severity: Severity }
> = {
  'host-error-abort': {
    label: 'Host error abort',
    icon: 'i-lucide-plug-zap',
    severity: 'error'
  },
  'log-warn': {
    label: 'Warnings',
    icon: 'i-lucide-triangle-alert',
    severity: 'warning'
  },
  'log-error': {
    label: 'Errors',
    icon: 'i-lucide-circle-x',
    severity: 'error'
  },
  'log-fatal': {
    label: 'Fatal',
    icon: 'i-lucide-skull',
    severity: 'error'
  },
  'err-object': {
    label: 'Error objects',
    icon: 'i-lucide-bug',
    severity: 'warning'
  },
  'config-migration': {
    label: 'Config migration',
    icon: 'i-lucide-file-cog',
    severity: 'error'
  },
  'invalid-config': {
    label: 'Invalid config',
    icon: 'i-lucide-file-x',
    severity: 'error'
  },
  'abandoned-package': {
    label: 'Abandoned packages',
    icon: 'i-lucide-package-x',
    severity: 'error'
  },
  'repo-problem': {
    label: 'Repository problems',
    icon: 'i-lucide-folder-x',
    severity: 'warning'
  }
}

/** Nuxt UI color token for each severity (drives badges and count pills). */
export const SEVERITY_COLOR: Record<Severity, 'error' | 'warning'> = {
  error: 'error',
  warning: 'warning'
}
