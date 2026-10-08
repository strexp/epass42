<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NText, useMessage } from 'naive-ui'
import { Check, Download, RefreshCw, ScrollText, Settings, X } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadText } from '~/utils/download'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface RequestRow {
  id: number
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

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)

async function load(): Promise<void> {
  try {
    requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests')).items ?? []
  } catch {
    requests.value = []
  }
  if (!isAdmin.value) return
  try {
    queue.value = (await api<{ items: RequestRow[] }>('/dsc/admin/requests')).items ?? []
  } catch {
    queue.value = []
  }
}

async function approve(id: number): Promise<void> {
  try {
    await api(`/dsc/requests/${id}/approve`, { method: 'POST', body: {} })
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function reject(id: number): Promise<void> {
  try {
    await api(`/dsc/requests/${id}/reject`, { method: 'POST', body: { reason: 'rejected' } })
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function adminReveal(id: number): Promise<void> {
  try {
    const perso = await api<string>(`/dsc/admin/requests/${id}/reveal`, { method: 'POST' })
    downloadText(`perso-${id}.txt`, perso)
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

const columns = [
  { title: '#', key: 'id' },
  { title: 'MNT', key: 'mnt' },
  { title: 'IP', key: 'ip' },
  { title: 'DSC', key: 'dscSelection' },
  {
    title: 'Status',
    key: 'status',
    render: (row: RequestRow) => h(StatusTag, { status: row.status }),
  },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      row.status === 'submitted'
        ? h('div', { class: 'epass42-actions' }, [
            h(
              NButton,
              { size: 'tiny', type: 'primary', onClick: () => approve(row.id) },
              {
                icon: () => h(NIcon, null, { default: () => h(Check) }),
                default: () => t('common.approve'),
              },
            ),
            h(
              NButton,
              { size: 'tiny', onClick: () => reject(row.id) },
              {
                icon: () => h(NIcon, null, { default: () => h(X) }),
                default: () => t('common.reject'),
              },
            ),
          ])
        : null,
  },
]

const queueColumns = [
  { title: '#', key: 'id' },
  { title: 'MNT', key: 'mnt' },
  { title: 'IP', key: 'ip' },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h(
        NButton,
        { size: 'tiny', onClick: () => adminReveal(row.id) },
        {
          icon: () => h(NIcon, null, { default: () => h(Download) }),
          default: () => t('dsc.reveal'),
        },
      ),
  },
]

onMounted(async () => {
  await ensureLoaded()
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('dsc.adminTitle') }}</h1>
        <NText v-if="!isAdmin" depth="3">{{ $t('dsc.reviewerOnly') }}</NText>
      </div>

      <NCard :title="$t('dsc.reviewQueue')" size="small">
        <template #action>
          <NSpace>
            <NuxtLink v-if="isAdmin" to="/dsc/settings">
              <NButton size="small">
                <template #icon
                  ><NIcon><Settings /></NIcon
                ></template>
                {{ $t('dsc.settingsTitle') }}
              </NButton>
            </NuxtLink>
            <NuxtLink v-if="isAdmin" to="/dsc/audit">
              <NButton size="small">
                <template #icon
                  ><NIcon><ScrollText /></NIcon
                ></template>
                {{ $t('audit.title') }}
              </NButton>
            </NuxtLink>
            <NButton size="small" @click="load">
              <template #icon
                ><NIcon><RefreshCw /></NIcon
              ></template>
              {{ $t('common.reload') }}
            </NButton>
          </NSpace>
        </template>
        <NDataTable v-if="requests.length" :columns="columns" :data="requests" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>

      <NCard v-if="isAdmin" :title="$t('dsc.pendingQueue')" size="small">
        <NDataTable v-if="queue.length" :columns="queueColumns" :data="queue" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
