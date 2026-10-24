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
import type { DataTableColumns } from 'naive-ui'
import { FilePlus2, ListChecks, RotateCcw, ScrollText, Settings } from '@lucide/vue'
import { computed, h, onMounted, ref } from 'vue'
import { useRealm } from '~/composables/useRealm'
import DateTimeText from '~/components/common/DateTimeText.vue'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import ValidityCell from '~/components/common/ValidityCell.vue'
import StatusTag from '~/components/common/StatusTag.vue'
import AdminOnlyBadge from '~/components/common/AdminOnlyBadge.vue'
import { expiryDescription, useDscStatus } from '~/composables/useLifecycleStatus'

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

const { state, ensureLoaded, showAdmin } = useRealm('dsc')
const api = useApi()
const { t } = useI18n()
const { formatDate } = useDateTime()
const message = useMessage()
const dialog = useDialog()
const { status: lifecycle, refresh: refreshLifecycle } = useDscStatus()
const niaDscExpiryText = computed(() =>
  expiryDescription(
    lifecycle.value?.niaDsc ?? null,
    {
      missing: t('dsc.niaDscMissing'),
      certificate: (date) => t('dsc.niaDscExpired', { date }),
      privateKey: (date) => t('dsc.niaDscKeyExpired', { date }),
      parent: (date) => t('dsc.cscaExpired', { date }),
    },
    formatDate,
  ),
)
const rotateBusy = ref(false)
usePageTitle(() => t('nav.dsc'))
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

/** Confirms and performs the admin NIA DSC rotation. */
function confirmRotateNiaDsc(): void {
  dialog.warning({
    title: t('dsc.rotateNiaDsc'),
    content: t('dsc.rotateNiaDscWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void rotateNiaDsc(),
  })
}

async function rotateNiaDsc(): Promise<void> {
  rotateBusy.value = true
  try {
    await api('/dsc/nia-dsc/rotate', { method: 'POST', body: { confirm: true } })
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

      <ExpiryAlert
        v-if="lifecycle && !lifecycle.canIssueDocuments"
        :title="$t('dsc.signingPaused')"
        :description="niaDscExpiryText"
      />

      <NCard v-if="signedIn" :title="$t('dsc.applyTitle')" size="small">
        <NText depth="3">{{ $t('dsc.applyHint') }}</NText>
        <template #action>
          <NSpace>
            <NuxtLink v-if="lifecycle?.canIssueDocuments !== false" to="/dsc/apply">
              <NButton type="primary">
                <template #icon
                  ><NIcon><FilePlus2 /></NIcon
                ></template>
                {{ $t('dsc.applyTitle') }}
              </NButton>
            </NuxtLink>
            <NButton v-else type="primary" disabled>
              <template #icon
                ><NIcon><FilePlus2 /></NIcon
              ></template>
              {{ $t('dsc.applyTitle') }}
            </NButton>
            <NuxtLink v-if="isReviewer" to="/dsc/admin">
              <NButton>
                <template #icon
                  ><NIcon><ListChecks /></NIcon
                ></template>
                {{ $t('dsc.reviewQueue') }}
              </NButton>
            </NuxtLink>
            <NuxtLink v-if="showAdmin" to="/dsc/settings">
              <NButton>
                <template #icon
                  ><NIcon><Settings /></NIcon
                ></template>
                {{ $t('dsc.settingsTitle') }}<AdminActionIcon />
              </NButton>
            </NuxtLink>
            <NuxtLink v-if="showAdmin" to="/dsc/audit">
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
        <div v-if="requests.length" role="region" :aria-label="$t('dsc.myRequests')">
          <NDataTable
            :columns="columns"
            :data="requests"
            :loading="loading"
            :pagination="{ pageSize: 10 }"
            :row-props="rowProps"
            size="small"
          />
        </div>
        <NEmpty v-else :description="$t('dsc.emptyRequests')" />
      </NCard>
      <NCard v-else size="small">
        <NText depth="3">{{ $t('auth.signInTo', { realm: 'DSC' }) }}</NText>
      </NCard>
      <NCard v-if="showAdmin" size="small" :title="$t('dsc.niaDscTitle')">
        <template #header-extra><AdminOnlyBadge /></template>
        <NDescriptions v-if="lifecycle?.niaDsc" :column="3" size="small">
          <NDescriptionsItem :label="$t('dsc.niaDscSerial')">
            <span class="epass42-mono">{{ lifecycle.niaDsc.serial }}</span>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.certificateValidity')">
            <ValidityCell
              :not-before="lifecycle.niaDsc.notBefore"
              :not-after="lifecycle.niaDsc.notAfter"
              :private-key-not-after="lifecycle.niaDsc.privateKeyNotAfter"
            />
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('pkd.status')">
            <StatusTag :status="lifecycle.niaDsc.status ?? 'active'" />
          </NDescriptionsItem>
        </NDescriptions>
        <NText v-else depth="3">{{ $t('dsc.niaDscMissing') }}</NText>
        <NAlert
          v-if="lifecycle && !lifecycle.canRotateNiaDsc"
          type="warning"
          style="margin-top: 12px"
        >
          {{ $t('dsc.cscaExpiredHint') }}
        </NAlert>
        <template #action>
          <NButton
            type="warning"
            :loading="rotateBusy"
            :disabled="!lifecycle?.canRotateNiaDsc"
            @click="confirmRotateNiaDsc"
          >
            <template #icon
              ><NIcon><RotateCcw /></NIcon
            ></template>
            {{ $t('dsc.rotateNiaDsc') }}<AdminActionIcon />
          </NButton>
        </template>
      </NCard>
    </NSpace>
  </div>
</template>
