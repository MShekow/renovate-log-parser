/**
 * Sorts filter-menu options so already-selected values surface at the top
 * (letting users find their active selections without scrolling), with both
 * groups alphabetized within themselves. Shared by `RepositoryFilterMenu` and
 * `FieldsFilterMenu`.
 */
export function sortSelectedFirst<T>(items: T[], isSelected: (item: T) => boolean): T[] {
  const selected: T[] = []
  const unselected: T[] = []
  for (const item of items) (isSelected(item) ? selected : unselected).push(item)
  const byAlpha = (a: T, b: T): number => String(a).localeCompare(String(b))
  return [...selected.sort(byAlpha), ...unselected.sort(byAlpha)]
}
