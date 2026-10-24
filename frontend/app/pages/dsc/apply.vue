<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NInputOtp,
  NModal,
  NResult,
  NSelect,
  NSpace,
  NStep,
  NSteps,
  NText,
  useMessage,
} from 'naive-ui'
import type { FormInst, FormRules } from 'naive-ui'
import { Send, Dices, LogIn, Copy } from '@lucide/vue'
import { computed, onMounted, reactive, ref } from 'vue'
import type { MrzFields } from '@epass42/shared'
import { COUNTRY_ALPHA3 } from '@epass42/shared'
import type { EncodedFile } from '~/components/common/FileField.vue'
import type { EncodedPortrait } from '~/components/emrtd/PortraitEditor.vue'
import { errorMessageKey } from '~/composables/useApi'
import { usePkdConfig } from '~/composables/usePkdConfig'
import { useRealm } from '~/composables/useRealm'
import ExpiryAlert from '~/components/common/ExpiryAlert.vue'
import { expiryDescription, useDscStatus } from '~/composables/useLifecycleStatus'
import { canIsValid, randomCan } from '~/utils/can'
import { documentTypeLabel, documentTypeValues } from '~/utils/documentTypes'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { t } = useI18n()
const { formatDate } = useDateTime()
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
usePageTitle(() => t('dsc.applyTitle'))
const message = useMessage()
const notify = useNotify()
const { auth, state, ensureLoaded } = useRealm('dsc')
const { load: loadPkdConfig } = usePkdConfig()

const signedIn = computed(() => state.value.me !== null)

const mrz = reactive<MrzFields>({
  documentCode: 'P',
  issuingState: COUNTRY_ALPHA3,
  surname: '',
  givenNames: '',
  documentNumber: '',
  // Nationality is defined by the NIA configuration, not by the applicant.
  nationality: COUNTRY_ALPHA3,
  dateOfBirth: '',
  sex: '<',
  personalNumber: '',
  optionalData: '',
})

const portrait = ref<EncodedPortrait | null>(null)
const dg5 = ref<EncodedFile | null>(null)
const dg7 = ref<EncodedFile | null>(null)
const dg3 = ref<EncodedFile | null>(null)
const dg4 = ref<EncodedFile | null>(null)
/**
 * Six CAN digits; empty boxes stay empty so editing a middle digit preserves
 * position. An empty value means "use the MRZ".
 */
const canDigits = ref<string[]>(Array.from({ length: 6 }, () => ''))
const can = computed(() => canDigits.value.join(''))
const fullName = ref('')
const placeOfBirth = ref('')
const address = ref('')
const telephone = ref('')
const customNotes = ref('')
const people = ref<{ name: string; telephone: string; address: string; dateRecorded: string }[]>([])
const email = ref('')
const notes = ref('')
const submitting = ref(false)
const reference = ref<string | null>(null)
const copied = ref(false)

const sexOptions = computed(() => [
  { label: t('dsc.sexFemale'), value: 'F' },
  { label: t('dsc.sexMale'), value: 'M' },
  { label: t('dsc.sexUnspecified'), value: '<' },
])

const documentTypeOptions = computed(() =>
  documentTypeValues.map((item) => ({ label: t(item.labelKey), value: item.value })),
)

/** TD1 names occupy 30 characters; TD3 names occupy 39. */
const nameMaxLength = computed(() => (mrz.documentCode === 'P' ? 39 : 30))

interface Jurisdiction {
  mnts: string[]
  useNiaDsc: boolean | null
  notice: boolean
  ownDscUrl: string | null
  /** Who reviews an NIA-signed request: the applicant's own MNT + DSC admins. */
  reviewers: string[]
}
const jurisdiction = ref<Jurisdiction | null>(null)
const noticeDismissed = ref(false)

interface ActivePassport {
  reference: string
  status: string
  documentNumber: string
  createdAt: string
  expiresAt: string | null
  deliveryMode: string
  consumedAt: string | null
  dataGroups: number[]
}
const activePassport = ref<ActivePassport | null>(null)
const revokeOpen = ref(false)
const revokeReason = ref('')
const revoking = ref(false)

