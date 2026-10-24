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
import { computed, onMounted, reactive, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { usePkdConfig } from '~/composables/usePkdConfig'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import { expiryDescription, useCscaStatus } from '~/composables/useLifecycleStatus'
import { isValidSubjectName, type DocumentTypeCode, type Lds2SignerType } from '@epass42/shared'
import { dscDocumentTypeValues, documentTypesLabel } from '~/utils/documentTypes'
import { lds2SignerTypeValues, lds2SignerTypesLabel } from '~/utils/lds2'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { auth, state, ensureLoaded } = useRealm('csca')
const { t } = useI18n()
const { formatDate } = useDateTime()
const { status: lifecycle, refresh: refreshLifecycle } = useCscaStatus()
const cscaExpiryText = computed(() =>
  expiryDescription(
    lifecycle.value?.csca ?? null,
    {
      missing: t('csca.expiredTitle'),
      certificate: (date) => t('csca.expiredWarning', { date }),
      privateKey: (date) => t('csca.privateKeyExpiredWarning', { date }),
    },
    formatDate,
  ),
)
usePageTitle(() => t('csca.applyTitle'))
const message = useMessage()
const notify = useNotify()
const { config, load: loadPkdConfig } = usePkdConfig()

const certificatePolicies = computed(() => config.value?.certificatePolicies)
const dscMaxValidityDays = computed(() => certificatePolicies.value?.dsc.maxValidityDays ?? 3650)
const lds2MaxValidityDays = computed(() => certificatePolicies.value?.lds2.maxValidityDays ?? 3760)
const defaultValidityDays = computed(() =>
  isLds2.value
    ? (certificatePolicies.value?.lds2.defaultValidityDays ?? 3760)
    : (certificatePolicies.value?.dsc.defaultValidityDays ?? 3650),
)

const signedIn = computed(() => state.value.me !== null)

const form = reactive({
  keyMode: 'remote_generated' as 'remote_generated' | 'user_uploaded',
  certificateType: 'dsc' as 'dsc' | 'lds2',
  subjectCn: '',
  subjectO: '',
  subjectOu: '',
  csrPem: '',
  publicKeyPem: '',
  documentTypes: ['P'] as DocumentTypeCode[],
  lds2Types: ['ts'] as Lds2SignerType[],
  validityDays: 3650,
  issuancePolicy: 'open',
  applicationUrl: '',
  notes: '',
})
const submitting = ref(false)
const isLds2 = computed(() => form.certificateType === 'lds2')
/** The previewed expiry: the backend now issues the exact day count. */
const requestedNotAfter = computed(() =>
  new Date(Date.now() + form.validityDays * 86_400_000).toISOString(),
)

const keyModeOptions = computed(() => [
  { label: t('csca.keyModeNia'), value: 'remote_generated' },
  { label: t('csca.keyModeUpload'), value: 'user_uploaded' },
])

const policyOptions = computed(() => [
  { label: t('csca.policyDefault'), value: 'open' },
  { label: t('csca.policyNia'), value: 'selective' },
  { label: t('csca.policyAsManaged'), value: 'internal' },
  { label: t('csca.policyStrict'), value: 'restricted' },
])

const documentTypeOptions = computed(() =>
  dscDocumentTypeValues.map((item) => ({ label: t(item.labelKey), value: item.value })),
)

const lds2TypeOptions = computed(() =>
  lds2SignerTypeValues.map((item) => ({ label: t(item.labelKey), value: item.value })),
)

const certificateTypeOptions = computed(() => [
  { label: t('csca.certificateTypeDsc'), value: 'dsc' },
  { label: t('csca.certificateTypeLds2'), value: 'lds2' },
])

/** Switches the form profile; LDS2 subjects have no O/OU or DocumentType. */
function setCertificateType(value: 'dsc' | 'lds2'): void {
  form.certificateType = value
  if (value === 'lds2') {
    form.subjectO = ''
    form.subjectOu = ''
    form.documentTypes = []
    form.validityDays = certificatePolicies.value?.lds2.defaultValidityDays ?? 3760
    if (form.lds2Types.length === 0) form.lds2Types = ['ts']
  } else {
    if (form.documentTypes.length === 0) form.documentTypes = ['P']
    form.validityDays = certificatePolicies.value?.dsc.defaultValidityDays ?? 3650
  }
}

/** The DocumentType extension holds at most two values. */
function setDocumentTypes(values: DocumentTypeCode[] | null): void {
  form.documentTypes = (values ?? []).slice(0, 2)
}

/** An LDS2 Signer may authorize one, two or all three roles. */
function setLds2Types(values: Lds2SignerType[] | null): void {
  form.lds2Types = (values ?? []).slice(0, 3)
}

function login(): void {
  auth.login('csca', '/csca/apply')
}

/** Wizard: 0 application, 1 review. */
const LAST_STEP = 1
const step = ref(0)
const formRef = ref<FormInst | null>(null)

function isUrl(value: string): boolean {
  if (value.trim() === '') return true
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

/** Field rules; Naive UI renders the inline feedback under each field. */
const rules = computed<FormRules>(() => ({
  subjectCn: {
    required: true,
    validator: (_rule: unknown, value: string) =>
      value.trim() !== '' && isValidSubjectName(value) && (!isLds2.value || value.length <= 9),
    message: t('csca.subjectNameRule'),
    trigger: ['input', 'blur'],
  },
  subjectO: {
    validator: (_rule: unknown, value: string) => !value || isValidSubjectName(value),
    message: t('csca.subjectNameRule'),
    trigger: ['input', 'blur'],
  },
  subjectOu: {
    validator: (_rule: unknown, value: string) => !value || isValidSubjectName(value),
    message: t('csca.subjectNameRule'),
    trigger: ['input', 'blur'],
  },
  applicationUrl: {
    validator: (_rule: unknown, value: string) => isUrl(value),
    message: t('errors.invalid_url'),
    trigger: ['input', 'blur'],
  },
  csrPem: {
    validator: () =>
      form.keyMode !== 'user_uploaded' ||
      form.csrPem.trim() !== '' ||
      form.publicKeyPem.trim() !== '',
    message: t('csca.uploadHint'),
    trigger: ['input', 'blur'],
  },
  documentTypes: {
    validator: () =>
      isLds2.value || (form.documentTypes.length >= 1 && form.documentTypes.length <= 2),
    message: t('csca.documentTypeRule'),
    trigger: ['change'],
  },
  lds2Types: {
    validator: () => !isLds2.value || form.lds2Types.length >= 1,
    message: t('csca.lds2TypeRule'),
    trigger: ['change'],
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
  if (lifecycle.value?.canIssueCertificates === false) {
    message.error(t('errors.csca_expired'))
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
    await api('/csca/applications', {
      method: 'POST',
      body: {
        keyMode: form.keyMode,
        certificateType: form.certificateType,
        subjectCn: form.subjectCn,
        ...(isLds2.value
          ? { lds2Types: form.lds2Types }
          : {
              subjectO: form.subjectO || undefined,
              subjectOu: form.subjectOu || undefined,
              documentTypes: form.documentTypes,
            }),
        csrPem: form.csrPem || undefined,
        publicKeyPem: form.publicKeyPem || undefined,
        validityDays: form.validityDays,
        issuancePolicy: form.issuancePolicy || undefined,
        applicationUrl: form.applicationUrl || undefined,
        notes: form.notes || undefined,
      },
    })
    notify.success(t('common.submitted'))
    await navigateTo('/csca')
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
  await refreshLifecycle()
  try {
    await loadPkdConfig()
    form.validityDays = defaultValidityDays.value
  } catch {
    // Keep the built-in defaults when the public config is unavailable.
  }
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('csca.applyTitle')"
      :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: $t('nav.apply') }]"
    />
    <NCard v-if="signedIn">
      <ExpiryAlert
        v-if="lifecycle?.csca?.expired"
        :title="$t('csca.expiredTitle')"
        :description="cscaExpiryText"
      />
      <NSteps :current="step + 1" size="small" style="margin-bottom: 16px">
        <NStep :title="$t('csca.stepApplication')" />
        <NStep :title="$t('csca.stepReview')" />
      </NSteps>

      <template v-if="step === 0">
        <NText depth="3">{{ $t('auth.signedInTo', { realm: 'CSCA' }) }}</NText>
        <NForm
          ref="formRef"
          :model="form"
          :rules="rules"
          label-placement="top"
          style="margin-top: 12px"
        >
          <NFormItem>
            <template #label>
              <FieldLabel
                :label="$t('csca.certificateType')"
                :hint="$t('csca.certificateTypeHint')"
              />
            </template>
            <NSelect
              :value="form.certificateType"
              :options="certificateTypeOptions"
              @update:value="setCertificateType"
            />
          </NFormItem>
          <NFormItem :label="$t('csca.keyMode')">
            <NSelect v-model:value="form.keyMode" :options="keyModeOptions" />
          </NFormItem>
          <NFormItem path="subjectCn" required>
            <template #label>
              <FieldLabel
                :label="$t('csca.subjectCn')"
                :hint="isLds2 ? $t('csca.lds2CnHint') : undefined"
              />
            </template>
            <NInput v-model:value="form.subjectCn" :maxlength="isLds2 ? 9 : 64" />
          </NFormItem>
          <NFormItem v-if="!isLds2" path="subjectO" :label="$t('csca.subjectO')">
            <NInput v-model:value="form.subjectO" maxlength="64" />
          </NFormItem>
          <NFormItem v-if="!isLds2" path="subjectOu" :label="$t('csca.subjectOu')">
            <NInput v-model:value="form.subjectOu" maxlength="64" />
          </NFormItem>
          <NFormItem v-if="form.keyMode === 'user_uploaded'" path="csrPem" :label="$t('csca.csr')">
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
            <template v-if="isLds2">{{ $t('csca.lds2KeyHint') }}</template>
          </NText>
          <NFormItem v-if="isLds2" path="lds2Types">
            <template #label>
              <FieldLabel :label="$t('csca.lds2Type')" :hint="$t('csca.lds2TypeHint')" />
            </template>
            <NSelect
              :value="form.lds2Types"
              multiple
              :max-tag-count="3"
              :options="lds2TypeOptions"
              @update:value="setLds2Types"
            />
          </NFormItem>
          <NFormItem v-if="!isLds2" path="documentTypes">
            <template #label>
              <FieldLabel :label="$t('csca.documentType')" :hint="$t('csca.documentTypeHint')" />
            </template>
            <NSelect
              :value="form.documentTypes"
              multiple
              :max-tag-count="2"
              :options="documentTypeOptions"
              @update:value="setDocumentTypes"
            />
          </NFormItem>
          <NFormItem>
            <template #label>
              <FieldLabel
                :label="$t('csca.validityDays')"
                :hint="isLds2 ? $t('csca.lds2ValidityHint') : undefined"
              />
            </template>
            <NInputNumber
              v-model:value="form.validityDays"
              :min="1"
              :max="isLds2 ? lds2MaxValidityDays : dscMaxValidityDays"
            />
          </NFormItem>
          <NFormItem :label="$t('csca.issuancePolicy')">
            <NSelect v-model:value="form.issuancePolicy" :options="policyOptions" />
          </NFormItem>
          <NFormItem path="applicationUrl" :label="$t('csca.applicationUrl')">
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
          <NDescriptionsItem :label="$t('csca.certificateType')">
            {{ isLds2 ? $t('csca.certificateTypeLds2') : $t('csca.certificateTypeDsc') }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.keyMode')">
            {{
              form.keyMode === 'remote_generated' ? $t('csca.keyModeNia') : $t('csca.keyModeUpload')
            }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.subjectCn')">
            {{ form.subjectCn }}
          </NDescriptionsItem>
          <template v-if="!isLds2">
            <NDescriptionsItem :label="$t('csca.subjectO')">
              {{ form.subjectO || '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('csca.subjectOu')">
              {{ form.subjectOu || '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('csca.documentType')">
              {{ documentTypesLabel(form.documentTypes, t) }}
            </NDescriptionsItem>
          </template>
          <NDescriptionsItem v-else :label="$t('csca.lds2Type')">
            {{ lds2SignerTypesLabel(form.lds2Types, t) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('csca.validityDays')">
            {{ form.validityDays }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.certificateValidity')">
            {{ formatDate(requestedNotAfter) }}
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
            <NButton v-if="step < LAST_STEP" type="primary" @click="nextStep">
              {{ $t('common.next') }}
            </NButton>
            <NButton
              v-else
              type="primary"
              :loading="submitting"
              :disabled="lifecycle?.canIssueCertificates === false"
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
