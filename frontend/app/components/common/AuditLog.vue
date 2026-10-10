<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NTag, useMessage } from 'naive-ui'
import { RefreshCw } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import type { Realm } from '@epass42/shared'
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
  { title: t('audit.time'), key: 'createdAt', width: 180 },
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
    ellipsis: { tooltip: true },
    render: (row: AuditEntry) => (row.detail ? JSON.stringify(row.detail) : '—'),
  },
])

onMounted(load)
</script>

<template>
  <NCard size="small">
    <template #action>
      <NButton size="small" :loading="loading" @click="load">
        <template #icon
          ><NIcon><RefreshCw /></NIcon
        ></template>
        {{ $t('common.reload') }}
      </NButton>
    </template>
    <NDataTable
      v-if="entries.length"
      :columns="columns"
      :data="entries"
      :loading="loading"
      size="small"
    />
    <NEmpty v-else :description="$t('common.empty')" />
  </NCard>
</template>
