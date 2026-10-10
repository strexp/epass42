<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NPopconfirm,
  NSpace,
  useMessage,
} from 'naive-ui'
import { Download, RefreshCw } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadText } from '~/utils/download'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface RequestRow {
  reference: string
  status: string
  mnt: string | null
  ip: string | null
  dscSelection: string
  deliveryMode: string
}

const { state, ensureLoaded } = useRealm('dsc')
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const requests = ref<RequestRow[]>([])
const queue = ref<RequestRow[]>([])
const loading = ref(false)

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const isReviewer = computed(() => (state.value.me?.reviewScope ?? 'none') !== 'none')

function openDetails(row: RequestRow): void {
  void navigateTo(`/dsc/requests/${row.reference}`)
}

/** Makes the whole row open the request (the buttons stay for keyboard users). */
function rowProps(row: RequestRow) {
  return {
    style: 'cursor: pointer;',
    onClick: () => openDetails(row),
  }
}

async function load(): Promise<void> {
  loading.value = true
  try {
    try {
      requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests')).items ?? []
    } catch {
      requests.value = []
    }
    if (isAdmin.value) {
      try {
        queue.value = (await api<{ items: RequestRow[] }>('/dsc/admin/requests')).items ?? []
      } catch {
        queue.value = []
      }
    }
  } finally {
    loading.value = false
  }
}

async function adminReveal(reference: string): Promise<void> {
  try {
    const perso = await api<string>(`/dsc/admin/requests/${reference}/reveal`, { method: 'POST' })
    downloadText(`perso-${reference}.txt`, perso)
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

const columns = computed(() => [
  {
    title: t('dsc.requestReference'),
    key: 'reference',
    render: (row: RequestRow) => h('span', { class: 'epass42-mono' }, row.reference),
  },
  { title: 'MNT', key: 'mnt' },
  { title: 'IP', key: 'ip' },
  { title: t('dsc.signingCertificate'), key: 'dscSelection' },
  {
    title: t('dsc.statusTitle'),
    key: 'status',
    render: (row: RequestRow) => h(StatusTag, { status: row.status }),
  },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h(
        NButton,
        {
          size: 'tiny',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            openDetails(row)
          },
        },
        { default: () => t('dsc.viewDetails') },
      ),
  },
])

const queueColumns = computed(() => [
  {
    title: t('dsc.requestReference'),
    key: 'reference',
    render: (row: RequestRow) => h('span', { class: 'epass42-mono' }, row.reference),
  },
  { title: 'MNT', key: 'mnt' },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h('div', { class: 'epass42-actions' }, [
        h(
          NButton,
          {
            size: 'tiny',
            onClick: (event: MouseEvent) => {
              event.stopPropagation()
              openDetails(row)
            },
          },
          { default: () => t('dsc.viewDetails') },
        ),
        h(
          NPopconfirm,
          { onPositiveClick: () => void adminReveal(row.reference) },
          {
            trigger: () =>
              h(
                NButton,
                {
                  size: 'tiny',
                  onClick: (event: MouseEvent) => event.stopPropagation(),
                },
                {
                  icon: () => h(NIcon, null, { default: () => h(Download) }),
                  default: () => t('dsc.produce'),
                },
              ),
            default: () => t('dsc.produceConfirm'),
          },
        ),
      ]),
  },
])

onMounted(async () => {
  await ensureLoaded()
  // The review queue is not for ordinary users.
  if (!isReviewer.value) {
    await navigateTo('/dsc')
    return
  }
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('dsc.adminTitle')" :subtitle="$t('dsc.reviewHint')" />

      <NCard :title="$t('dsc.reviewQueue')" size="small">
        <template #action>
          <NButton size="small" @click="load">
            <template #icon
              ><NIcon><RefreshCw /></NIcon
            ></template>
            {{ $t('common.reload') }}
          </NButton>
        </template>
        <NDataTable
          v-if="requests.length"
          :columns="columns"
          :data="requests"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
          :row-props="rowProps"
          size="small"
        />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>

      <NCard v-if="isAdmin" :title="$t('dsc.pendingQueue')" size="small">
        <NDataTable
          v-if="queue.length"
          :columns="queueColumns"
          :data="queue"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
          :row-props="rowProps"
          size="small"
        />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
