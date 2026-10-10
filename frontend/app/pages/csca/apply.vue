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
import { LogIn, Save } from '@lucide/vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { auth, state, ensureLoaded } = useRealm('csca')
const { t } = useI18n()
const message = useMessage()
const notify = useNotify()

const signedIn = computed(() => state.value.me !== null)

const form = reactive({
  keyMode: 'nia_generated' as 'nia_generated' | 'user_uploaded',
  subjectCn: '',
  subjectO: '',
  subjectOu: '',
  csrPem: '',
  publicKeyPem: '',
  documentType: 'P',
  validityDays: 3650,
  issuancePolicy: 'open',
  applicationUrl: '',
  notes: '',
})
const submitting = ref(false)

const keyModeOptions = computed(() => [
  { label: t('csca.keyModeNia'), value: 'nia_generated' },
  { label: t('csca.keyModeUpload'), value: 'user_uploaded' },
])

const policyOptions = computed(() => [
  { label: t('csca.policyDefault'), value: 'open' },
  { label: t('csca.policyNia'), value: 'selective' },
  { label: t('csca.policyAsManaged'), value: 'internal' },
  { label: t('csca.policyStrict'), value: 'restricted' },
])

const documentTypeOptions = [
  { label: 'P — Passport (TD3)', value: 'P' },
  { label: 'ID — Identity card', value: 'ID' },
]

function login(): void {
  auth.login('csca', '/csca/apply')
}

/** Wizard: 0 application, 1 review. */
const LAST_STEP = 1
const step = ref(0)

function isUrl(value: string): boolean {
  if (value.trim() === '') return true
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

const applicationValid = computed(() => {
  if (form.subjectCn.trim() === '') return false
  if (
    form.keyMode === 'user_uploaded' &&
    form.csrPem.trim() === '' &&
    form.publicKeyPem.trim() === ''
  ) {
    return false
  }
  return isUrl(form.applicationUrl)
})
const stepValid = computed(() => (step.value === 0 ? applicationValid.value : true))

function nextStep(): void {
  if (step.value < LAST_STEP && stepValid.value) step.value += 1
}

function prevStep(): void {
  if (step.value > 0) step.value -= 1
}

async function submit(): Promise<void> {
  if (!applicationValid.value) {
    message.error(t('errors.validation_failed'))
    step.value = 0
    return
  }
  submitting.value = true
  try {
    await api('/csca/applications', {
      method: 'POST',
      body: {
        keyMode: form.keyMode,
        subjectCn: form.subjectCn,
        subjectO: form.subjectO || undefined,
        subjectOu: form.subjectOu || undefined,
        csrPem: form.csrPem || undefined,
        publicKeyPem: form.publicKeyPem || undefined,
        documentType: form.documentType,
        validityDays: form.validityDays,
        issuancePolicy: form.issuancePolicy || undefined,
        applicationUrl: form.applicationUrl || undefined,
        notes: form.notes || undefined,
      },
    })
    notify.success(t('common.success'))
    await navigateTo('/csca')
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('csca.applyTitle')"
      :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: $t('nav.apply') }]"
    />
    <NCard v-if="signedIn">
      <NSteps :current="step + 1" size="small" style="margin-bottom: 16px">
        <NStep :title="$t('csca.stepApplication')" />
        <NStep :title="$t('csca.stepReview')" />
      </NSteps>

      <template v-if="step === 0">
        <NText depth="3">{{ $t('auth.signedInTo', { realm: 'CSCA' }) }}</NText>
        <NForm label-placement="top" style="margin-top: 12px">
          <NFormItem :label="$t('csca.keyMode')">
            <NSelect v-model:value="form.keyMode" :options="keyModeOptions" />
          </NFormItem>
          <NFormItem :label="$t('csca.subjectCn')" required>
            <NInput v-model:value="form.subjectCn" maxlength="64" />
          </NFormItem>
          <NFormItem :label="$t('csca.subjectO')">
            <NInput v-model:value="form.subjectO" maxlength="64" />
          </NFormItem>
          <NFormItem :label="$t('csca.subjectOu')">
            <NInput v-model:value="form.subjectOu" maxlength="64" />
          </NFormItem>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('csca.csr')">
            <NInput v-model:value="form.csrPem" type="textarea" :rows="6" />
          </NFormItem>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" :label="$t('csca.publicKey')">
            <NInput v-model:value="form.publicKeyPem" type="textarea" :rows="4" />
          </NFormItem>
          <NText
            v-if="form.keyMode === 'user_uploaded'"
            depth="3"
            style="display: block; font-size: 12px; margin-bottom: 12px"
          >
            {{ $t('csca.uploadHint') }}
          </NText>
          <NFormItem :label="$t('csca.documentType')">
            <NSelect v-model:value="form.documentType" :options="documentTypeOptions" />
          </NFormItem>
          <NFormItem :label="$t('csca.validityDays')">
            <NInputNumber v-model:value="form.validityDays" :min="1" :max="7300" />
          </NFormItem>
          <NFormItem :label="$t('csca.issuancePolicy')">
            <NSelect v-model:value="form.issuancePolicy" :options="policyOptions" />
          </NFormItem>
          <NFormItem :label="$t('csca.applicationUrl')">
            <NInput v-model:value="form.applicationUrl" placeholder="https://" />
          </NFormItem>
          <NFormItem :label="$t('csca.notes')">
            <NInput v-model:value="form.notes" type="textarea" />
          </NFormItem>
        </NForm>
      </template>

      <template v-else>
        <NText depth="3">{{ $t('csca.reviewSummary') }}</NText>
        <NDescriptions :column="2" size="small" style="margin-top: 12px">
          <NDescriptionsItem :label="$t('csca.keyMode')">
            {{
              form.keyMode === 'nia_generated' ? $t('csca.keyModeNia') : $t('csca.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectCn')">
            {{ form.subjectCn }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectO')">
            {{ form.subjectO || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectOu')">
            {{ form.subjectOu || '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.documentType')">
            {{ form.documentType }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.validityDays')">
            {{ form.validityDays }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.issuancePolicy')">
            {{ form.issuancePolicy }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.applicationUrl')">
            {{ form.applicationUrl || '—' }}
          </NDescriptionsItem>
        </NDescriptions>
      </template>

      <template #action>
        <NSpace justify="space-between" style="width: 100%">
          <div>
            <NButton v-if="step > 0" @click="prevStep">{{ $t('common.previous') }}</NButton>
          </div>
          <div>
            <NButton
              v-if="step < LAST_STEP"
              type="primary"
              :disabled="!stepValid"
              @click="nextStep"
            >
              {{ $t('common.next') }}
            </NButton>
            <NButton
              v-else
              type="primary"
              :loading="submitting"
              :disabled="!applicationValid"
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
      <NResult status="info" :title="$t('auth.signInTo', { realm: 'CSCA' })">
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
