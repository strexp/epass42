<script setup lang="ts">
import { NButton, NCard, NText } from 'naive-ui'

const { t } = useI18n()
usePageTitle(() => t('legal.privacy.title'))

/** The sections of the privacy notice, in reading order. */
const sections = [
  'controller',
  'data',
  'purpose',
  'sharing',
  'security',
  'retention',
  'rights',
  'changes',
] as const
</script>

<template>
  <div class="epass42-page">
    <PageHeader :title="$t('legal.privacy.title')" />
    <NCard>
      <NText depth="3">{{ $t('legal.updated') }}</NText>
      <LegalDoc ns="legal.privacy" :sections="sections" />
      <NuxtLink to="/retention">
        <NButton text type="primary" style="margin-top: 16px">
          {{ $t('legal.retention.title') }}
        </NButton>
      </NuxtLink>
    </NCard>
  </div>
</template>
