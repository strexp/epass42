<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NButton,
  NCard,
  NDataTable,
  NDropdown,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { errorMessageKey, useApiBase } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { downloadUrl } from '~/utils/download'
import { formatDate } from '~/utils/datetime'
import StatusTag from '~/components/common/StatusTag.vue'
import PermissionsEditor from '~/components/cvca/PermissionsEditor.vue'
import PermissionsSummary from '~/components/cvca/PermissionsSummary.vue'
import type { DvPermissions } from '@epass42/shared'

interface Certificate {
  id: number
  holderReference: string
  authorityReference: string
  subjectCn: string | null
  status: string
  source: string
  mnt: string | null
  keyMode: string
  dvClass: string
  permissions: DvPermissions
  hasPrivateKey: boolean
  notBefore: string | null
  notAfter: string | null
}

function clonePermissions(permissions: DvPermissions): DvPermissions {
  return {
    epassport: { ...permissions.epassport },
    travel: { ...permissions.travel },
    visa: { ...permissions.visa },
    biometrics: { ...permissions.biometrics },
  }
}

const api = useApi()
const apiBase = useApiBase()
const { state, ensureLoaded } = useRealm('cvca')
const { t } = useI18n()
usePageTitle(() => t('cvca.certificatesTitle'))
const message = useMessage()
const dialog = useDialog()
const certificates = ref<Certificate[]>([])
const loading = ref(false)

const terminalOpen = ref(false)
const terminalBusy = ref(false)
const terminalFor = ref<Certificate | null>(null)
const terminalForm = reactive({
  subjectCn: '',
  holderMnemonic: '',
  keyMode: 'remote_generated' as 'remote_generated' | 'user_uploaded',
  csrPem: '',
  publicKeyPem: '',
  permissions: clonePermissions({
    epassport: { dg3: false, dg4: false },
    travel: { read: false, write: false },
    visa: { read: false, write: false },
    biometrics: { read: false, write: false },
  }),
})

const keyModeOptions = computed(() => [
  { label: t('cvca.keyModeNia'), value: 'remote_generated' },
  { label: t('cvca.keyModeUpload'), value: 'user_uploaded' },
])

const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const myMnt = computed(() => state.value.me?.account.activeMnt ?? null)

function isOwner(row: Certificate): boolean {
  return row.mnt !== null && row.mnt === myMnt.value
}

/** Whether the current user may download this certificate's private key. */
function canDownloadKey(row: Certificate): boolean {
  if (!row.hasPrivateKey || state.value.me === null) return false
  return isAdmin.value || isOwner(row)
}

/** The DV's key must still be held to sign terminal certificates. */
function canIssueTerminal(row: Certificate): boolean {
  return row.hasPrivateKey && (isAdmin.value || isOwner(row))
}

function keyUrl(id: number): string {
  return `${apiBase}/cvca/certificates/${id}/private-key`
}

