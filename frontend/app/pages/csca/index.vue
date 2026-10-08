<script setup lang="ts">
import {
  NButton,
  NCard,
  NDataTable,
  NEmpty,
  NIcon,
  NInput,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { Check, FilePlus2, KeyRound, RefreshCw, X } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'

definePageMeta({ layout: 'realm' })

interface Application {
  id: number
  subjectCn: string | null
  status: string
  asn: number | null
  keyMode: string
  createdAt: string
}

const { state, ensureLoaded } = useRealm('csca')
const api = useApi()
const { t } = useI18n()
const message = useMessage()

const applications = ref<Application[]>([])
const loading = ref(false)
const rejectId = ref<number | null>(null)
const rejectReason = ref('')
const delegation = ref<{
  asn: number | null
  activeMnt: string | null
  useNiaDsc: boolean
  hasActiveDsc: boolean
} | null>(null)

const me = computed(() => state.value.me)
const isAdmin = computed(() => me.value?.isAdmin ?? false)
const signedIn = computed(() => me.value !== null)
const hasAsn = computed(() => (me.value?.account.asn ?? null) !== null)

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
  if (!hasAsn.value) return
  try {
    delegation.value = await api('/csca/settings/as')
  } catch {
    delegation.value = null
  }
}

async function setDelegation(value: boolean): Promise<void> {
  try {
    const updated = await api<{
      asn: number | null
      activeMnt: string | null
      useNiaDsc: boolean
      hasActiveDsc: boolean
    }>('/csca/settings/as', { method: 'PUT', body: { useNiaDsc: value } })
    delegation.value = {
      asn: updated.asn,
      activeMnt: updated.activeMnt,
      useNiaDsc: updated.useNiaDsc,
      hasActiveDsc: updated.hasActiveDsc,
    }
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function approve(id: number): Promise<void> {
  try {
    await api(`/csca/applications/${id}/approve`, { method: 'POST' })
    message.success(t('common.success'))
    await loadApplications()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

async function reject(): Promise<void> {
  if (rejectId.value === null) return
  try {
    await api(`/csca/applications/${rejectId.value}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value },
    })
    rejectId.value = null
    rejectReason.value = ''
    await loadApplications()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
}

const columns = [
  { title: '#', key: 'id' },
  { title: 'CN', key: 'subjectCn' },
  { title: 'AS', key: 'asn' },
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
      row.status === 'submitted' && isAdmin.value
        ? h('div', { class: 'pkd42-actions' }, [
            h(NButton, { size: 'tiny', type: 'primary', onClick: () => approve(row.id) }, () =>
              t('common.approve'),
            ),
            h(NButton, { size: 'tiny', onClick: () => (rejectId.value = row.id) }, () =>
              t('common.reject'),
            ),
          ])
        : null,
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
  <div class="pkd42-page">
    <NSpace vertical size="large">
      <NCard v-if="signedIn" :title="$t('csca.applyTitle')" size="small">
        <NText depth="3">{{ $t('home.cscaCard') }}</NText>
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

      <NCard v-if="hasAsn" :title="$t('csca.asDelegationTitle')" size="small">
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
        <NCard
          v-if="rejectId !== null"
          style="margin-top: 12px"
          size="small"
          :title="$t('csca.rejectReason')"
        >
          <NInput v-model:value="rejectReason" type="textarea" />
          <template #action>
            <NSpace>
              <NButton size="small" type="primary" @click="reject">{{
                $t('common.confirm')
              }}</NButton>
              <NButton size="small" quaternary @click="rejectId = null">{{
                $t('common.cancel')
              }}</NButton>
            </NSpace>
          </template>
        </NCard>
      </NCard>
    </NSpace>
  </div>
</template>
