/**
 * `useFilters` — the single reactive filter model that drives the log viewer's
 * row query. It is a module-level singleton (like {@link useLog}) so
 * the filter bar, the row list, and the context menus all read and mutate the
 * same state.
 *
 * The state maps 1:1 onto the server's `filters` wire format (see
 * `web/server/utils/translate-filters.ts`):
 *   - {@link levels}          -> `levelIn`   (empty = all levels)
 *   - {@link repoMode}/{@link repoValues}/{@link repoIndependent} -> `inSet` on `repository`
 *   - {@link ignoredFields}   -> response projection (which root keys to strip)
 *   - {@link searchField}/{@link searchPattern} -> a case-insensitive `like`
 *   - {@link pills}           -> arbitrary core {@link Filter}s with an enable toggle
 *
 * {@link serialized} is the JSON string actually sent as the query param; the
 * page watches it (debounced) to refetch. Filter controls are split into
 * "static dropdowns" (levels/repositories/ignored-fields, mutated by the
 * dedicated menus and by row-context "level/repo" actions) and "dynamic pills"
 * (created by message- and JSON-field context menus).
 */
import type { Filter, ScalarValue } from 'renovate-core/filters'
import type { FilterWire, Pill } from '~/types'

/**
 * Root keys stripped from rows by default — the noisy Renovate envelope fields
 * (matches the `analyze` command's default `--ignored-fields`).
 */
const DEFAULT_IGNORED_FIELDS = [
  'v',
  'time',
  'logContext',
  'pid',
  'hostname',
  'name'
] as const

/** The root key the free-text search targets by default. */
const DEFAULT_SEARCH_FIELD = 'msg'

/**
 * Sentinel {@link searchField} value selecting "raw search" — a wildcard match
 * against the whole serialized log line (any key or any value) rather than one
 * field. The label doubles as the value; Renovate root keys are camelCase
 * identifiers, so a spaced/capitalised token cannot collide with a real field.
 */
export const RAW_SEARCH = 'Raw search'

// --- Singleton state -------------------------------------------------------
const levels = ref<number[]>([])
const repoMode = ref<'include' | 'exclude'>('include')
const repoValues = ref<string[]>([])
const repoIndependent = ref(false)
const ignoredFields = ref<string[]>([...DEFAULT_IGNORED_FIELDS])
const searchField = ref<string>(DEFAULT_SEARCH_FIELD)
const searchPattern = ref<string>('')
const pills = ref<Pill[]>([])

let pillCounter = 0
function nextPillId(): string {
  return `pill-${++pillCounter}`
}

/**
 * Turn a raw search box value into a `like` pattern. If the user already used a
 * `*` wildcard the pattern is honoured verbatim (anchored); otherwise it is
 * wrapped in `*…*` so the natural "contains" search UX works.
 */
function toContainsPattern(raw: string): string {
  return raw.includes('*') ? raw : `*${raw}*`
}

/** The filter wire object, rebuilt reactively; empty sections are omitted. */
const wire = computed<FilterWire>(() => {
  const w: FilterWire = {}

  if (levels.value.length > 0) w.levels = [...levels.value]

  if (repoValues.value.length > 0 || repoIndependent.value) {
    w.repositories = {
      mode: repoMode.value,
      values: [...repoValues.value],
      independent: repoIndependent.value
    }
  }

  if (ignoredFields.value.length > 0) w.ignoredFields = [...ignoredFields.value]

  const pattern = searchPattern.value.trim()
  if (pattern.length > 0) {
    const raw = searchField.value === RAW_SEARCH
    w.search = {
      field: raw ? '' : searchField.value || DEFAULT_SEARCH_FIELD,
      pattern: toContainsPattern(pattern),
      scope: raw ? 'raw' : 'field'
    }
  }

  if (pills.value.length > 0) {
    w.pills = pills.value.map(p => ({
      id: p.id,
      enabled: p.enabled,
      filter: p.filter
    }))
  }

  return w
})

