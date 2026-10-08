<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NFormItem,
  NIcon,
  NInput,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { Check, Download, RefreshCw, Save, X } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { errorMessageKey } from '~/composables/useApi'

definePageMeta({ layout: 'dsc' })

interface RequestRow {
  id: number
  status: string
  asn: number | null
  dscSelection: string
  deliveryMode: string
}

const auth = useAuthStore()
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const requests = ref<RequestRow[]>([])
const queue = ref<RequestRow[]>([])
const deliveryMode = ref<'applicant' | 'reviewer'>('applicant')
const profile = ref({ issuingAuthority: '', personalizationDevice: '', dg13Policy: '' })
const revealText = ref('')

const isAdmin = computed(() => auth.realms.dsc.me?.isAdmin ?? false)

const deliveryOptions = computed(() => [
  { label: t('dsc.deliveryApplicant'), value: 'applicant' },
  { label: t('dsc.deliveryReviewer'), value: 'reviewer' },
])

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
  try {
    deliveryMode.value = (
      await api<{ deliveryMode: 'applicant' | 'reviewer' }>('/dsc/settings/delivery-mode')
    ).deliveryMode
  } catch {
    /* ignore */
  }
  try {
    profile.value = await api('/dsc/settings/issuing-profile')
  } catch {
    /* ignore */
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
    revealText.value = await api(`/dsc/admin/requests/${id}/reveal`, { method: 'POST' })
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function saveDeliveryMode(value: string): Promise<void> {
  const mode = value === 'reviewer' ? 'reviewer' : 'applicant'
  await api('/dsc/settings/delivery-mode', { method: 'PUT', body: { deliveryMode: mode } })
  deliveryMode.value = mode
  message.success(t('common.success'))
}

async function saveProfile(): Promise<void> {
  await api('/dsc/settings/issuing-profile', { method: 'PUT', body: profile.value })
  message.success(t('common.success'))
}

const columns = [
  { title: '#', key: 'id' },
  { title: 'AS', key: 'asn' },
  { title: 'DSC', key: 'dscSelection' },
  {
    title: 'Status',
    key: 'status',
    render: (row: RequestRow) =>
      h(
        NTag,
        { size: 'small', type: row.status === 'approved' ? 'success' : 'default' },
        () => row.status,
      ),
  },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      row.status === 'submitted'
        ? h('div', { class: 'pkd42-actions' }, [
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
  { title: 'AS', key: 'asn' },
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
  if (!auth.realms.dsc.loaded) await auth.fetchMe('dsc')
  await load()
})
</script>

<template>
  <div class="pkd42-page">
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('dsc.adminTitle') }}</h1>
        <NText v-if="!isAdmin" depth="3">{{ $t('dsc.reviewerOnly') }}</NText>
      </div>

      <NCard :title="$t('dsc.reviewQueue')" size="small">
        <template #action>
          <NButton size="small" @click="load">
            <template #icon
              ><NIcon><RefreshCw /></NIcon
            ></template>
            {{ $t('common.reload') }}
          </NButton>
        </template>
        <NDataTable v-if="requests.length" :columns="columns" :data="requests" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>

      <template v-if="isAdmin">
        <NCard :title="$t('dsc.pendingQueue')" size="small">
          <NDataTable v-if="queue.length" :columns="queueColumns" :data="queue" size="small" />
          <NEmpty v-else :description="$t('common.empty')" />
          <pre v-if="revealText" class="pkd42-mono">{{ revealText }}</pre>
        </NCard>

        <NCard :title="$t('dsc.deliveryMode')" size="small">
          <NSelect
            :value="deliveryMode"
            :options="deliveryOptions"
            style="max-width: 320px"
            @update:value="saveDeliveryMode"
          />
        </NCard>

        <NCard :title="$t('dsc.issuanceAuthority')" size="small">
          <NFormItem :label="$t('dsc.issuanceAuthority')">
            <NInput v-model:value="profile.issuingAuthority" />
          </NFormItem>
          <NFormItem :label="$t('dsc.personalizationDevice')">
            <NInput v-model:value="profile.personalizationDevice" />
          </NFormItem>
          <NFormItem :label="$t('dsc.dg13Policy')">
            <NInput v-model:value="profile.dg13Policy" />
          </NFormItem>
          <NButton size="small" type="primary" @click="saveProfile">
            <template #icon
              ><NIcon><Save /></NIcon
            ></template>
            {{ $t('common.save') }}
          </NButton>
        </NCard>
      </template>
    </NSpace>
  </div>
</template>
