<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NText } from 'naive-ui'
import { FilePlus2, ListChecks, Search, Settings } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface RequestRow {
  id: number
  status: string
  deliveryMode: string
  dataGroups: number[]
  createdAt: string
}

const { state, ensureLoaded } = useRealm('dsc')
const api = useApi()
const { t } = useI18n()
const requests = ref<RequestRow[]>([])

const signedIn = computed(() => state.value.me !== null)
const isAdmin = computed(() => state.value.me?.isAdmin ?? false)

const columns = [
  { title: '#', key: 'id' },
  {
    title: 'Status',
    key: 'status',
    render: (row: RequestRow) => h(StatusTag, { status: row.status }),
  },
  { title: 'Delivery', key: 'deliveryMode' },
  { title: 'DGs', key: 'dataGroups', render: (row: RequestRow) => row.dataGroups.join(', ') },
  {
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h('a', { href: `/dsc/status?id=${row.id}` }, () => t('dsc.statusTitle')),
  },
]

onMounted(async () => {
  await ensureLoaded()
  if (!signedIn.value) return
  try {
    requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests')).items ?? []
  } catch {
    requests.value = []
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
        <NuxtLink v-if="isAdmin" to="/dsc/settings">
          <NButton>
            <template #icon
              ><NIcon><Settings /></NIcon
            ></template>
            {{ $t('dsc.settingsTitle') }}
          </NButton>
        </NuxtLink>
      </NSpace>

      <NCard v-if="signedIn" :title="$t('dsc.statusTitle')" size="small">
        <NDataTable v-if="requests.length" :columns="columns" :data="requests" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
