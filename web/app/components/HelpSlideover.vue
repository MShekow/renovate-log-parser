<script setup lang="ts">
/**
 * HelpSlideover — the "Help" panel opened from the header.
 *
 * Its job is discoverability: the viewer's most useful affordances are context
 * menus (right-click a log row, right-click a field in the details panel) and
 * modifier-free click semantics (a pill toggles, its ✕ removes), none of which
 * announce themselves. This panel is the only place they are documented in-app.
 *
 * The wording deliberately mirrors the real control labels verbatim, so a drift
 * between this text and the UI is easy to spot. When a context-menu action, the
 * search semantics ({@link useFilters}'s `toContainsPattern`) or the
 * ignored-fields defaults change, update this file too — nothing enforces it
 * automatically.
 *
 * One editing trap: Vue's default `whitespace: 'condense'` *drops* a
 * whitespace-only text node that spans a newline, so wrapping the line between
 * two inline tags (`</em>⏎<strong>`) silently glues the words together. Keep
 * such pairs on one line, or separate them with real text.
 */
const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Help"
    description="How to effectively use this renovate-log-parser web interface"
    :ui="{ content: 'sm:max-w-none w-2/5 min-w-96' }"
  >
    <template #body>
      <div class="help flex flex-col gap-6">
        <!-- Anatomy of a row. -->
        <section>
          <h3 class="help-heading">
            <UIcon
              name="i-lucide-list"
              class="size-4 shrink-0 text-primary"
            />
            How to read/interpret log lines
          </h3>
          <ul class="help-list">
            <li>
              The first column of each log line shows the <em>original</em> line
              number (irrespective of filters you configured).
            </li>
            <li>
              The coloured glyph is the log level: <code>T</code> trace,
              <code>D</code> debug, <code>I</code> info, <code>W</code> warn,
              <code>E</code> error, <code>F</code> fatal.
            </li>
            <li>
              Next to the log level, the log line's <code>msg</code> content is
              shown.
            </li>
            <li>
              If additional fields exist in a log line, the grey
              <code>key=value | key=value | ...</code> tail is a preview of
              those fields. You can click anywhere on the log line to see the
              full view of these fields in the slide-over
              <strong>details panel</strong>.
            </li>
          </ul>
        </section>

        <!-- Context menus + pills. -->
        <section>
          <h3 class="help-heading">
            <UIcon
              name="i-lucide-mouse-pointer-click"
              class="size-4 shrink-0 text-primary"
            />
            Adding filters via context menu
          </h3>
          <ul class="help-list">
            <li>
              You can right-click on a log line to see a list of ad-hoc filters
              you can set. The shown entries depend on the log line's available
              fields.
            </li>
            <li>
              Filters related to the <code>level</code> or
              <code>repository</code> automatically update the static
              level/repository filter panel at the top. Other filters (e.g.
              "Show only this message") add a
              <em>dynamic</em> <strong>filter pill</strong>.
            </li>
            <li>
              In the <strong>details panel</strong>, you can also right-click on
              fields (even nested ones) to add dynamic filters.
            </li>
            <li>
              Click a pill to switch it off: it stays visible, struck through,
              and drops out of the query. Click again to switch it back on. The
              <code>✕</code> removes the pill for good.
            </li>
            <li>
              Hover a pill whose label is cut off to see a tooltip which shows
              the full value.
            </li>
            <li>
              Pills, the dropdowns and the search box are combined with
              <strong>AND</strong>.
            </li>
          </ul>
        </section>

        <!-- Search. -->
        <section>
          <h3 class="help-heading">
            <UIcon
              name="i-lucide-search"
              class="size-4 shrink-0 text-primary"
            />
            Search
          </h3>
          <ul class="help-list">
            <li>
              The very left drop-down starting with <code>@</code>
              (<code>@msg</code> by default) chooses what field is searched. If
              you use <em>Raw search</em>, then the search query treats the
              entire log line as stringified JSON, matching keys or values.
            </li>
            <li>
              The search is case-insensitive.
            </li>
            <li>
              Without a <code>*</code> the term is a "contains" search (so
              searching for <code>foo</code> is internally converted to
              <code>*foo*</code>). As soon as you add a <code>*</code>, the term
              is used as an anchored pattern instead: <code>lock file*</code>
              matches only values that start with <code>lock file</code>.
            </li>
          </ul>
        </section>

        <!-- Hidden fields. -->
        <section>
          <h3 class="help-heading">
            <UIcon
              name="i-lucide-eye-off"
              class="size-4 shrink-0 text-primary"
            />
            Hidden fields
          </h3>
          <ul class="help-list">
            <li>
              This is a projection, not a filter: it never changes which entries
              you see, only which keys they show — both in the rows and in the
              details panel.
            </li>
            <li>
              Checked by default are Renovate's noisy keys that (normally) add
              no value: <code>v</code>, <code>time</code>,
              <code>logContext</code>, <code>pid</code>, <code>hostname</code>,
              <code>name</code>. These values are often constant across the
              entire log.
            </li>
            <li>
              Consequently, you can normally leave the <em>Hidden fields</em> at
              their defaults. Only change them if you have a special use case
              where some of these fields have values you care about.
            </li>
          </ul>
        </section>

        <!-- Problems. -->
        <section>
          <h3 class="help-heading">
            <UIcon
              name="i-lucide-shield-alert"
              class="size-4 shrink-0 text-primary"
            />
            Problems
          </h3>
          <ul class="help-list">
            <li>
              The <strong>Problems</strong> button does the same analysis as the
              CLI's <code>detect-errors</code> command. It lists recurring
              failure modes buried in a Renovate log, like runs aborted by an
              unreachable host, error / fatal / warning lines, a pending config
              migration, abandoned packages, <code>err</code> objects, and the
              <code>repoProblems</code> Renovate posts to the Dependency
              Dashboard.
            </li>
            <li>
              Click a finding to jump to its line in the log, which then briefly
              flashes.
            </li>
            <li>
              The web UI does <em>not</em> support the <em>ignore rules file</em>
              supported by the <code>detect-errors</code> CLI command.
            </li>
          </ul>
        </section>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
/*
 * Plain CSS rather than `@apply`: Tailwind v4 needs an `@reference` to the main
 * stylesheet before a scoped block may use utilities, and these three rules are
 * not worth that coupling. The Nuxt UI design tokens are already colour-scheme
 * aware, so light/dark needs no extra handling.
 */
.help-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

.help-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding-inline-start: 1.5rem;
  list-style-type: disc;
  font-size: 0.8125rem;
  line-height: 1.5rem;
  color: var(--ui-text-muted);
}

.help-list ::marker {
  color: var(--ui-text-dimmed);
}

.help :where(code) {
  border-radius: var(--ui-radius);
  background-color: var(--ui-bg-elevated);
  padding: 0.0625rem 0.25rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.75rem;
  color: var(--ui-text-highlighted);
}

.help :where(strong) {
  font-weight: 600;
  color: var(--ui-text-highlighted);
}

.help :where(em) {
  font-style: italic;
  color: var(--ui-text-highlighted);
}
</style>
