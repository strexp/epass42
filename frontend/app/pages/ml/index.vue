<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NIcon,
  NResult,
  NSpace,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import { FileCheck, FolderTree, RotateCcw, ScrollText } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { useMlStatus } from '~/composables/useLifecycleStatus'
import StatusTag from '~/components/common/StatusTag.vue'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import AdminOnlyBadge from '~/components/common/AdminOnlyBadge.vue'

definePageMeta({ layout: 'realm' })

const { state, ensureLoaded, showAdmin } = useRealm('ml')
const api = useApi()
const { t } = useI18n()
const { formatDate, formatDateTime } = useDateTime()
const { status: lifecycle, refresh: refreshLifecycle } = useMlStatus()
usePageTitle(() => t('ml.title'))
const message = useMessage()
const dialog = useDialog()

const rotateBusy = ref(false)
const generateBusy = ref(false)

const signedIn = computed(() => state.value.me !== null)
const isAdmin = computed(() => state.value.me?.isAdmin ?? false)
const signer = computed(() => lifecycle.value?.signer ?? null)
const latest = computed(() => lifecycle.value?.latestMasterList ?? null)
const signerMissing = computed(() => lifecycle.value !== null && signer.value === null)
const expiringSoon = computed(() => {
  const item = signer.value
  return Boolean(item && !item.expired && item.daysRemaining !== null && item.daysRemaining <= 90)
})
const latestSignedByRetired = computed(() => {
  const ml = latest.value
  if (!ml || !signer.value) return false
  return ml.signerId !== signer.value.id || ml.signerStatus !== 'active'
})

/** Confirms the ML signer rotation; the old signer is retired. */
function confirmRotate(): void {
  dialog.warning({
    title: t('ml.rotateSigner'),
    content: t('ml.rotateWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void rotate(),
  })
}

async function rotate(): Promise<void> {
  rotateBusy.value = true
  try {
    await api('/ml/signers/rotate', { method: 'POST', body: { confirm: true } })
    message.success(t('common.success'))
    await refreshLifecycle()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    rotateBusy.value = false
  }
}

/** Confirms generating and publishing a new master list. */
function confirmGenerate(): void {
  dialog.warning({
    title: t('ml.generate'),
    content: t('ml.generateWarning'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => void generate(),
  })
}

async function generate(): Promise<void> {
  generateBusy.value = true
  try {
    await api('/ml/masterlists', { method: 'POST', body: { confirm: true } })
    message.success(t('common.success'))
    await refreshLifecycle()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    generateBusy.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  if (!isAdmin.value) return
  await refreshLifecycle()
})
</script>

<template>
  <div class="epass42-page">
    <NSpace vertical size="large">
      <PageHeader :title="$t('ml.title')" :subtitle="$t('ml.subtitle')" />

      <NCard v-if="!signedIn" size="small">
        <NText depth="3">{{ $t('ml.signInHint') }}</NText>
      </NCard>

      <NResult v-else-if="!isAdmin" status="403" :title="$t('ml.noAccess')" />

      <NCard v-else-if="!showAdmin" :title="$t('ml.title')" size="small">
        <NText depth="3">{{ $t('auth.adminModeOffHint') }}</NText>
      </NCard>

      <template v-else>
        <ExpiryAlert
          v-if="signerMissing"
          :title="$t('ml.signerTitle')"
          :description="$t('ml.signerMissing')"
        />
        <ExpiryAlert
          v-else-if="signer?.expired"
          :title="$t('ml.signerTitle')"
          :description="$t('ml.signerExpired', { date: formatDate(signer.notAfter) })"
        />
        <NAlert v-else-if="expiringSoon && signer" type="warning" :show-icon="false">
          {{
            $t('ml.signerExpiring', {
              date: formatDate(signer.notAfter),
              days: signer.daysRemaining,
            })
          }}
        </NAlert>

        <NCard :title="$t('ml.masterListTitle')" size="small">
          <template #header-extra><AdminOnlyBadge /></template>
          <NText depth="3">{{ $t('ml.masterListHint') }}</NText>
          <NAlert
            v-if="latestSignedByRetired"
            type="warning"
            :show-icon="false"
            style="margin-top: 12px"
          >
            {{ $t('ml.signedByRetired') }}
          </NAlert>
          <NDescriptions v-if="latest" :column="3" size="small" style="margin-top: 12px">
            <NDescriptionsItem :label="$t('ml.latestMasterList')">
              <span class="epass42-mono">{{ latest.objectId }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.publishedAt')">
              {{ formatDateTime(latest.publishedAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signedBy')">
              <span class="epass42-mono">{{ latest.signerSerial ?? '—' }}</span>
            </NDescriptionsItem>
          </NDescriptions>
          <NText v-else depth="3">{{ $t('ml.noMasterList') }}</NText>

          <template #action>
            <NSpace>
              <NButton
                type="primary"
                :loading="generateBusy"
                :disabled="!lifecycle?.canGenerateMasterList"
                @click="confirmGenerate"
              >
                <template #icon
                  ><NIcon><FileCheck /></NIcon
                ></template>
                {{ $t('ml.generate') }}<AdminActionIcon />
              </NButton>
              <NuxtLink to="/pkd">
                <NButton>
                  <template #icon
                    ><NIcon><FolderTree /></NIcon
                  ></template>
                  {{ $t('ml.openPkd') }}
                </NButton>
              </NuxtLink>
              <NuxtLink to="/ml/audit">
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

        <NCard :title="$t('ml.signerTitle')" size="small">
          <template #header-extra><AdminOnlyBadge /></template>
          <NText depth="3">{{ $t('ml.signerHint') }}</NText>
          <NDescriptions v-if="signer" :column="3" size="small" style="margin-top: 12px">
            <NDescriptionsItem :label="$t('ml.signerSerial')">
              <span class="epass42-mono">{{ signer.serial }}</span>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signerSubject')">
              {{ signer.subjectDn }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signerStatus')">
              <StatusTag :status="signer.status" />
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signerValidity')">
              {{ formatDate(signer.notBefore) }} → {{ formatDate(signer.notAfter) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signerKeyAlgorithm')">
              {{ signer.keyAlgorithm ?? '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('ml.signerFingerprint')">
              <NText class="epass42-mono">{{ signer.fingerprintSha256 }}</NText>
            </NDescriptionsItem>
          </NDescriptions>
          <NText v-else depth="3">{{ $t('ml.signerMissing') }}</NText>

          <NAlert
            v-if="lifecycle && !lifecycle.canRotateSigner"
            type="warning"
            :show-icon="false"
            style="margin-top: 12px"
          >
            {{ $t('ml.cscaExpired') }}
          </NAlert>

          <template #action>
            <NButton
              type="warning"
              :loading="rotateBusy"
              :disabled="!lifecycle?.canRotateSigner"
              @click="confirmRotate"
            >
              <template #icon
                ><NIcon><RotateCcw /></NIcon
              ></template>
              {{ $t('ml.rotateSigner') }}<AdminActionIcon />
            </NButton>
          </template>
        </NCard>
      </template>
    </NSpace>
  </div>
</template>
