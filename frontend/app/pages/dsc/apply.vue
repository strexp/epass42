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
  NModal,
  NResult,
  NSelect,
  NSpace,
  NText,
  useMessage,
} from 'naive-ui'
import { Send, Dices, LogIn } from '@lucide/vue'
import { computed, onMounted, reactive, ref } from 'vue'
import type { MrzFields } from '@epass42/shared'
import { COUNTRY_ALPHA3 } from '@epass42/shared'
import type { EncodedFile } from '~/components/common/FileField.vue'
import type { EncodedPortrait } from '~/components/emrtd/PortraitEditor.vue'
import { errorMessageKey } from '~/composables/useApi'
import { useRealm } from '~/composables/useRealm'
import { canIsValid, normaliseCan, randomCan } from '~/utils/can'

definePageMeta({ layout: 'realm' })

const api = useApi()
const { t } = useI18n()
const message = useMessage()
const notify = useNotify()
const { auth, state, ensureLoaded } = useRealm('dsc')

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
/** Optional PACE Card Access Number (six digits). */
const can = ref('')
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

const sexOptions = computed(() => [
  { label: t('dsc.sexFemale'), value: 'F' },
  { label: t('dsc.sexMale'), value: 'M' },
  { label: t('dsc.sexUnspecified'), value: '<' },
])
const documentTypeOptions = [
  { label: 'Passport', value: 'P' },
  { label: 'Identity card', value: 'ID' },
]

interface Jurisdiction {
  mnts: string[]
  useNiaDsc: boolean | null
  notice: boolean
  ownDscUrl: string | null
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
    message.success(t('common.success'))
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

/** A CAN is six digits when provided; an empty value means "use the MRZ". */
const canValid = computed(() => canIsValid(can.value))

const canSubmit = computed(
  () => mrz.surname !== '' && mrz.documentNumber !== '' && mrz.dateOfBirth !== '' && canValid.value,
)

function setCan(value: string): void {
  can.value = normaliseCan(value)
}

function generateCan(): void {
  can.value = randomCan()
}

function addPerson(): void {
  people.value.push({ name: '', telephone: '', address: '', dateRecorded: '' })
}

async function submit(): Promise<void> {
  if (!portrait.value) {
    message.error(t('dsc.portraitHint'))
    return
  }
  if (!canSubmit.value) {
    message.error(t('errors.validation_failed'))
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
    notify.success(t('common.success'), result.reference)
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await ensureLoaded()
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
      <NCard v-if="reference" size="small" :title="$t('dsc.statusTitle')">
        <NText class="epass42-mono" data-testid="reference">{{ reference }}</NText>
        <template #action>
          <NuxtLink :to="`/dsc/requests/${reference}`">
            <NButton size="small">{{ $t('dsc.viewDetails') }}</NButton>
          </NuxtLink>
        </template>
      </NCard>

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

      <!-- Re-issuance: warn that a new request supersedes the active passport. -->
      <template v-else>
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

        <NText depth="3">{{ $t('dsc.submitHint') }}</NText>
        <NAlert type="info" style="margin-top: 8px">{{ $t('dsc.applyIntro') }}</NAlert>

        <NAlert
          v-if="jurisdiction?.notice && !noticeDismissed"
          type="warning"
          :title="$t('dsc.jurisdictionTitle')"
          style="margin-top: 12px"
        >
          <div>{{ $t('dsc.jurisdictionBody', { mnt: jurisdiction.mnts.join(', ') }) }}</div>
          <a
            v-if="jurisdiction.ownDscUrl"
            :href="jurisdiction.ownDscUrl"
            target="_blank"
            rel="noopener"
            >{{ jurisdiction.ownDscUrl }}</a
          >
          <div style="margin-top: 8px">
            <NButton size="small" @click="noticeDismissed = true">{{
              $t('common.confirm')
            }}</NButton>
          </div>
        </NAlert>

        <NDivider>{{ $t('dsc.personalDetails') }}</NDivider>
        <NForm label-placement="top">
          <div class="epass42-grid">
            <NFormItem :label="$t('dsc.documentation')">
              <NSelect v-model:value="mrz.documentCode" :options="documentTypeOptions" />
            </NFormItem>
            <NFormItem :label="$t('dsc.documentNumber')">
              <NInput v-model:value="mrz.documentNumber" maxlength="9" />
            </NFormItem>
            <NFormItem :label="$t('dsc.surname')">
              <NInput v-model:value="mrz.surname" maxlength="39" />
            </NFormItem>
            <NFormItem :label="$t('dsc.givenNames')">
              <NInput v-model:value="mrz.givenNames" maxlength="39" />
            </NFormItem>
            <NFormItem :label="$t('dsc.dateOfBirth')">
              <NInput v-model:value="mrz.dateOfBirth" maxlength="6" placeholder="900101" />
              <NText depth="3" style="font-size: 12px">{{ $t('dsc.dateOfBirthHint') }}</NText>
            </NFormItem>
            <NFormItem :label="$t('dsc.sex')">
              <NSelect v-model:value="mrz.sex" :options="sexOptions" />
            </NFormItem>
          </div>
        </NForm>

        <NDivider>{{ $t('dsc.photoSection') }}</NDivider>
        <PortraitEditor v-model="portrait" />
        <EmrtdPreview
          :mrz="previewMrz"
          :portrait-data-url="portrait?.previewDataUrl ?? null"
          style="margin-top: 12px"
        />

        <NDivider>{{ $t('dsc.optionalInfo') }}</NDivider>
        <NCollapse>
          <NCollapseItem :title="$t('dsc.canSection')" name="can">
            <NForm label-placement="top">
              <NFormItem :label="$t('dsc.can')">
                <NSpace align="center" :size="8">
                  <NInput
                    :value="can"
                    maxlength="6"
                    :placeholder="$t('dsc.canPlaceholder')"
                    :status="canValid ? undefined : 'error'"
                    style="max-width: 160px"
                    @update:value="setCan"
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
              <NInput v-model:value="person.name" placeholder="Name" />
              <NInput v-model:value="person.telephone" placeholder="Telephone" />
              <NInput v-model:value="person.address" placeholder="Address" />
              <NInput v-model:value="person.dateRecorded" placeholder="CCYYMMDD" />
            </div>
            <NButton size="small" style="margin-top: 8px" @click="addPerson">{{
              $t('dsc.addPerson')
            }}</NButton>
          </NCollapseItem>
          <NCollapseItem :title="$t('dsc.imagesSection')" name="images">
            <NSpace>
              <FileField v-model="dg5" accept="image/*" :label="$t('dsc.displayPhoto')" />
              <FileField v-model="dg7" accept="image/*" :label="$t('dsc.signatureImageOptional')" />
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

      <template #action>
        <NButton
          v-if="signedIn && !reference"
          type="primary"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          <template #icon
            ><NIcon><Send /></NIcon
          ></template>
          {{ $t('common.submit') }}
        </NButton>
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
