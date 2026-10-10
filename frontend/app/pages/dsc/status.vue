<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NButton, NCard, NInput, NSpace, NText, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'

const route = useRoute()
const { t } = useI18n()
const message = useMessage()

const reference = ref(String(route.query.reference ?? ''))

const canLookup = computed(() => reference.value.trim().length >= 8)

function lookup(): void {
  if (!canLookup.value) {
    message.error(t('errors.validation_failed'))
    return
  }
  void navigateTo(`/dsc/requests/${reference.value.trim()}`)
}

onMounted(() => {
  // A deep link that still carries `?reference=` jumps straight to the detail.
  if (route.query.reference) lookup()
})
</script>

<template>
  <div class="epass42-page">
    <NCard :title="$t('dsc.statusTitle')">
      <NText depth="3">{{ $t('dsc.statusIntro') }}</NText>
      <NSpace vertical size="small" style="margin-top: 12px">
        <NInput
          v-model:value="reference"
          :placeholder="$t('dsc.referencePlaceholder')"
          @keyup.enter="lookup"
        />
        <NText depth="3" style="font-size: 12px">{{ $t('dsc.referenceHint') }}</NText>
        <NButton type="primary" :disabled="!canLookup" @click="lookup">
          {{ $t('dsc.query') }}
        </NButton>
      </NSpace>
    </NCard>
  </div>
</template>