/** Loads the applicant's current active passport, if any. */
async function loadActivePassport(): Promise<void> {
  if (!signedIn.value) {
    activePassport.value = null
    return
  }
  try {
    const result = await api<{ passport: ActivePassport | null }>('/dsc/passports/active')
    activePassport.value = result.passport
  } catch {
    activePassport.value = null
  }
}

function loginToApply(): void {
  auth.login('dsc', '/dsc/apply')
}

/** Revokes the active passport early (a new approval would also supersede it). */
async function revokePassport(): Promise<void> {
  if (!activePassport.value) return
  revoking.value = true
  try {
    await api(`/dsc/passports/${activePassport.value.reference}/revoke`, {
      method: 'POST',
      body: { reason: revokeReason.value || undefined },
    })
    revokeOpen.value = false
    revokeReason.value = ''
    message.success(t('common.revoked'))
    await loadActivePassport()
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    revoking.value = false
  }
}

/** Preview-only expiry (the service computes the real one from settings). */
const previewExpiry = computed(() => {
  const date = new Date()
  date.setUTCFullYear(date.getUTCFullYear() + 10)
  return (
    String(date.getUTCFullYear() % 100).padStart(2, '0') +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCDate()).padStart(2, '0')
  )
})
const previewMrz = computed(() => ({ ...mrz, dateOfExpiry: previewExpiry.value }))

/** Sex as shown in the summary: the MRZ filler `<` reads as `X`. */
const sexDisplay = computed(() => (mrz.sex === '<' ? 'X' : mrz.sex))

/** A CAN is six digits when provided; an empty value means "use the MRZ". */
const canValid = computed(() => canIsValid(can.value))

/** Wizard: 0 details, 1 photo, 2 additional, 3 review. */
const LAST_STEP = 3
const step = ref(0)
const detailsFormRef = ref<FormInst | null>(null)
const photoValid = computed(() => portrait.value !== null)

/** Step-0 field rules; Naive UI renders the inline feedback under each field. */
const detailsRules = computed<FormRules>(() => ({
  documentNumber: {
    required: true,
    message: t('errors.required'),
    trigger: ['input', 'blur'],
  },
  surname: {
    required: true,
    message: t('errors.required'),
    trigger: ['input', 'blur'],
  },
  dateOfBirth: {
    required: true,
    message: t('errors.required'),
    trigger: ['change'],
  },
}))

async function nextStep(): Promise<void> {
  if (step.value === 0) {
    try {
      await detailsFormRef.value?.validate()
    } catch {
      return
    }
  } else if (step.value === 1 && !photoValid.value) {
    message.error(t('dsc.portraitHint'))
    return
  }
  if (step.value < LAST_STEP) step.value += 1
}

function prevStep(): void {
  if (step.value > 0) step.value -= 1
}

function generateCan(): void {
  canDigits.value = randomCan().split('')
}

function addPerson(): void {
  people.value.push({ name: '', telephone: '', address: '', dateRecorded: '' })
}

/** Copies the one-time reference to the clipboard. */
async function copyReference(): Promise<void> {
  if (!reference.value) return
  try {
    await navigator.clipboard.writeText(reference.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 2000)
  } catch {
    message.error(t('errors.generic'))
  }
}

