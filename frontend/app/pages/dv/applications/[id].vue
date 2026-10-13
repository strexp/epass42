<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NModal,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import type { DvPermissions } from '@epass42/shared'
import { computed, onMounted, ref } from 'vue'
import StatusTag from '~/components/common/StatusTag.vue'
import PermissionsEditor from '~/components/cvca/PermissionsEditor.vue'
import PermissionsSummary from '~/components/cvca/PermissionsSummary.vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadUrl } from '~/utils/download'

interface Application {
  id: number
  mnt: string | null
  applicantAccountId: number | null
  ip: string | null
  keyMode: string
  subjectCn: string | null
  holderMnemonic: string | null
  csrPem: string | null
  publicKeyPem: string | null
  permissionsJson: string | null
  overridePermissionsJson: string | null
  terminalCertId: number | null
  validityDays: number | null
  applicationUrl: string | null
  notes: string | null
  status: string
  reviewedAt: string | null
  rejectReason: string | null
  createdAt: string
}

const EMPTY: DvPermissions = {
  epassport: { dg3: false, dg4: false },
  travel: { read: false, write: false },
  visa: { read: false, write: false },
  biometrics: { read: false, write: false },
}

const route = useRoute()
const api = useApi()
const apiBase = useApiBase()
const { t } = useI18n()
usePageTitle(() => t('dv.applicationTitle'))
const message = useMessage()
const { state, ensureLoaded } = useRealm('dv')

const id = computed(() => String(route.params.id ?? ''))
const application = ref<Application | null>(null)
const requested = ref<DvPermissions>({ ...EMPTY })
const review = ref<DvPermissions>({ ...EMPTY })
const busy = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const canReview = computed(() => isAdmin.value && application.value?.status === 'submitted')
const approved = computed(() => application.value?.status === 'approved')

function parse(json: string | null): DvPermissions {
  if (!json) return { ...EMPTY }
  try {
    return { ...EMPTY, ...(JSON.parse(json) as DvPermissions) }
  } catch {
    return { ...EMPTY }
  }
}

function samePermissions(a: DvPermissions, b: DvPermissions): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function load(): Promise<void> {
  try {
    const row = await api<Application>(`/dv/terminal-applications/${id.value}`)
    application.value = row
    requested.value = parse(row.permissionsJson)
    review.value = parse(row.overridePermissionsJson ?? row.permissionsJson)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    application.value = null
  }
}

async function approve(): Promise<void> {
  busy.value = true
  try {
    const body: { permissions?: DvPermissions } = {}
    if (!samePermissions(review.value, requested.value)) body.permissions = review.value
    await api(`/dv/terminal-applications/${id.value}/approve`, {
      method: 'POST',
      body: Object.keys(body).length ? body : undefined,
    })
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

async function reject(): Promise<void> {
  busy.value = true
  try {
    await api(`/dv/terminal-applications/${id.value}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value || 'rejected' },
    })
    rejectOpen.value = false
    rejectReason.value = ''
    message.success(t('common.success'))
    await load()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    busy.value = false
  }
}

function downloadCertificate(): void {
  downloadUrl(
    `${apiBase}/dv/terminal-applications/${id.value}/certificate`,
    `terminal-${id.value}.der`,
  )
}

onMounted(async () => {
  await ensureLoaded()
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader
        :title="$t('dv.applicationTitle')"
        :subtitle="`#${id}`"
        :breadcrumbs="[{ label: $t('nav.dv'), to: '/dv' }, { label: `#${id}` }]"
      />

      <NCard v-if="application" size="small" :title="$t('dv.applicationTitle')">
        <template #header-extra>
          <StatusTag :status="application.status" />
        </template>
        <NDescriptions :column="2" size="small" :bordered="false">
          <NDescriptionsItem :label="$t('dv.subjectCn')">
            {{ application.subjectCn ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.holderMnemonic')">
            {{ application.holderMnemonic ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.keyMode')">
            {{
              application.keyMode === 'remote_generated'
                ? $t('dv.keyModeRemote')
                : $t('dv.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.mnt')">{{
            application.mnt ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.ip')">{{
            application.ip ?? '—'
          }}</NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.validityDays')">
            {{ application.validityDays ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.applicationUrl')">
            {{ application.applicationUrl ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.submittedAt')">
            <DateTimeText :value="application.createdAt" />
          </NDescriptionsItem>
          <NDescriptionsItem v-if="application.reviewedAt" :label="$t('dv.reviewedAt')">
            <DateTimeText :value="application.reviewedAt" />
          </NDescriptionsItem>
        </NDescriptions>

        <div style="margin-top: 12px">
          <NText strong>{{ $t('dv.permissionsTitle') }}</NText>
          <PermissionsEditor :model-value="requested" readonly style="margin-top: 8px" />
        </div>

        <NText v-if="application.notes" depth="3" style="display: block; margin-top: 8px">
          {{ application.notes }}
        </NText>
        <NCollapse v-if="application.csrPem || application.publicKeyPem" style="margin-top: 12px">
          <NCollapseItem v-if="application.csrPem" :title="$t('dv.csr')" name="csr">
            <NInput
              :value="application.csrPem"
              type="textarea"
              :rows="6"
              readonly
              class="epass42-mono"
            />
          </NCollapseItem>
          <NCollapseItem v-if="application.publicKeyPem" :title="$t('dv.publicKey')" name="spki">
            <NInput
              :value="application.publicKeyPem"
              type="textarea"
              :rows="5"
              readonly
              class="epass42-mono"
            />
          </NCollapseItem>
        </NCollapse>
        <NText v-if="application.rejectReason" depth="3" style="display: block; margin-top: 8px">
          {{ $t('dv.rejectReason') }}: {{ application.rejectReason }}
        </NText>

        <div v-if="canReview" style="margin-top: 16px">
          <NText strong>{{ $t('dv.approvedPermissions') }}</NText>
          <NText depth="3" style="display: block; font-size: 12px; margin: 4px 0 8px">
            {{ $t('dv.reviewHint') }}
          </NText>
          <PermissionsEditor v-model="review" />
          <div class="epass42-actions" style="margin-top: 12px">
            <NButton type="primary" :loading="busy" @click="approve">
              {{ $t('dv.approve') }}
            </NButton>
            <NButton @click="rejectOpen = true">{{ $t('common.reject') }}</NButton>
          </div>
        </div>
        <div v-else-if="approved" style="margin-top: 16px">
          <NText strong>{{ $t('dv.approvedPermissions') }}</NText>
          <div style="margin-top: 8px">
            <PermissionsSummary :permissions="review" />
          </div>
          <NButton
            v-if="application.terminalCertId !== null"
            size="small"
            style="margin-top: 12px"
            @click="downloadCertificate"
          >
            {{ $t('dv.download') }}
          </NButton>
        </div>
      </NCard>

      <NText v-else depth="3">{{ $t('errors.not_found') }}</NText>

      <NuxtLink to="/dv">
        <NButton quaternary size="small">{{ $t('common.back') }}</NButton>
      </NuxtLink>
    </NSpace>

    <NModal
      v-model:show="rejectOpen"
      preset="card"
      :title="$t('dv.rejectReason')"
      style="max-width: 480px"
    >
      <NInput v-model:value="rejectReason" type="textarea" :rows="3" />
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="rejectOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="error" :loading="busy" @click="reject">{{ $t('common.confirm') }}</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
