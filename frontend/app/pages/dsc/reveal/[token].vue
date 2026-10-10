<script setup lang="ts">
definePageMeta({ layout: 'realm' })

import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NTag,
  useMessage,
} from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { errorMessageKey } from '~/composables/useApi'

const route = useRoute()
const api = useApi()
const { t } = useI18n()
const message = useMessage()
const metadata = ref<Record<string, unknown> | null>(null)
const consumed = computed(() => Boolean(metadata.value?.consumedAt))
const reference = computed(() => (metadata.value?.reference as string | undefined) ?? '')

onMounted(async () => {
  try {
    metadata.value = await api(`/dsc/reveal/${route.params.token}`, { method: 'POST' })
  } catch (error) {
    message.error(t(errorMessageKey(error)))
  }
})
</script>

<template>
  <div class="epass42-page">
    <NCard :title="$t('dsc.statusTitle')">
      <NAlert
        v-if="!consumed"
        type="warning"
        :title="$t('dsc.revealWarningTitle')"
        style="margin-bottom: 12px"
      >
        {{ $t('dsc.revealWarning') }}
      </NAlert>
      <NDescriptions v-if="metadata" :column="2" size="small">
        <NDescriptionsItem :label="$t('dsc.statusTitle')">
          <NTag size="small">{{ metadata.status }}</NTag>
        </NDescriptionsItem>
        <NDescriptionsItem :label="$t('dsc.submittedAt')">
          {{ metadata.createdAt }}
        </NDescriptionsItem>
      </NDescriptions>
      <NuxtLink v-if="reference" :to="`/dsc/requests/${reference}`" style="margin-top: 12px">
        <NButton size="small">{{ $t('dsc.viewDetails') }}</NButton>
      </NuxtLink>
    </NCard>
  </div>
</template>