async function submit(): Promise<void> {
  if (!portrait.value) {
    message.error(t('dsc.portraitHint'))
    step.value = 1
    return
  }
  try {
    await detailsFormRef.value?.validate()
  } catch {
    step.value = 0
    return
  }
  submitting.value = true
  try {
    const body: Record<string, unknown> = {
      mrz,
      dg2: {
        jpeg: portrait.value.jpegBase64,
        width: portrait.value.width,
        height: portrait.value.height,
      },
    }
    if (can.value) body.can = can.value
    if (dg3.value) body.dg3 = { bytes: dg3.value.base64 }
    if (dg4.value) body.dg4 = { bytes: dg4.value.base64 }
    if (dg5.value) body.dg5 = { jpeg: dg5.value.base64 }
    if (dg7.value) body.dg7 = { jpeg: dg7.value.base64 }
    if (fullName.value || placeOfBirth.value || address.value || telephone.value) {
      body.dg11 = {
        fullName: fullName.value || undefined,
        placeOfBirth: placeOfBirth.value || undefined,
        address: address.value || undefined,
        telephone: telephone.value || undefined,
      }
    }
    if (customNotes.value) body.dg13 = { text: customNotes.value }
    if (people.value.length) body.dg16 = { persons: people.value }
    if (email.value) body.email = email.value
    if (notes.value) body.notes = notes.value

    const result = await api<{ reference: string }>('/dsc/requests', { method: 'POST', body })
    reference.value = result.reference
    notify.success(t('common.submitted'), result.reference)
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
    const runtime = await loadPkdConfig()
    mrz.issuingState = runtime.countryAlpha3
    mrz.nationality = runtime.countryAlpha3
  } catch {
    // Keep the shared country default when the public config is unavailable.
  }
  await loadActivePassport()
  if (!signedIn.value) return
  try {
    jurisdiction.value = await api<Jurisdiction>('/dsc/jurisdiction')
  } catch {
    jurisdiction.value = null
  }
})
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('dsc.applyTitle')"
      :breadcrumbs="[{ label: $t('nav.dsc'), to: '/dsc' }, { label: $t('nav.apply') }]"
    />
    <NCard>
      <ExpiryAlert
        v-if="lifecycle && !lifecycle.canIssueDocuments"
        :title="$t('dsc.signingPaused')"
        :description="niaDscExpiryText"
      />
      <NResult
        v-if="reference"
        status="success"
        :title="$t('dsc.submittedTitle')"
        :description="$t('dsc.submittedHint')"
      >
        <NSpace vertical align="center" :size="8">
          <NText code class="epass42-mono" data-testid="reference">{{ reference }}</NText>
          <NButton size="small" @click="copyReference">
            <template #icon
              ><NIcon><Copy /></NIcon
            ></template>
            {{ copied ? $t('common.copied') : $t('common.copy') }}
          </NButton>
        </NSpace>
        <template #footer>
          <NuxtLink :to="`/dsc/requests/${reference}`">
            <NButton type="primary">{{ $t('dsc.viewDetails') }}</NButton>
          </NuxtLink>
        </template>
      </NResult>

      <!-- Submitting requires a signed-in applicant. -->
      <template v-else-if="!signedIn">
        <NResult status="info" :title="$t('auth.signInTo', { realm: 'DSC' })">
          <template #footer>
            <NButton type="primary" @click="loginToApply">
              <template #icon
                ><NIcon><LogIn /></NIcon
              ></template>
              {{ $t('common.login') }}
            </NButton>
          </template>
        </NResult>
      </template>

      <template v-else>
        <!-- Re-issuance: warn that a new request supersedes the active passport. -->
        <NAlert
          v-if="activePassport"
          type="warning"
          :title="$t('dsc.activePassportTitle')"
          style="margin-bottom: 12px"
        >
          <div>{{ $t('dsc.activePassportHint') }}</div>
          <NDescriptions :column="2" size="small" style="margin-top: 8px">
            <NDescriptionsItem :label="$t('dsc.passportDocumentNumber')">
              {{ activePassport.documentNumber }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.requestReference')">
              <NText class="epass42-mono">{{ activePassport.reference }}</NText>
            </NDescriptionsItem>
          </NDescriptions>
          <div class="epass42-actions" style="margin-top: 8px">
            <NuxtLink :to="`/dsc/requests/${activePassport.reference}`">
              <NButton size="small">{{ $t('dsc.viewDetails') }}</NButton>
            </NuxtLink>
            <NButton size="small" @click="revokeOpen = true">
              {{ $t('dsc.revokePassport') }}
            </NButton>
          </div>
        </NAlert>

        <NSteps :current="step + 1" size="small" style="margin-bottom: 16px">
          <NStep :title="$t('dsc.stepDetails')" />
          <NStep :title="$t('dsc.stepPhoto')" />
          <NStep :title="$t('dsc.stepExtra')" />
          <NStep :title="$t('dsc.stepReview')" />
        </NSteps>

        <!-- Step 1: document details. -->
        <template v-if="step === 0">
          <NAlert type="info" style="margin-bottom: 12px">{{ $t('dsc.applyIntro') }}</NAlert>
          <NAlert
            v-if="jurisdiction?.notice && !noticeDismissed"
            type="warning"
            :title="$t('dsc.jurisdictionTitle')"
          >
            <div>{{ $t('dsc.jurisdictionBody', { mnt: jurisdiction.mnts.join(', ') }) }}</div>
            <a
              v-if="jurisdiction.ownDscUrl"
              :href="jurisdiction.ownDscUrl"
              target="_blank"
              rel="noopener"
              >{{ jurisdiction.ownDscUrl
              }}<span class="epass42-sr-only"> ({{ $t('common.opensInNewTab') }})</span></a
            >
            <div style="margin-top: 8px">
              <NButton size="small" @click="noticeDismissed = true">{{
                $t('common.confirm')
              }}</NButton>
            </div>
          </NAlert>

          <NForm ref="detailsFormRef" :model="mrz" :rules="detailsRules" label-placement="top">
            <div class="epass42-grid">
              <NFormItem :label="$t('dsc.documentation')">
                <NSelect v-model:value="mrz.documentCode" :options="documentTypeOptions" />
              </NFormItem>
              <NFormItem path="documentNumber" :label="$t('dsc.documentNumber')" required>
                <NInput v-model:value="mrz.documentNumber" maxlength="9" />
              </NFormItem>
              <NFormItem path="surname" :label="$t('dsc.surname')" required>
                <NInput v-model:value="mrz.surname" :maxlength="nameMaxLength" />
              </NFormItem>
              <NFormItem :label="$t('dsc.givenNames')">
                <NInput v-model:value="mrz.givenNames" :maxlength="nameMaxLength" />
              </NFormItem>
              <NFormItem path="dateOfBirth" required>
                <template #label>
                  <FieldLabel :label="$t('dsc.dateOfBirth')" :hint="$t('dsc.dateOfBirthHint')" />
                </template>
                <DateField v-model="mrz.dateOfBirth" />
              </NFormItem>
              <NFormItem :label="$t('dsc.sex')">
                <NSelect v-model:value="mrz.sex" :options="sexOptions" />
              </NFormItem>
            </div>
          </NForm>
        </template>

        <!-- Step 2: photo. -->
        <template v-else-if="step === 1">
          <NText depth="3">{{ $t('dsc.photoHint') }}</NText>
          <NFormItem :label="$t('dsc.photoSection')" required style="margin-top: 12px">
            <PortraitEditor v-model="portrait" />
          </NFormItem>
          <EmrtdPreview
            :mrz="previewMrz"
            :document-type="documentTypeLabel(mrz.documentCode, t)"
            :portrait-data-url="portrait?.previewDataUrl ?? null"
            style="margin-top: 12px"
          />
        </template>

        <!-- Step 3: additional information. -->
        <template v-else-if="step === 2">
          <NCollapse>
            <NCollapseItem :title="$t('dsc.canSection')" name="can">
              <NForm label-placement="top">
                <NFormItem :label="$t('dsc.can')">
                  <NSpace align="center" :size="8">
                    <NInputOtp
                      v-model:value="canDigits"
                      :length="6"
                      :status="canValid ? undefined : 'error'"
                      :allow-input="(value: string) => /^\d$/.test(value)"
                    />
                    <NButton @click="generateCan">
                      <template #icon
                        ><NIcon><Dices /></NIcon
                      ></template>
                      {{ $t('dsc.canGenerate') }}
                    </NButton>
                  </NSpace>
                </NFormItem>
                <NText depth="3" style="font-size: 12px">{{ $t('dsc.canHint') }}</NText>
              </NForm>
            </NCollapseItem>
            <NCollapseItem :title="$t('dsc.contactSection')" name="contact">
              <NForm label-placement="top">
                <NFormItem :label="$t('dsc.fullName')"
                  ><NInput v-model:value="fullName" maxlength="70"
                /></NFormItem>
                <NFormItem :label="$t('dsc.placeOfBirth')"
                  ><NInput v-model:value="placeOfBirth" maxlength="35"
                /></NFormItem>
                <NFormItem :label="$t('dsc.address')"
                  ><NInput v-model:value="address" maxlength="70"
                /></NFormItem>
                <NFormItem :label="$t('dsc.telephone')"
                  ><NInput v-model:value="telephone" maxlength="35"
                /></NFormItem>
              </NForm>
            </NCollapseItem>
            <NCollapseItem :title="$t('dsc.notesSection')" name="notes13">
              <NInput v-model:value="customNotes" type="textarea" maxlength="2048" />
            </NCollapseItem>
            <NCollapseItem :title="$t('dsc.notifySection')" name="notify">
              <div v-for="(person, index) in people" :key="index" class="epass42-grid">
                <NInput v-model:value="person.name" :placeholder="$t('dsc.fullName')" />
                <NInput v-model:value="person.telephone" :placeholder="$t('dsc.telephone')" />
                <NInput v-model:value="person.address" :placeholder="$t('dsc.address')" />
                <DateField v-model="person.dateRecorded" :digits="8" />
              </div>
              <NButton size="small" style="margin-top: 8px" @click="addPerson">{{
                $t('dsc.addPerson')
              }}</NButton>
            </NCollapseItem>
            <NCollapseItem :title="$t('dsc.imagesSection')" name="images">
              <NSpace>
                <FileField v-model="dg5" accept="image/*" :label="$t('dsc.displayPhoto')" />
                <FileField
                  v-model="dg7"
                  accept="image/*"
                  :label="$t('dsc.signatureImageOptional')"
                />
              </NSpace>
              <NSpace style="margin-top: 8px">
                <FileField v-model="dg3" accept=".bin,*" :label="$t('dsc.fingerprints')" />
                <FileField v-model="dg4" accept=".bin,*" :label="$t('dsc.iris')" />
              </NSpace>
            </NCollapseItem>
          </NCollapse>

          <NDivider />
          <NForm label-placement="top">
            <NFormItem :label="$t('dsc.email')"><NInput v-model:value="email" /></NFormItem>
            <NFormItem :label="$t('dsc.notes')"
              ><NInput v-model:value="notes" type="textarea"
            /></NFormItem>
          </NForm>
        </template>

        <!-- Step 4: review and submit. -->
        <template v-else>
          <NAlert
            v-if="jurisdiction && !jurisdiction.notice && jurisdiction.reviewers.length"
            type="info"
            :title="$t('dsc.reviewersTitle')"
            style="margin-bottom: 12px"
          >
            {{ $t('dsc.reviewersBody', { mnts: jurisdiction.reviewers.join(', ') }) }}
          </NAlert>
          <NText depth="3">{{ $t('dsc.reviewSummary') }}</NText>
          <NDescriptions :column="2" size="small" style="margin-top: 12px">
            <NDescriptionsItem :label="$t('dsc.documentation')">
              {{ documentTypeLabel(mrz.documentCode, t) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.documentNumber')">
              {{ mrz.documentNumber }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.surname')">{{ mrz.surname }}</NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.givenNames')">{{
              mrz.givenNames
            }}</NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.dateOfBirth')">{{
              mrz.dateOfBirth
            }}</NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.sex')">{{ sexDisplay }}</NDescriptionsItem>
            <NDescriptionsItem :label="$t('dsc.email')">{{ email || '—' }}</NDescriptionsItem>
          </NDescriptions>
          <img
            v-if="portrait"
            :src="portrait.previewDataUrl"
            alt=""
            style="max-width: 100px; margin-top: 12px"
          />
        </template>
      </template>

      <template #action>
        <NSpace v-if="signedIn && !reference" justify="space-between" style="width: 100%">
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
              :disabled="lifecycle?.canIssueDocuments === false"
              @click="submit"
            >
              <template #icon
                ><NIcon><Send /></NIcon
              ></template>
              {{ $t('common.submit') }}
            </NButton>
          </div>
        </NSpace>
      </template>
    </NCard>

    <NModal
      v-model:show="revokeOpen"
      preset="card"
      :title="$t('dsc.revokePassport')"
      style="max-width: 480px"
    >
      <NText depth="3">{{ $t('dsc.revokePassportConfirm') }}</NText>
      <NFormItem :label="$t('dsc.revokeReason')" style="margin-top: 12px">
        <NInput v-model:value="revokeReason" type="textarea" :rows="3" />
      </NFormItem>
      <template #footer>
        <NSpace justify="end">
          <NButton quaternary @click="revokeOpen = false">{{ $t('common.cancel') }}</NButton>
          <NButton type="error" :loading="revoking" @click="revokePassport">
            {{ $t('common.confirm') }}
          </NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