/** JSON string of {@link wire}; the value sent as the `filters` query param. */
const serialized = computed(() => JSON.stringify(wire.value))

/**
 * Whether the ignored-fields projection currently matches its default envelope
 * set (order-independent). Drives the "Reset to defaults" affordance in the
 * Hidden-fields menu.
 */
const isDefaultIgnoredFields = computed(
  () =>
    ignoredFields.value.length === DEFAULT_IGNORED_FIELDS.length
    && DEFAULT_IGNORED_FIELDS.every(f => ignoredFields.value.includes(f))
)

/** Count of active constraints, for a badge on the filter controls. */
const activeCount = computed(() => {
  let n = 0
  if (levels.value.length > 0) n++
  if (repoValues.value.length > 0 || repoIndependent.value) n++
  if (searchPattern.value.trim().length > 0) n++
  n += pills.value.filter(p => p.enabled).length
  return n
})

// --- Helpers ---------------------------------------------------------------

/** Toggle membership of `value` in a string-array ref. */
function toggleIn(list: Ref<string[]>, value: string): void {
  list.value = list.value.includes(value)
    ? list.value.filter(v => v !== value)
    : [...list.value, value]
}

/** Canonical signature of a filter, for de-duplicating pills. */
function filterSignature(filter: Filter): string {
  return JSON.stringify(filter, Object.keys(filter).sort())
}

/** Human-readable rendering of a scalar for pill labels. */
function formatScalar(value: ScalarValue): string {
  return typeof value === 'string' ? value : String(value)
}

/**
 * Add a pill for `filter` (deduped by signature). If an equivalent pill already
 * exists it is re-enabled rather than duplicated.
 */
function addPill(filter: Filter, label: string): void {
  const sig = filterSignature(filter)
  const existing = pills.value.find(p => filterSignature(p.filter) === sig)
  if (existing) {
    if (!existing.enabled) {
      existing.enabled = true
      pills.value = [...pills.value]
    }
    return
  }
  pills.value = [
    ...pills.value,
    { id: nextPillId(), enabled: true, label, filter }
  ]
}

