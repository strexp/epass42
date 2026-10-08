<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import { NAlert, NCard, NDescriptions, NDescriptionsItem, NTag, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'

const route = useRoute()
const api = useApi()
const { t } = useI18n()
const message = useMessage()
const metadata = ref<Record<string, unknown> | null>(null)

onMounted(async () => {
  try {
    metadata.value = await api(`/dsc/reveal/${route.params.token}`, { method: 'POST' })
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
})
</script>

<template>
  <div class="pkd42-page">
    <NCard :title="$t('dsc.statusTitle')">
      <NAlert type="warning" :title="$t('dsc.revealWarning')" style="margin-bottom: 12px" />
      <NDescriptions v-if="metadata" :column="2" size="small">
        <NDescriptionsItem label="Status">
          <NTag size="small">{{ metadata.status }}</NTag>
        </NDescriptionsItem>
        <NDescriptionsItem label="Delivery">{{ metadata.deliveryMode }}</NDescriptionsItem>
      </NDescriptions>
      <NuxtLink to="/dsc/status" style="display: inline-block; margin-top: 12px">
        {{ $t('dsc.statusTitle') }}
      </NuxtLink>
    </NCard>
  </div>
</template>
