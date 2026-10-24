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
  useDialog,
  useMessage,
} from 'naive-ui'
import { Check, FilePlus2, KeyRound, RefreshCw, RotateCcw, ScrollText, X } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'
import AdminOnlyBadge from '~/components/common/AdminOnlyBadge.vue'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import ValidityCell from '~/components/common/ValidityCell.vue'
import { expiryDescription, useCvcaStatus } from '~/composables/useLifecycleStatus'

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

const { state, ensureLoaded, showAdmin } = useRealm('cvca')
const api = useApi()
const { t } = useI18n()
const { formatDate } = useDateTime()
usePageTitle(() => t('nav.cvca'))
const message = useMessage()
const dialog = useDialog()

const applications = ref<Application[]>([])
const loading = ref(false)
const rolloverBusy = ref(false)
const { status: lifecycle, refresh: refreshLifecycle } = useCvcaStatus()
const cvcaExpiryText = computed(() =>
  expiryDescription(
    lifecycle.value?.cvca ?? null,
    {
      missing: t('cvca.expiredTitle'),
      certificate: (date) => t('cvca.expiredWarning', { date }),
      privateKey: (date) => t('cvca.expiredWarning', { date }),
    },
    formatDate,
  ),
)
const delegation = ref<{
  mnt: string | null
  useNiaDv: boolean
  hasActiveDv: boolean
} | null>(null)

const me = computed(() => state.value.me)
const isAdmin = computed(() => me.value?.isAdmin ?? false)
const signedIn = computed(() => me.value !== null)
const hasMnt = computed(() => (me.value?.account.activeMnt ?? null) !== null)

async function loadApplications(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Application[] }>('/cvca/applications')
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
    delegation.value = await api('/cvca/settings/mnt')
  } catch {
    delegation.value = null
  }
}

async function setDelegation(value: boolean): Promise<void> {
  try {
    const updated = await api<{
      mnt: string | null
      useNiaDv: boolean
      hasActiveDv: boolean
    }>('/cvca/settings/mnt', { method: 'PUT', body: { useNiaDv: value } })
    delegation.value = {
      mnt: updated.mnt,
      useNiaDv: updated.useNiaDv,
      hasActiveDv: updated.hasActiveDv,
    }
    message.success(t('common.saved'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

function openDetails(row: Application): void {
  void navigateTo(`/cvca/applications/${row.id}`)
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
        { default: () => t('cvca.viewApplication') },
      ),
  },
])

/** Confirms the irreversible authority-key rollover before running it. */
function confirmRollover(): void {
  dialog.warning({
    title: t('cvca.rollover'),
    content: t('cvca.rolloverWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void rollover(),
  })
}

async function rollover(): Promise<void> {
  rolloverBusy.value = true
  try {
    await api('/cvca/keys/rollover', { method: 'POST', body: { confirm: true } })
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    rolloverBusy.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  await refreshLifecycle()
  if (signedIn.value) await loadApplications()
  if (hasMnt.value) await loadDelegation()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('nav.cvca')" :subtitle="$t('home.cvcaCard')" />

      <ExpiryAlert
        v-if="lifecycle?.cvca?.expired"
        :title="$t('cvca.expiredTitle')"
        :description="cvcaExpiryText"
      />

      <NCard v-if="signedIn" :title="$t('cvca.applyTitle')" size="small">
        <NText depth="3">{{ $t('cvca.publicHint') }}</NText>
        <template #action>
          <NSpace>
            <NuxtLink v-if="lifecycle?.canIssueDvs !== false" to="/cvca/apply">
              <NButton type="primary">
                <template #icon
                  ><NIcon><FilePlus2 /></NIcon
                ></template>
                {{ $t('nav.apply') }}
              </NButton>
            </NuxtLink>
            <NButton v-else type="primary" disabled>
              <template #icon
                ><NIcon><FilePlus2 /></NIcon
              ></template>
              {{ $t('nav.apply') }}
            </NButton>
            <NuxtLink v-if="showAdmin" to="/cvca/audit">
              <NButton>
                <template #icon
                  ><NIcon><ScrollText /></NIcon
                ></template>
                {{ $t('audit.title') }}<AdminActionIcon />
              </NButton>
            </NuxtLink>
          </NSpace>
        </template>
      </NCard>

      <NCard v-else size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'CVCA' }) }}</NText>
      </NCard>

      <NCard v-if="hasMnt" :title="$t('cvca.asDelegationTitle')" size="small">
        <NText depth="3">{{ $t('cvca.asDelegationHint') }}</NText>
        <NText v-if="delegation && !delegation.hasActiveDv" depth="3" style="display: block">
          {{ $t('cvca.ownDvUnavailable') }}
        </NText>
        <template #action>
          <NSpace>
            <NButton
              size="small"
              :type="delegation?.useNiaDv ? 'primary' : 'default'"
              @click="setDelegation(true)"
            >
              <template #icon
                ><NIcon><Check /></NIcon
              ></template>
              {{ $t('cvca.useNiaDv') }}
            </NButton>
            <NButton
              size="small"
              :type="delegation && !delegation.useNiaDv ? 'primary' : 'default'"
              :disabled="!delegation?.hasActiveDv"
              @click="setDelegation(false)"
            >
              <template #icon
                ><NIcon><X /></NIcon
              ></template>
              {{ $t('cvca.useOwnDv') }}
            </NButton>
          </NSpace>
        </template>
      </NCard>

      <NCard
        v-if="signedIn"
        :title="isAdmin ? $t('cvca.adminTitle') : $t('cvca.myApplications')"
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
            <NuxtLink to="/cvca/certificates">
              <NButton size="small">
                <template #icon
                  ><NIcon><KeyRound /></NIcon
                ></template>
                {{ $t('cvca.certificatesTitle') }}
              </NButton>
            </NuxtLink>
          </NSpace>
        </template>
        <div v-if="applications.length" role="region" :aria-label="$t('cvca.myApplications')">
          <NDataTable
            :columns="columns"
            :data="applications"
            :loading="loading"
            :pagination="{ pageSize: 10 }"
            :row-props="rowProps"
            size="small"
          />
        </div>
        <NEmpty v-else :description="$t('cvca.empty')" />
      </NCard>

      <NCard v-if="showAdmin && lifecycle?.cvca" size="small" :title="$t('cvca.caTitle')">
        <template #header-extra><AdminOnlyBadge /></template>
        <NDescriptions :column="3" size="small">
          <NDescriptionsItem :label="$t('common.certificateValidity')">
            <ValidityCell
              :not-before="lifecycle.cvca.notBefore"
              :not-after="lifecycle.cvca.notAfter"
            />
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('cvca.defaultDvTitle')">
            <ValidityCell
              v-if="lifecycle.defaultDv"
              :not-before="lifecycle.defaultDv.notBefore"
              :not-after="lifecycle.defaultDv.notAfter"
            />
            <span v-else>—</span>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.status')">
            <StatusTag :status="lifecycle.cvca.status ?? 'active'" />
          </NDescriptionsItem>
        </NDescriptions>
        <template #action>
          <NButton
            type="warning"
            :loading="rolloverBusy"
            :disabled="lifecycle?.canRotateCvca === false"
            @click="confirmRollover"
          >
            <template #icon
              ><NIcon><RotateCcw /></NIcon
            ></template>
            {{ $t('cvca.rollover') }}<AdminActionIcon />
          </NButton>
        </template>
      </NCard>
    </NSpace>
  </div>
</template>
