<script setup lang="ts">
/**
 * FieldsFilterMenu — the static "ignored fields" dropdown (Phase 5b). Lists the
 * distinct root-level keys in the current log (from `GET /api/fields`) as
 * checkboxes; a checked field is stripped from every row (and the details
 * panel). `msg` is never listable/strippable (plan). This shapes the response
 * projection, not row matching.
 */
const filters = useFilters()
const log = useLog()

const fields = ref<string[]>([])
const loading = ref(false)
const search = ref('')

/** (Re)fetch the distinct root keys for the current log. */
async function fetchFields(): Promise<void> {
  if (!log.info.value) {
    fields.value = []
    return
  }
  loading.value = true
  try {
    const all = await $fetch<string[]>('/api/fields')
    fields.value = all.filter(f => f !== 'msg')
  } catch {
    fields.value = []
  } finally {
    loading.value = false
  }
}

watch(() => log.info.value?.md5, fetchFields, { immediate: true })

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const matches = q ? fields.value.filter(f => f.toLowerCase().includes(q)) : fields.value
  return sortSelectedFirst(matches, filters.isIgnored)
})
</script>

<template>
  <UPopover :content="{ align: 'start' }">
    <UButton
      icon="i-lucide-eye-off"
      color="neutral"
      variant="subtle"
      size="sm"
      trailing-icon="i-lucide-chevron-down"
    >
      Hidden fields
    </UButton>

    <template #content>
      <div class="p-2 w-72 flex flex-col gap-2">
        <p class="text-xs text-muted px-1">
          Checked fields are stripped from rows &amp; details. This is an
          advanced setting — you should usually leave it at its default. Only
          change it if your Renovate logs repurpose one of the default fields
          (e.g. you set a custom <code>name</code> or <code>hostname</code>) and
          you need to see it.
        </p>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          size="sm"
          placeholder="Filter fields…"
        />
        <div class="max-h-64 overflow-auto flex flex-col gap-0.5">
          <p
            v-if="loading"
            class="text-xs text-dimmed px-1 py-2"
          >
            Loading…
          </p>
          <p
            v-else-if="filtered.length === 0"
            class="text-xs text-dimmed px-1 py-2"
          >
            {{ fields.length === 0 ? 'No fields.' : 'No matches.' }}
          </p>
          <label
            v-for="field in filtered"
            :key="field"
            class="flex items-center gap-2 px-1 py-1 rounded hover:bg-elevated/50 cursor-pointer"
          >
            <UCheckbox
              :model-value="filters.isIgnored(field)"
              @update:model-value="filters.toggleIgnoredField(field)"
            />
            <span
              class="text-xs font-mono truncate"
              :title="field"
            >{{ field }}</span>
          </label>
        </div>
        <UButton
          icon="i-lucide-rotate-ccw"
          label="Reset to defaults"
          color="neutral"
          variant="ghost"
          size="xs"
          block
          :disabled="filters.isDefaultIgnoredFields.value"
          @click="filters.resetIgnoredFields()"
        />
      </div>
    </template>
  </UPopover>
</template>
