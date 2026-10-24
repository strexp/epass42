<script setup lang="ts">
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputNumber,
  NResult,
  NSelect,
  NSpace,
  NStep,
  NSteps,
  NText,
  useMessage,
} from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { LogIn, Save } from '@lucide/vue'
import { isValidSubjectName, type DvPermissions } from '@epass42/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import { useDvStatus } from '~/composables/useLifecycleStatus'
import PermissionsEditor from '~/components/cvca/PermissionsEditor.vue'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { auth, state, ensureLoaded } = useRealm('dv')
const { t } = useI18n()
const { formatDate } = useDateTime()
const { status: lifecycle, refresh: refreshLifecycle } = useDvStatus()
usePageTitle(() => t('dv.applyTitle'))
const message = useMessage()
const notify = useNotify()

const signedIn = computed(() => state.value.me !== null)

const form = reactive({
  keyMode: 'remote_generated' as 'remote_generated' | 'user_uploaded',
  subjectCn: '',
  holderMnemonic: '',
  csrPem: '',
  publicKeyPem: '',
  permissions: {
    epassport: { dg3: true, dg4: true },
    travel: { read: true, write: false },
    visa: { read: true, write: false },
    biometrics: { read: true, write: false },
  } as DvPermissions,
  validityDays: 90,
  notes: '',
})
const submitting = ref(false)

const keyModeOptions = computed(() => [
  { label: t('dv.keyModeRemote'), value: 'remote_generated' },
  { label: t('dv.keyModeUpload'), value: 'user_uploaded' },
])

function login(): void {
  auth.login('dv', '/dv/apply')
}

/** Wizard: 0 application, 1 review. */
const LAST_STEP = 1
const step = ref(0)
const formRef = ref<FormInst | null>(null)

/** Field rules; Naive UI renders the inline feedback under each field. */
const rules = computed<FormRules>(() => ({
  subjectCn: {
    required: true,
    validator: (_rule: unknown, value: string) => value.trim() !== '' && isValidSubjectName(value),
    message: t('dv.subjectNameRule'),
    trigger: ['input', 'blur'],
  },
  csrPem: {
    validator: () =>
      form.keyMode !== 'user_uploaded' ||
      form.csrPem.trim() !== '' ||
      form.publicKeyPem.trim() !== '',
    message: t('dv.uploadHint'),
    trigger: ['input', 'blur'],
  },
}))

async function nextStep(): Promise<void> {
  if (step.value === 0) {
    try {
      await formRef.value?.validate()
    } catch {
      return
    }
  }
  if (step.value < LAST_STEP) step.value += 1
}

function prevStep(): void {
  if (step.value > 0) step.value -= 1
}

