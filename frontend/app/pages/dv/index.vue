<script setup lang="ts">
import {
  NAlert,
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
import { FilePlus2, RefreshCw, ScrollText } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import StatusTag from '~/components/common/StatusTag.vue'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import { useDvStatus } from '~/composables/useLifecycleStatus'

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
const { formatDate } = useDateTime()
const { status: lifecycle, refresh: refreshLifecycle } = useDvStatus()
const dialog = useDialog()
const rotateBusy = ref(false)
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

/** Confirms and performs the admin NIA DV rotation. */
function confirmRotateNiaDv(): void {
  dialog.warning({
    title: t('dv.rotateNiaDv'),
    content: t('dv.rotateNiaDvWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void rotateNiaDv(),
  })
}

async function rotateNiaDv(): Promise<void> {
  rotateBusy.value = true
  try {
    await api('/dv/nia-dv/rotate', { method: 'POST', body: { confirm: true } })
    message.success(t('common.success'))
    await refreshLifecycle()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    rotateBusy.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  await refreshLifecycle()
  if (signedIn.value) await loadApplications()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('nav.dv')" :subtitle="$t('home.dvCard')" />

      <ExpiryAlert
        v-if="lifecycle && !lifecycle.canIssueTerminals"
        :title="$t('dv.signingPaused')"
        :description="
          lifecycle.niaDv
            ? $t('dv.niaDvExpired', { date: formatDate(lifecycle.niaDv.notAfter) })
            : $t('dv.niaDvMissing')
        "
      />

      <NCard v-if="signedIn" :title="$t('dv.applyTitle')" size="small">
        <NText depth="3">{{ $t('dv.applyHint') }}</NText>
        <template #action>
          <NuxtLink v-if="lifecycle?.canIssueTerminals !== false" to="/dv/apply">
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
        </template>
      </NCard>

      <NCard v-else size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'DV' }) }}</NText>
      </NCard>

      <NCard v-if="signedIn && isAdmin" size="small" :title="$t('dv.niaDvTitle')">
        <NDescriptions v-if="lifecycle?.niaDv" :column="3" size="small">
          <NDescriptionsItem :label="$t('dv.niaDvReference')">
            <span class="epass42-mono">{{ lifecycle.niaDv.holderReference }}</span>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('pkd.validity')">
            {{ formatDate(lifecycle.niaDv.notAfter) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('pkd.status')">
            <StatusTag :status="lifecycle.niaDv.status ?? 'active'" />
          </NDescriptionsItem>
        </NDescriptions>
        <NText v-else depth="3">{{ $t('dv.niaDvMissing') }}</NText>
        <NAlert
          v-if="lifecycle && !lifecycle.canRotateNiaDv"
          type="warning"
          style="margin-top: 12px"
        >
          {{ $t('dv.cvcaExpiredHint') }}
        </NAlert>
        <template #action>
          <NButton
            type="warning"
            :loading="rotateBusy"
            :disabled="!lifecycle?.canRotateNiaDv"
            @click="confirmRotateNiaDv"
          >
            {{ $t('dv.rotateNiaDv') }}
          </NButton>
        </template>
      </NCard>

      <NCard
        v-if="signedIn"
        :title="isAdmin ? $t('dv.adminTitle') : $t('dv.myApplications')"
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
            <NuxtLink v-if="isAdmin" to="/dv/audit">
              <NButton size="small">
                <template #icon
                  ><NIcon><ScrollText /></NIcon
                ></template>
                {{ $t('audit.title') }}
              </NButton>
            </NuxtLink>
          </NSpace>
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
        <NEmpty v-else :description="$t('dv.empty')" />
      </NCard>
    </NSpace>
  </div>
</template>
