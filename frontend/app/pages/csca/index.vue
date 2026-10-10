<script setup lang="ts">
import { NButton, NCard, NDataTable, NEmpty, NIcon, NSpace, NText, useMessage } from 'naive-ui'
import { Check, FilePlus2, KeyRound, RefreshCw, ScrollText, X } from '@lucide/vue'
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

const { state, ensureLoaded } = useRealm('csca')
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const applications = ref<Application[]>([])
const loading = ref(false)
const delegation = ref<{
  mnt: string | null
  useNiaDsc: boolean
  hasActiveDsc: boolean
} | null>(null)

const me = computed(() => state.value.me)
const isAdmin = computed(() => me.value?.isAdmin ?? false)
const signedIn = computed(() => me.value !== null)
const hasMnt = computed(() => (me.value?.account.activeMnt ?? null) !== null)

async function loadApplications(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Application[] }>('/csca/applications')
    applications.value = result.items ?? []
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    applications.value = []
  } finally {
    loading.value = false
  }
}

async function loadDelegation(): Promise<void> {
  if (!hasMnt.value) return
  try {
    delegation.value = await api('/csca/settings/mnt')
  } catch {
    delegation.value = null
  }
}

async function setDelegation(value: boolean): Promise<void> {
  try {
    const updated = await api<{
      mnt: string | null
      useNiaDsc: boolean
      hasActiveDsc: boolean
    }>('/csca/settings/mnt', { method: 'PUT', body: { useNiaDsc: value } })
    delegation.value = {
      mnt: updated.mnt,
      useNiaDsc: updated.useNiaDsc,
      hasActiveDsc: updated.hasActiveDsc,
    }
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

function openDetails(row: Application): void {
  void navigateTo(`/csca/applications/${row.id}`)
}

const columns = [
  { title: '#', key: 'id' },
  { title: 'CN', key: 'subjectCn' },
  { title: 'MNT', key: 'mnt' },
  { title: 'IP', key: 'ip' },
  { title: 'Mode', key: 'keyMode' },
  {
    title: 'Status',
    key: 'status',
    render: (row: Application) => h(StatusTag, { status: row.status }),
  },
  {
    title: '',
    key: 'actions',
    render: (row: Application) =>
      h(
        NButton,
        { size: 'tiny', onClick: () => openDetails(row) },
        { default: () => t('csca.viewApplication') },
      ),
  },
]

onMounted(async () => {
  await ensureLoaded()
  await loadDelegation()
  // Admins see every application; other users see their own.
  if (signedIn.value) await loadApplications()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <NCard v-if="signedIn" :title="$t('csca.applyTitle')" size="small">
        <NText depth="3">{{ $t('csca.publicHint') }}</NText>
        <template #action>
          <NuxtLink to="/csca/apply">
            <NButton type="primary">
              <template #icon
                ><NIcon><FilePlus2 /></NIcon
              ></template>
              {{ $t('nav.apply') }}
            </NButton>
          </NuxtLink>
        </template>
      </NCard>

      <NCard v-else :title="$t('csca.applyTitle')" size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'CSCA' }) }}</NText>
      </NCard>

      <NCard v-if="hasMnt" :title="$t('csca.asDelegationTitle')" size="small">
        <NText depth="3">{{ $t('csca.asDelegationHint') }}</NText>
        <NText v-if="delegation && !delegation.hasActiveDsc" depth="3" style="display: block">
          {{ $t('csca.ownDscUnavailable') }}
        </NText>
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
              {{ $t('csca.useNiaDsc') }}
            </NButton>
            <NButton
              size="small"
              :type="delegation && !delegation.useNiaDsc ? 'primary' : 'default'"
              :disabled="!delegation?.hasActiveDsc"
              @click="setDelegation(false)"
            >
              <template #icon
                ><NIcon><X /></NIcon
              ></template>
              {{ $t('csca.useOwnDsc') }}
            </NButton>
          </NSpace>
        </template>
      </NCard>

      <NCard
        v-if="signedIn"
        :title="isAdmin ? $t('csca.adminTitle') : $t('csca.myApplications')"
        size="small"
      >
        <template #action>
          <NSpace>
            <NButton size="small" @click="loadApplications">
              <template #icon
                ><NIcon><RefreshCw /></NIcon
              ></template>
              {{ $t('common.reload') }}
            </NButton>
            <NuxtLink to="/csca/certificates">
              <NButton size="small">
                <template #icon
                  ><NIcon><KeyRound /></NIcon
                ></template>
                {{ $t('csca.certificatesTitle') }}
              </NButton>
            </NuxtLink>
            <NuxtLink v-if="isAdmin" to="/csca/audit">
              <NButton size="small">
                <template #icon
                  ><NIcon><ScrollText /></NIcon
                ></template>
                {{ $t('audit.title') }}
              </NButton>
            </NuxtLink>
          </NSpace>
        </template>
        <NDataTable
          v-if="applications.length"
          :columns="columns"
          :data="applications"
          :loading="loading"
          size="small"
        />
        <NEmpty v-else :description="$t('common.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