/** Confirms the one-time download, then triggers it and refreshes the list. */
function downloadKey(row: Certificate): void {
  dialog.warning({
    title: t('cvca.privateKeyTitle'),
    content: t('cvca.privateKeyWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => {
      downloadUrl(keyUrl(row.id), `dv-${row.id}.key`)
      window.setTimeout(() => void load(), 1500)
    },
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await api<{ items: Certificate[] }>('/cvca/certificates')
    certificates.value = result.items ?? []
  } catch (error) {
    message.error(t(errorMessageKey(error)))
    certificates.value = []
  } finally {
    loading.value = false
  }
}

function openTerminal(row: Certificate): void {
  terminalFor.value = row
  terminalForm.subjectCn = ''
  terminalForm.holderMnemonic = ''
  terminalForm.keyMode = 'remote_generated'
  terminalForm.csrPem = ''
  terminalForm.publicKeyPem = ''
  // The terminal cannot exceed the DV's grant: start from it.
  terminalForm.permissions = clonePermissions(row.permissions)
  terminalOpen.value = true
}

async function issueTerminal(): Promise<void> {
  if (!terminalFor.value) return
  if (
    terminalForm.keyMode === 'user_uploaded' &&
    !terminalForm.csrPem.trim() &&
    !terminalForm.publicKeyPem.trim()
  ) {
    message.error(t('cvca.uploadHint'))
    return
  }
  terminalBusy.value = true
  try {
    await api(`/cvca/certificates/${terminalFor.value.id}/terminals`, {
      method: 'POST',
      body: {
        subjectCn: terminalForm.subjectCn,
        holderMnemonic: terminalForm.holderMnemonic || undefined,
        keyMode: terminalForm.keyMode,
        csrPem: terminalForm.csrPem || undefined,
        publicKeyPem: terminalForm.publicKeyPem || undefined,
        permissions: terminalForm.permissions,
      },
    })
    terminalOpen.value = false
    message.success(t('common.success'))
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    terminalBusy.value = false
  }
}

/** The per-certificate menu: DER download and, when allowed, key/terminal. */
function actionMenu(row: Certificate) {
  const options = [
    { label: t('common.der'), key: 'der' },
    ...(canDownloadKey(row) ? [{ label: t('cvca.privateKey'), key: 'key' }] : []),
    ...(canIssueTerminal(row) ? [{ label: t('cvca.issueTerminal'), key: 'terminal' }] : []),
  ]
  return h(
    NDropdown,
    { options, onSelect: (key: string | number) => onAction(row, String(key)) },
    { default: () => h(NButton, { size: 'tiny' }, { default: () => t('common.actions') }) },
  )
}

function onAction(row: Certificate, key: string): void {
  if (key === 'der') {
    downloadUrl(`${apiBase}/cvca/certificates/${row.id}.der`, `dv-${row.id}.der`)
  } else if (key === 'key') {
    downloadKey(row)
  } else if (key === 'terminal') {
    openTerminal(row)
  }
}

const columns = computed(() => [
  { title: '#', key: 'id' },
  { title: t('common.cn'), key: 'subjectCn' },
  {
    title: t('cvca.holderReference'),
    key: 'holderReference',
    render: (row: Certificate) => h('span', { class: 'epass42-mono' }, row.holderReference),
  },
  { title: t('common.mnt'), key: 'mnt' },
  {
    title: t('cvca.dvClass'),
    key: 'dvClass',
    render: (row: Certificate) =>
      h(
        NTag,
        { size: 'small' },
        {
          default: () =>
            row.dvClass === 'foreign' ? t('cvca.dvClassForeign') : t('cvca.dvClassDomestic'),
        },
      ),
  },
  {
    title: t('cvca.permissionsTitle'),
    key: 'permissions',
    width: 180,
    ellipsis: true,
    render: (row: Certificate) =>
      h(PermissionsSummary, { permissions: row.permissions, maxWidth: '180px' }),
  },
  {
    title: t('common.status'),
    key: 'status',
    render: (row: Certificate) => h(StatusTag, { status: row.status }),
  },
  {
    title: t('pkd.validity'),
    key: 'validity',
    render: (row: Certificate) => `${formatDate(row.notBefore)} → ${formatDate(row.notAfter)}`,
  },
  {
    title: '',
    key: 'actions',
    render: (row: Certificate) => actionMenu(row),
  },
])

onMounted(async () => {
  await ensureLoaded()
  await load()
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('cvca.certificatesTitle')"
      :breadcrumbs="[{ label: $t('nav.cvca'), to: '/cvca' }, { label: $t('nav.certificates') }]"
    />
    <NCard>
      <p>{{ $t('pkd.dvsHint') }}</p>
      <div role="region" :aria-label="$t('cvca.certificatesTitle')">
        <NDataTable
          :columns="columns"
          :data="certificates"
          :loading="loading"
          :pagination="{ pageSize: 10 }"
          size="small"
        />
      </div>
      <template #footer>
        <NuxtLink to="/cvca"
          ><NButton size="small">{{ $t('common.back') }}</NButton></NuxtLink
        >
      </template>
    </NCard>

    <NModal
      v-model:show="terminalOpen"
      preset="card"
      :title="$t('cvca.terminalTitle')"
      style="max-width: 560px"
    >
      <NText depth="3">{{ $t('cvca.terminalHint') }}</NText>
      <NForm label-placement="top" style="margin-top: 12px">
        <NFormItem :label="$t('cvca.subjectCn')">
          <NInput v-model:value="terminalForm.subjectCn" maxlength="64" />
        </NFormItem>
        <NFormItem :label="$t('cvca.holderMnemonic')">
          <NInput v-model:value="terminalForm.holderMnemonic" maxlength="9" />
        </NFormItem>
        <NFormItem :label="$t('cvca.keyMode')">
          <NSelect v-model:value="terminalForm.keyMode" :options="keyModeOptions" />
        </NFormItem>
        <NFormItem v-if="terminalForm.keyMode === 'user_uploaded'" :label="$t('cvca.csr')">
          <NInput v-model:value="terminalForm.csrPem" type="textarea" :rows="4" />
        </NFormItem>
        <NFormItem v-if="terminalForm.keyMode === 'user_uploaded'" :label="$t('cvca.publicKey')">
          <NInput v-model:value="terminalForm.publicKeyPem" type="textarea" :rows="3" />
        </NFormItem>
        <NFormItem :label="$t('cvca.permissionsTitle')">
          <PermissionsEditor v-model="terminalForm.permissions" />
        </NFormItem>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="terminalOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="primary" :loading="terminalBusy" @click="issueTerminal">
            {{ $t('cvca.issueTerminal') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
