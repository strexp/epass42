<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NSpace,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import {
  Check,
  FileCheck,
  FilePlus2,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ScrollText,
  X,
} from '@lucide/vue'
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
usePageTitle(() => t('nav.csca'))
const message = useMessage()
const dialog = useDialog()

const applications = ref<Application[]>([])
const loading = ref(false)
const rolloverBusy = ref(false)
const masterListBusy = ref(false)
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
        { default: () => t('csca.viewApplication') },
      ),
  },
])

/** Confirms the irreversible authority-key rollover before running it. */
function confirmRollover(): void {
  dialog.warning({
    title: t('csca.rollover'),
    content: t('csca.rolloverWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void rollover(),
  })
}

async function rollover(): Promise<void> {
  rolloverBusy.value = true
  try {
    await api('/csca/keys/rollover', { method: 'POST', body: { confirm: true } })
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    rolloverBusy.value = false
  }
}

/** Confirms regenerating and publishing the CSCA master list. */
function confirmMasterList(): void {
  dialog.warning({
    title: t('csca.masterList'),
    content: t('csca.masterListWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void generateMasterList(),
  })
}

async function generateMasterList(): Promise<void> {
  masterListBusy.value = true
  try {
    await api('/pkd/masterlists', { method: 'POST' })
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    masterListBusy.value = false
  }
}

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
      <PageHeader :title="$t('nav.csca')" :subtitle="$t('home.cscaCard')" />

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

      <NCard v-else size="small">
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
        <div v-if="applications.length" role="region" :aria-label="$t('csca.myApplications')">
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

      <NCard v-if="isAdmin" :title="$t('nav.admin')" size="small">
        <NAlert type="warning" :show-icon="false">{{ $t('csca.adminActionsHint') }}</NAlert>
        <NSpace style="margin-top: 12px">
          <NButton :loading="rolloverBusy" @click="confirmRollover">
            <template #icon
              ><NIcon><RotateCcw /></NIcon
            ></template>
            {{ $t('csca.rollover') }}
          </NButton>
          <NButton :loading="masterListBusy" @click="confirmMasterList">
            <template #icon
              ><NIcon><FileCheck /></NIcon
            ></template>
            {{ $t('csca.masterList') }}
          </NButton>
        </NSpace>
      </NCard>
    </NSpace>
  </div>
</template>