async function submit(): Promise<void> {
  if (lifecycle.value?.canIssueTerminals === false) {
    message.error(t('errors.nia_dv_expired'))
    return
  }
  try {
    await formRef.value?.validate()
  } catch {
    step.value = 0
    return
  }
  submitting.value = true
  try {
    await api('/dv/terminal-applications', {
      method: 'POST',
      body: {
        keyMode: form.keyMode,
        subjectCn: form.subjectCn,
        holderMnemonic: form.holderMnemonic || undefined,
        csrPem: form.csrPem || undefined,
        publicKeyPem: form.publicKeyPem || undefined,
        permissions: form.permissions,
        validityDays: form.validityDays,
        notes: form.notes || undefined,
      },
    })
    notify.success(t('common.submitted'))
    await navigateTo('/dv')
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  await refreshLifecycle()
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('dv.applyTitle')"
      :breadcrumbs="[{ label: $t('nav.dv'), to: '/dv' }, { label: $t('nav.apply') }]"
    />
    <NCard v-if="signedIn">
      <ExpiryAlert
        v-if="lifecycle && !lifecycle.canIssueTerminals"
        :title="$t('dv.signingPaused')"
        :description="
          lifecycle.niaDv
            ? $t('dv.niaDvExpired', { date: formatDate(lifecycle.niaDv.notAfter) })
            : $t('dv.niaDvMissing')
        "
      />
      <NSteps :current="step + 1" size="small" style="margin-bottom: 16px">
        <NStep :title="$t('dv.stepApplication')" />
        <NStep :title="$t('dv.stepReview')" />
      </NSteps>

      <template v-if="step === 0">
        <NText depth="3">{{ $t('dv.applyHint') }}</NText>
        <NForm
          ref="formRef"
          :model="form"
          :rules="rules"
          label-placement="top"
          style="margin-top: 12px"
        >
          <NFormItem :label="$t('dv.keyMode')">
            <NSelect v-model:value="form.keyMode" :options="keyModeOptions" />
          </NFormItem>
          <NFormItem path="subjectCn" :label="$t('dv.subjectCn')" required>
            <NInput v-model:value="form.subjectCn" maxlength="64" />
          </NFormItem>
          <NFormItem :label="$t('dv.holderMnemonic')">
            <NInput v-model:value="form.holderMnemonic" maxlength="9" />
          </NFormItem>
          <NText depth="3" style="display: block; font-size: 12px; margin-bottom: 12px">
            {{ $t('dv.holderMnemonicHint') }}
          </NText>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" path="csrPem" :label="$t('dv.csr')">
            <NInput v-model:value="form.csrPem" type="textarea" :rows="6" />
          </NFormItem>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('dv.publicKey')">
            <NInput v-model:value="form.publicKeyPem" type="textarea" :rows="4" />
          </NFormItem>
          <NText
            v-if="form.keyMode === 'user_uploaded'"
            depth="3"
            style="display: block; font-size: 12px; margin-bottom: 12px"
          >
            {{ $t('dv.uploadHint') }}
          </NText>
          <NFormItem :label="$t('dv.permissionsTitle')">
            <NSpace vertical size="small">
              <NText depth="3" style="font-size: 12px">{{ $t('dv.permissionsHint') }}</NText>
              <PermissionsEditor v-model="form.permissions" />
            </NSpace>
          </NFormItem>
          <NFormItem :label="$t('dv.validityDays')">
            <NInputNumber v-model:value="form.validityDays" :min="1" :max="92" />
          </NFormItem>
          <NFormItem :label="$t('dv.notes')">
            <NInput v-model:value="form.notes" type="textarea" />
          </NFormItem>
        </NForm>
      </template>

      <template v-else>
        <NText depth="3">{{ $t('dv.reviewSummary') }}</NText>
        <NDescriptions :column="2" size="small" style="margin-top: 12px">
          <NDescriptionsItem :label="$t('dv.keyMode')">
            {{
              form.keyMode === 'remote_generated' ? $t('dv.keyModeRemote') : $t('dv.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.subjectCn')">
            {{ form.subjectCn }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.holderMnemonic')">
            {{ form.holderMnemonic || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('dv.validityDays')">
            {{ form.validityDays }}
          </NDescriptionsItem>
        </NDescriptions>
        <div style="margin-top: 12px">
          <NText strong>{{ $t('dv.permissionsTitle') }}</NText>
          <PermissionsEditor :model-value="form.permissions" readonly style="margin-top: 8px" />
        </div>
      </template>

      <template #action>
        <NSpace justify="space-between" style="width: 100%">
          <div>
            <NButton v-if="step > 0" @click="prevStep">{{ $t('common.previous') }}</NButton>
          </div>
          <div>
            <NButton v-if="step < LAST_STEP" type="primary" @click="nextStep">
              {{ $t('common.next') }}
            </NButton>
            <NButton
              v-else
              type="primary"
              :loading="submitting"
              :disabled="lifecycle?.canIssueTerminals === false"
              @click="submit"
            >
              <template #icon
                ><NIcon><Save /></NIcon
              ></template>
              {{ $t('common.submit') }}
            </NButton>
          </div>
        </NSpace>
      </template>
    </NCard>

    <NCard v-else>
      <NResult status="info" :title="$t('auth.signInTo', { realm: 'DV' })">
        <template #footer>
          <NButton type="primary" @click="login">
            <template #icon
              ><NIcon><LogIn /></NIcon
            ></template>
            {{ $t('common.login') }}
          </NButton>
        </template>
      </NResult>
    </NCard>
  </div>
</template>
