<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NText, useMessage } from 'naive-ui'
import { FilePlus2, RefreshCw } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface Application {
  id: number
  subjectCn: string | null
  status: string
  mnt: string | null
  ip: string | null
  keyMode: string
  createdAt: string
}

const { state, ensureLoaded } = useRealm('dv')
const api = useApi()
const { t } = useI18n()
usePageTitle(() => t('nav.dv'))
const message = useMessage()

const applications = ref<Application[]>([])
const loading = ref(false)

const me = computed(() => state.value.me)
const isAdmin = computed(() => me.value?.isAdmin ?? false)
const signedIn = computed(() => me.value !== null)

async function loadApplications(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Application[] }>('/dv/terminal-applications')
    applications.value = result.items ?? []
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    applications.value = []
  } finally {
    loading.value = false
  }
}

function openDetails(row: Application): void {
  void navigateTo(`/dv/applications/${row.id}`)
}

/** Makes the whole row open the application (the button stays for keyboard users). */
function rowProps(row: Application) {
  return {
    style: 'cursor: pointer;',
    onClick: () => openDetails(row),
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  { title: t('common.cn'), key: 'subjectCn' },
  { title: t('common.mnt'), key: 'mnt' },
  { title: t('common.ip'), key: 'ip' },
  { title: t('common.mode'), key: 'keyMode' },
  {
    title: t('common.status'),
    key: 'status',
    render: (row: Application) => h(StatusTag, { status: row.status }),
  },
  {
    title: '',
    key: 'actions',
    render: (row: Application) =>
      h(
        NButton,
        {
          size: 'tiny',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            openDetails(row)
          },
        },
        { default: () => t('dv.viewApplication') },
      ),
  },
])

onMounted(async () => {
  await ensureLoaded()
  if (signedIn.value) await loadApplications()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('nav.dv')" :subtitle="$t('home.dvCard')" />

      <NCard v-if="signedIn" :title="$t('dv.applyTitle')" size="small">
        <NText depth="3">{{ $t('dv.applyHint') }}</NText>
        <template #action>
          <NuxtLink to="/dv/apply">
            <NButton type="primary">
              <template #icon
                ><NIcon><FilePlus2 /></NIcon
              ></template>
              {{ $t('nav.apply') }}
            </NButton>
          </NuxtLink>
        </template>
      </NCard>

      <NCard v-else size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: $t('nav.dv') }) }}</NText>
      </NCard>

      <NCard
        v-if="signedIn"
        :title="isAdmin ? $t('dv.adminTitle') : $t('dv.myApplications')"
        size="small"
      >
        <template #action>
          <NButton size="small" @click="loadApplications">
            <template #icon
              ><NIcon><RefreshCw /></NIcon
            ></template>
            {{ $t('common.reload') }}
          </NButton>
        </template>
        <div v-if="applications.length" role="region" :aria-label="$t('dv.myApplications')">
          <NDataTable
            :columns="columns"
            :data="applications"
            :loading="loading"
            :pagination="{ pageSize: 10 }"
            :row-props="rowProps"
            size="small"
          />
        </div>
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
