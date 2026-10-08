<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NTag, NText } from 'naive-ui'
import { Check, FilePlus2, ListChecks, Search, X } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'

definePageMeta({ layout: 'dsc' })

interface RequestRow {
  id: number
  status: string
  deliveryMode: string
  dataGroups: number[]
  createdAt: string
}

const auth = useAuthStore()
const api = useApi()
const requests = ref<RequestRow[]>([])
const delegation = ref<{ asn: number | null; useNiaDsc: boolean } | null>(null)

const signedIn = computed(() => auth.realms.dsc.me !== null)

const columns = [
  { title: '#', key: 'id' },
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
  { title: 'Delivery', key: 'deliveryMode' },
  { title: 'DGs', key: 'dataGroups', render: (row: RequestRow) => row.dataGroups.join(', ') },
]

async function setDelegation(value: boolean): Promise<void> {
  delegation.value = await api('/dsc/settings/as', { method: 'PUT', body: { useNiaDsc: value } })
}

onMounted(async () => {
  if (!auth.realms.dsc.loaded) await auth.fetchMe('dsc')
  if (!signedIn.value) return
  try {
    requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests')).items ?? []
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
    <NSpace vertical size="large">
      <div>
        <h1 style="margin: 0">{{ $t('nav.dsc') }}</h1>
        <NText depth="2">{{ $t('home.dscCard') }}</NText>
      </div>

      <NSpace>
        <NuxtLink to="/dsc/apply">
          <NButton type="primary">
            <template #icon
              ><NIcon><FilePlus2 /></NIcon
            ></template>
            {{ $t('dsc.applyTitle') }}
          </NButton>
        </NuxtLink>
        <NuxtLink to="/dsc/status">
          <NButton>
            <template #icon
              ><NIcon><Search /></NIcon
            ></template>
            {{ $t('dsc.statusTitle') }}
          </NButton>
        </NuxtLink>
        <NuxtLink to="/dsc/admin">
          <NButton>
            <template #icon
              ><NIcon><ListChecks /></NIcon
            ></template>
            {{ $t('dsc.reviewQueue') }}
          </NButton>
        </NuxtLink>
      </NSpace>

      <NCard v-if="signedIn" :title="$t('dsc.asDelegation')" size="small">
        <NText depth="3">{{ $t('dsc.asDelegationHint') }}</NText>
        <template #action>
          <NSpace>
            <NButton
              size="small"
              :type="delegation?.useNiaDsc ? 'primary' : 'default'"
              @click="setDelegation(true)"
            >
              <template #icon
                ><NIcon><Check /></NIcon
              ></template>
              {{ $t('dsc.useNiaDsc') }}
            </NButton>
            <NButton
              size="small"
              :type="delegation && !delegation.useNiaDsc ? 'primary' : 'default'"
              @click="setDelegation(false)"
            >
              <template #icon
                ><NIcon><X /></NIcon
              ></template>
              {{ $t('common.cancel') }}
            </NButton>
          </NSpace>
        </template>
      </NCard>

      <NCard v-if="signedIn" :title="$t('dsc.statusTitle')" size="small">
        <NDataTable v-if="requests.length" :columns="columns" :data="requests" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
