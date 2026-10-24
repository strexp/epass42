<script setup lang="ts">
import { NText } from 'naive-ui'
import { computed } from 'vue'

/**
 * Certificate validity cell shared by the CSCA/CVCA/ML/PKD tables.  X.509
 * signers also show their PrivateKeyUsagePeriod, so the certificate and key
 * expiry cannot be confused.
 */
const props = defineProps<{
  notBefore?: string | null
  notAfter: string | null
  privateKeyNotAfter?: string | null
}>()

const { formatDate } = useDateTime()
const certificate = computed(() => `${formatDate(props.notBefore)} → ${formatDate(props.notAfter)}`)
const certificateExpired = computed(
  () => props.notAfter !== null && Date.parse(props.notAfter) <= Date.now(),
)
const privateKeyExpired = computed(
  () =>
    props.privateKeyNotAfter !== null &&
    props.privateKeyNotAfter !== undefined &&
    Date.parse(props.privateKeyNotAfter) <= Date.now(),
)
</script>

<template>
  <div class="epass42-validity">
    <div>
      <NText :type="certificateExpired ? 'error' : undefined">{{ certificate }}</NText>
    </div>
    <div v-if="privateKeyNotAfter">
      <NText :type="privateKeyExpired ? 'error' : undefined" class="epass42-validity-key">
        {{ $t('common.privateKeyValidity') }}: {{ formatDate(privateKeyNotAfter) }}
      </NText>
    </div>
  </div>
</template>
