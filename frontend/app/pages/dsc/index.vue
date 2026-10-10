<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NIcon,
  NSpace,
  NText,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { FilePlus2, ListChecks, ScrollText, Settings } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useRealm } from '~/composables/useRealm'
import DateTimeText from '~/components/common/DateTimeText.vue'
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
const loading = ref(false)

const signedIn = computed(() => state.value.me !== null)
const isReviewer = computed(() => (state.value.me?.reviewScope ?? 'none') !== 'none')

interface ActivePassport {
  reference: string
  status: string
  documentNumber: string
  createdAt: string
  expiresAt: string | null
}
const activePassport = ref<ActivePassport | null>(null)

async function loadActivePassport(): Promise<void> {
  if (!signedIn.value) return
  try {
    activePassport.value = (
      await api<{ passport: ActivePassport | null }>('/dsc/passports/active')
    ).passport
  } catch {
    activePassport.value = null
  }
}

function openDetails(row: RequestRow): void {
  void navigateTo(`/dsc/requests/${row.reference}`)
}

/** Makes the whole row open the request (the button stays for keyboard users). */
function rowProps(row: RequestRow) {
  return {
    style: 'cursor: pointer;',
    onClick: () => openDetails(row),
  }
}

const columns = computed<DataTableColumns<RequestRow>>(() => {
  const base: DataTableColumns<RequestRow> = [
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
    {
      title: t('dsc.submittedAt'),
      key: 'createdAt',
      render: (row: RequestRow) => h(DateTimeText, { value: row.createdAt }),
    },
  ]
  if (isReviewer.value) {
    base.push({ title: t('common.mnt'), key: 'mnt' }, { title: t('common.ip'), key: 'ip' })
  }
  base.push({
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
  })
  return base
})

onMounted(async () => {
  await ensureLoaded()
  if (!signedIn.value) return
  await loadActivePassport()
  loading.value = true
  try {
    requests.value = (await api<{ items: RequestRow[] }>('/dsc/requests?mine=1')).items ?? []
  } catch {
    requests.value = []
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('nav.dsc')" :subtitle="$t('home.dscCard')" />

      <NSpace v-if="signedIn">
        <NuxtLink to="/dsc/apply">
          <NButton type="primary">
            <template #icon
              ><NIcon><FilePlus2 /></NIcon
            ></template>
            {{ $t('dsc.applyTitle') }}
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
        <NuxtLink v-if="state.me?.isAdmin" to="/dsc/audit">
          <NButton>
            <template #icon
              ><NIcon><ScrollText /></NIcon
            ></template>
            {{ $t('audit.title') }}
          </NButton>
        </NuxtLink>
      </NSpace>

      <NCard v-if="signedIn && activePassport" size="small" :title="$t('dsc.activePassportTitle')">
        <NText depth="3">{{ $t('dsc.activePassportHint') }}</NText>
        <NDescriptions :column="2" size="small" style="margin-top: 8px">
          <NDescriptionsItem :label="$t('dsc.passportDocumentNumber')">
            {{ activePassport.documentNumber }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dsc.requestReference')">
            <span class="epass42-mono">{{ activePassport.reference }}</span>
          </NDescriptionsItem>
        </NDescriptions>
        <template #action>
          <NuxtLink :to="`/dsc/requests/${activePassport.reference}`">
            <NButton size="small">{{ $t('dsc.viewDetails') }}</NButton>
          </NuxtLink>
        </template>
      </NCard>

      <NCard v-if="signedIn" :title="$t('dsc.myRequests')" size="small">
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
      <NCard v-else size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'DSC' }) }}</NText>
      </NCard>
    </NSpace>
  </div>
</template>