export function useFilters() {
  // --- Levels (static dropdown) --------------------------------------------
  function toggleLevel(level: number): void {
    levels.value = levels.value.includes(level)
      ? levels.value.filter(l => l !== level)
      : [...levels.value, level]
  }
  function showOnlyLevel(level: number): void {
    levels.value = [level]
  }
  /** Hide a level: keep every other level present in the current log. */
  function hideLevel(level: number): void {
    const present = presentLevels()
    levels.value = present.filter(l => l !== level)
  }
  function clearLevels(): void {
    levels.value = []
  }

  /** Numeric levels that actually occur in the loaded log (sorted). */
  function presentLevels(): number[] {
    const counts = useLog().info.value?.levelCounts ?? {}
    return Object.keys(counts)
      .map(Number)
      .filter(n => !Number.isNaN(n))
      .sort((a, b) => a - b)
  }

  // --- Repositories (static dropdown) --------------------------------------
  function setRepoMode(mode: 'include' | 'exclude'): void {
    repoMode.value = mode
  }
  function toggleRepo(value: string): void {
    toggleIn(repoValues, value)
  }
  function setRepoIndependent(value: boolean): void {
    repoIndependent.value = value
  }
  function showOnlyRepo(value: string): void {
    repoMode.value = 'include'
    repoValues.value = [value]
    repoIndependent.value = false
  }
  function hideRepo(value: string): void {
    if (repoMode.value !== 'exclude') repoValues.value = []
    repoMode.value = 'exclude'
    repoIndependent.value = false
    if (!repoValues.value.includes(value)) {
      repoValues.value = [...repoValues.value, value]
    }
  }
  function clearRepos(): void {
    repoValues.value = []
    repoIndependent.value = false
    repoMode.value = 'include'
  }

  // --- Ignored fields (static dropdown) ------------------------------------
  function toggleIgnoredField(field: string): void {
    if (field === 'msg') return // msg is never strippable (plan)
    toggleIn(ignoredFields, field)
  }
  function isIgnored(field: string): boolean {
    return ignoredFields.value.includes(field)
  }
  /** Restore the ignored-fields projection to its default envelope set. */
  function resetIgnoredFields(): void {
    ignoredFields.value = [...DEFAULT_IGNORED_FIELDS]
  }

  // --- Search --------------------------------------------------------------
  function setSearch(field: string, pattern: string): void {
    searchField.value = field || DEFAULT_SEARCH_FIELD
    searchPattern.value = pattern
  }
  function clearSearch(): void {
    searchPattern.value = ''
  }

  // --- Pills (dynamic) -----------------------------------------------------
  function showOnlyField(field: string): void {
    addPill({ type: 'presence', field }, `has "${field}"`)
  }
  function hideField(field: string): void {
    addPill({ type: 'presence', field, negate: true }, `no "${field}"`)
  }
  function showOnlyValue(field: string, value: ScalarValue): void {
    addPill(
      { type: 'equals', field, value },
      `${field} = ${formatScalar(value)}`
    )
  }
  function hideValue(field: string, value: ScalarValue): void {
    addPill(
      { type: 'equals', field, value, negate: true },
      `${field} ≠ ${formatScalar(value)}`
    )
  }
  /**
   * Nested-key search pills. Right-clicking a key
   * nested below a root key filters on the root ancestor's serialized value
   * containing the compact JSON `fragment` (e.g. `"hostType":"github"`). This
   * reuses the field-scoped `like` filter (case-insensitive `*`-wildcard); a
   * literal `*` inside a value is treated as a wildcard (accepted caveat, e.g.
   * masked `token` values). The caller supplies the friendly `label`.
   */
  function showOnlyContains(field: string, fragment: string, label: string): void {
    addPill({ type: 'like', field, pattern: `*${fragment}*` }, label)
  }
  function hideContains(field: string, fragment: string, label: string): void {
    addPill({ type: 'like', field, pattern: `*${fragment}*`, negate: true }, label)
  }
  function togglePill(id: string): void {
    const pill = pills.value.find(p => p.id === id)
    if (!pill) return
    pill.enabled = !pill.enabled
    pills.value = [...pills.value]
  }
  function removePill(id: string): void {
    pills.value = pills.value.filter(p => p.id !== id)
  }
  function clearPills(): void {
    pills.value = []
  }

  /** Reset every constraint to defaults (used when a new log is loaded). */
  function reset(): void {
    levels.value = []
    clearRepos()
    ignoredFields.value = [...DEFAULT_IGNORED_FIELDS]
    searchField.value = DEFAULT_SEARCH_FIELD
    searchPattern.value = ''
    pills.value = []
  }

  /** Clear all active filters but keep the ignored-fields projection. */
  function clearAll(): void {
    levels.value = []
    clearRepos()
    searchField.value = DEFAULT_SEARCH_FIELD
    searchPattern.value = ''
    pills.value = []
  }

  return {
    // reactive state (read/write refs, shared singleton)
    levels,
    repoMode,
    repoValues,
    repoIndependent,
    ignoredFields,
    searchField,
    searchPattern,
    pills,
    // derived
    wire,
    serialized,
    activeCount,
    isDefaultIgnoredFields,
    // levels
    toggleLevel,
    showOnlyLevel,
    hideLevel,
    clearLevels,
    presentLevels,
    // repositories
    setRepoMode,
    toggleRepo,
    setRepoIndependent,
    showOnlyRepo,
    hideRepo,
    clearRepos,
    // ignored fields
    toggleIgnoredField,
    isIgnored,
    resetIgnoredFields,
    // search
    setSearch,
    clearSearch,
    // pills
    showOnlyField,
    hideField,
    showOnlyValue,
    hideValue,
    showOnlyContains,
    hideContains,
    togglePill,
    removePill,
    clearPills,
    // lifecycle
    reset,
    clearAll
  }
}
