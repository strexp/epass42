<script setup lang="ts">
import {
  NButton,
  NCard,
  NCode,
  NDataTable,
  NEmpty,
  NIcon,
  NPopover,
  NSelect,
  NSpace,
  NTag,
  useMessage,
} from 'naive-ui'
import { RefreshCw } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import type { Realm } from '@epass42/shared'
import DateTimeText from '~/components/common/DateTimeText.vue'
import { errorMessageKey } from '~/composables/useApi'

/** The `GET /:realm/audit` payload. */
interface AuditEntry {
  id: number
  createdAt: string
  actor: string | null
  actorMnt: string | null
  action: string
  targetType: string | null
  targetId: string | null
  ip: string | null
  userAgent: string | null
  detail: unknown
}

const props = defineProps<{ realm: Realm }>()

const api = useApi()
const { t } = useI18n()
const message = useMessage()

const entries = ref<AuditEntry[]>([])
const loading = ref(false)
const actionFilter = ref<string | null>(null)

/** The table page size; the audit log can grow without bound. */
const pagination = { pageSize: 10 }

/** The distinct actions present in the log, for the filter control. */
const actionOptions = computed(() =>
  [...new Set(entries.value.map((entry) => entry.action))].map((action) => ({
    label: action,
    value: action,
  })),
)

const filteredEntries = computed(() =>
  actionFilter.value === null
    ? entries.value
    : entries.value.filter((entry) => entry.action === actionFilter.value),
)

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = (await api<{ items: AuditEntry[] }>(`/${props.realm}/audit`)).items ?? []
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    entries.value = []
  } finally {
    loading.value = false
  }
}

const columns = computed(() => [
  {
    title: t('audit.time'),
    key: 'createdAt',
    width: 180,
    render: (row: AuditEntry) => h(DateTimeText, { value: row.createdAt, withTime: true }),
  },
  {
    title: t('audit.actor'),
    key: 'actor',
    render: (row: AuditEntry) => row.actor ?? row.actorMnt ?? '—',
  },
  {
    title: t('audit.action'),
    key: 'action',
    render: (row: AuditEntry) => h(NTag, { size: 'small' }, () => row.action),
  },
  {
    title: t('audit.target'),
    key: 'target',
    render: (row: AuditEntry) =>
      row.targetId ? `${row.targetType ?? ''}#${row.targetId}` : (row.targetType ?? '—'),
  },
  { title: t('audit.ip'), key: 'ip' },
  {
    title: t('audit.detail'),
    key: 'detail',
    width: 220,
    render: (row: AuditEntry) =>
      row.detail
        ? h(
            NPopover,
            { trigger: 'hover', placement: 'left', style: { maxWidth: '520px' } },
            {
              trigger: () =>
                h('span', { class: 'epass42-audit-detail' }, JSON.stringify(row.detail)),
              default: () =>
                h(NCode, { language: 'json', wordWrap: true }, () =>
                  JSON.stringify(row.detail, null, 2),
                ),
            },
          )
        : '—',
  },
])

onMounted(load)
</script>

<template>
  <NCard size="small">
    <template #action>
      <NSpace align="center" :size="8">
        <NSelect
          v-model:value="actionFilter"
          :options="actionOptions"
          :placeholder="$t('common.filter')"
          :input-props="{ 'aria-label': $t('common.filter') }"
          clearable
          size="small"
          style="min-width: 200px"
        />
        <NButton size="small" :loading="loading" @click="load">
          <template #icon
            ><NIcon><RefreshCw /></NIcon
          ></template>
          {{ $t('common.reload') }}
        </NButton>
      </NSpace>
    </template>
    <div v-if="filteredEntries.length" role="region" :aria-label="$t('audit.title')">
      <NDataTable
        :columns="columns"
        :data="filteredEntries"
        :loading="loading"
        :pagination="pagination"
        size="small"
      />
    </div>
    <NEmpty v-else :description="$t('common.empty')" />
  </NCard>
</template>

<style scoped>
.epass42-audit-detail {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
