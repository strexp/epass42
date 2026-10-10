<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NText } from 'naive-ui'
import { FilePlus2, ListChecks, Search, Settings } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface RequestRow {
  reference: string
  status: string
  deliveryMode: string
  mnt: string | null
  ip: string | null
  dataGroups: number[]
  createdAt: string
}

const { state, ensureLoaded } = useRealm('dsc')
const api = useApi()
const { t } = useI18n()
const requests = ref<RequestRow[]>([])

const signedIn = computed(() => state.value.me !== null)
const isReviewer = computed(() => (state.value.me?.reviewScope ?? 'none') !== 'none')

function openDetails(row: RequestRow): void {
  void navigateTo(`/dsc/requests/${row.reference}`)
}

const columns = computed(() => {
  const base = [
    {
      title: t('dsc.statusTitle'),
      key: 'status',
      render: (row: RequestRow) => h(StatusTag, { status: row.status }),
    },
    {
      title: t('dsc.requestReference'),
      key: 'reference',
      render: (row: RequestRow) => h('span', { class: 'epass42-mono' }, row.reference),
    },
    { title: t('dsc.submittedAt'), key: 'createdAt' },
  ]
  if (isReviewer.value) {
    base.push({ title: 'MNT', key: 'mnt' }, { title: 'IP', key: 'ip' })
  }
  base.push({
    title: '',
    key: 'actions',
    render: (row: RequestRow) =>
      h(
        NButton,
        { size: 'tiny', onClick: () => openDetails(row) },
        { default: () => t('dsc.viewDetails') },
      ),
  })
  return base
})

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
  <div class="epass42-page">
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
        <NuxtLink v-if="isReviewer" to="/dsc/admin">
          <NButton>
            <template #icon
              ><NIcon><ListChecks /></NIcon
            ></template>
            {{ $t('dsc.reviewQueue') }}
          </NButton>
        </NuxtLink>
        <NuxtLink v-if="state.me?.isAdmin" to="/dsc/settings">
          <NButton>
            <template #icon
              ><NIcon><Settings /></NIcon
            ></template>
            {{ $t('dsc.settingsTitle') }}
          </NButton>
        </NuxtLink>
      </NSpace>

      <NCard v-if="signedIn" :title="$t('dsc.myRequests')" size="small">
        <NDataTable v-if="requests.length" :columns="columns" :data="requests" size="small" />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
      <NCard v-else size="small">
        <NText depth="3">{{ $t('dsc.statusIntro') }}</NText>
      </NCard>
    </NSpace>
  </div>
</template>
