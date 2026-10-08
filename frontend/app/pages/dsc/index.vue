<script setup lang="ts">
import { NButton, NCard, NDataTable, NTag, NText } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'

interface RequestRow {
  id: number
  status: string
  deliveryMode: string
  dataGroups: number[]
  createdAt: string
}

const auth = useAuthStore()
const api = useApi()
const { t } = useI18n()
const requests = ref<RequestRow[]>([])
const delegation = ref<{ asn: number | null; useNiaDsc: boolean } | null>(null)

const signedIn = computed(() => auth.realms.dsc.me !== null)

const columns = [
  { title: '#', key: 'id' },
  {
    title: 'Status',
    key: 'status',
    render: (row: RequestRow) => h(NTag, { size: 'small' }, () => row.status),
  },
  { title: 'Delivery', key: 'deliveryMode' },
  { title: 'DGs', key: 'dataGroups', render: (row: RequestRow) => row.dataGroups.join(', ') },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h(NButton, { size: 'tiny', onClick: () => navigateTo(`/dsc/status?id=${row.id}`) }, () =>
        t('dsc.query'),
      ),
  },
]

async function setDelegation(value: boolean): Promise<void> {
  delegation.value = await api('/dsc/settings/as', { method: 'PUT', body: { useNiaDsc: value } })
}

onMounted(async () => {
  if (!auth.realms.dsc.loaded) await auth.fetchMe('dsc')
  if (!signedIn.value) return
  try {
    requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests')).items
  } catch {
    requests.value = []
  }
  try {
    delegation.value = await api('/dsc/settings/as')
  } catch {
    delegation.value = null
  }
})
</script>

<template>
  <div class="pkd42-page">
    <h1>{{ $t('nav.dsc') }}</h1>
    <NText depth="2">{{ $t('home.dscCard') }}</NText>

    <div class="pkd42-actions" style="margin: 16px 0">
      <NuxtLink to="/dsc/apply"
        ><NButton type="primary">{{ $t('dsc.applyTitle') }}</NButton></NuxtLink
      >
      <NuxtLink to="/dsc/status"
        ><NButton>{{ $t('dsc.statusTitle') }}</NButton></NuxtLink
      >
      <NuxtLink to="/dsc/admin"
        ><NButton>{{ $t('dsc.reviewQueue') }}</NButton></NuxtLink
      >
    </div>

    <NCard v-if="signedIn" :title="$t('dsc.asDelegation')" size="small" style="margin-bottom: 16px">
      <NText depth="3">{{ $t('dsc.asDelegationHint') }}</NText>
      <div class="pkd42-actions" style="margin-top: 8px">
        <NButton
          size="small"
          :type="delegation?.useNiaDsc ? 'success' : 'default'"
          @click="setDelegation(true)"
        >
          {{ $t('dsc.useNiaDsc') }}
        </NButton>
        <NButton size="small" @click="setDelegation(false)">{{ $t('common.cancel') }}</NButton>
      </div>
    </NCard>

    <NCard v-if="signedIn" :title="$t('dsc.statusTitle')" size="small">
      <NDataTable :columns="columns" :data="requests" size="small" />
    </NCard>
  </div>
</template>
