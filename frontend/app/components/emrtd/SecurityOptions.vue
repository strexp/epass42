<script setup lang="ts">
import { NCheckbox, NFormItem, NInputNumber, NSelect, NSpace, NSwitch, NTag, NText } from 'naive-ui'
import { computed, watch } from 'vue'
import type { SecurityOptions } from '@epass42/shared'

const model = defineModel<SecurityOptions>({ required: true })
const props = withDefaults(defineProps<{ lds2Enabled?: boolean }>(), { lds2Enabled: false })
const { t } = useI18n()

/** PACE is mandatory when Chip Authentication or any LDS2 application is on. */
const paceRequired = computed(() => model.value.ca.enabled || props.lds2Enabled)
const paceEnabled = computed(() => model.value.pace.ecdhGm3des || model.value.pace.ecdhGmAes128)

// Keep PACE on whenever it becomes mandatory (e.g. CA enabled, LDS2 enabled).
watch(
  paceRequired,
  (required) => {
    if (required && !paceEnabled.value) model.value.pace.ecdhGm3des = true
  },
  { immediate: true },
)

// An emitted LDS2 application always carries Chip Authentication.
watch(
  () => props.lds2Enabled,
  (enabled) => {
    if (enabled) model.value.ca.enabled = true
  },
  { immediate: true },
)

function togglePace(value: boolean): void {
  if (value) {
    if (!paceEnabled.value) model.value.pace.ecdhGm3des = true
  } else {
    model.value.pace.ecdhGm3des = false
    model.value.pace.ecdhGmAes128 = false
  }
}

/** A profile may not be deselected if it is the last one while PACE is required. */
function paceProfileDisabled(profile: 'ecdhGm3des' | 'ecdhGmAes128'): boolean {
  if (!paceEnabled.value) return true
  if (!paceRequired.value) return false
  const other = profile === 'ecdhGm3des' ? 'ecdhGmAes128' : 'ecdhGm3des'
  return model.value.pace[profile] && !model.value.pace[other]
}

const aaAlgorithmOptions = computed(() => [
  { label: t('dsc.securityAaSha1'), value: 'rsaSha1' },
  {
    label: `${t('dsc.securityAaSha256')} (${t('dsc.securityPlanned')})`,
    value: 'rsaSha256',
    disabled: true,
  },
])
const caAlgorithmOptions = computed(() => [
  { label: t('dsc.securityCaEcdh3des'), value: 'ecdh3des' },
  {
    label: `${t('dsc.securityCaEcdhAes128')} (${t('dsc.securityPlanned')})`,
    value: 'ecdhAes128',
    disabled: true,
  },
])

function setAaAlgorithm(value: string): void {
  model.value.aa.algorithm = value as SecurityOptions['aa']['algorithm']
}
function setCaAlgorithm(value: string): void {
  model.value.ca.algorithm = value as SecurityOptions['ca']['algorithm']
}
</script>

<template>
  <div class="epass42-security">
    <!-- LDS1 -->
    <div class="epass42-security__column">
      <NText strong>{{ $t('dsc.securityLds1') }}</NText>

      <NFormItem :label="$t('dsc.securityBac')">
        <NSpace align="center" :size="8">
          <NSwitch :value="true" disabled />
          <NTag size="small" :bordered="false">{{ $t('dsc.securityRequired') }}</NTag>
        </NSpace>
      </NFormItem>

      <NFormItem :label="$t('dsc.securityPace')">
        <NSpace vertical :size="6">
          <NSpace align="center" :size="8">
            <NSwitch :value="paceEnabled" :disabled="paceRequired" @update:value="togglePace" />
            <NTag v-if="paceRequired" size="small" :bordered="false">
              {{ $t('dsc.securityRequired') }}
            </NTag>
          </NSpace>
          <NCheckbox
            v-model:checked="model.pace.ecdhGm3des"
            :disabled="paceProfileDisabled('ecdhGm3des')"
          >
            {{ $t('dsc.securityPace3des') }}
          </NCheckbox>
          <NCheckbox
            v-model:checked="model.pace.ecdhGmAes128"
            :disabled="paceProfileDisabled('ecdhGmAes128')"
          >
            {{ $t('dsc.securityPaceAes128') }}
          </NCheckbox>
        </NSpace>
      </NFormItem>

      <NFormItem :label="$t('dsc.securityAa')">
        <NSpace vertical :size="6">
          <NSwitch v-model:value="model.aa.enabled" />
          <NSelect
            :value="model.aa.algorithm"
            :options="aaAlgorithmOptions"
            :disabled="!model.aa.enabled"
            size="small"
            @update:value="setAaAlgorithm"
          />
        </NSpace>
      </NFormItem>

      <NFormItem :label="$t('dsc.securityCa')">
        <NSpace vertical :size="6">
          <NSpace align="center" :size="8">
            <NSwitch v-model:value="model.ca.enabled" :disabled="lds2Enabled" />
            <NTag v-if="lds2Enabled" size="small" :bordered="false">
              {{ $t('dsc.securityRequired') }}
            </NTag>
          </NSpace>
          <NSelect
            :value="model.ca.algorithm"
            :options="caAlgorithmOptions"
            :disabled="!model.ca.enabled"
            size="small"
            @update:value="setCaAlgorithm"
          />
          <NInputNumber
            v-model:value="model.ca.keyId"
            :min="0"
            :max="255"
            :disabled="!model.ca.enabled"
            size="small"
          >
            <template #prefix>{{ $t('dsc.caKeyId') }}</template>
          </NInputNumber>
        </NSpace>
      </NFormItem>
    </div>

    <!-- LDS2 (only when enabled); both mechanisms are shared with LDS1. -->
    <div v-if="lds2Enabled" class="epass42-security__column">
      <NText strong>{{ $t('dsc.securityLds2') }}</NText>
      <NText depth="3" style="font-size: 12px">{{ $t('dsc.securityLds2Mirror') }}</NText>

      <NFormItem :label="$t('dsc.securityPace')">
        <NSpace vertical :size="6">
          <NSpace align="center" :size="8">
            <NSwitch :value="true" disabled />
            <NTag size="small" :bordered="false">{{ $t('dsc.securityRequired') }}</NTag>
          </NSpace>
          <NCheckbox :checked="model.pace.ecdhGm3des" disabled>
            {{ $t('dsc.securityPace3des') }}
          </NCheckbox>
          <NCheckbox :checked="model.pace.ecdhGmAes128" disabled>
            {{ $t('dsc.securityPaceAes128') }}
          </NCheckbox>
        </NSpace>
      </NFormItem>

      <NFormItem :label="$t('dsc.securityCa')">
        <NSpace vertical :size="6">
          <NSpace align="center" :size="8">
            <NSwitch :value="true" disabled />
            <NTag size="small" :bordered="false">{{ $t('dsc.securityRequired') }}</NTag>
          </NSpace>
          <NSelect
            :value="model.ca.algorithm"
            :options="caAlgorithmOptions"
            disabled
            size="small"
          />
          <NInputNumber :value="model.ca.keyId" disabled size="small">
            <template #prefix>{{ $t('dsc.caKeyId') }}</template>
          </NInputNumber>
        </NSpace>
      </NFormItem>
    </div>
  </div>
</template>

<style scoped>
.epass42-security {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.epass42-security__column {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
