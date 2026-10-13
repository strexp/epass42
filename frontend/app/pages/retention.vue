<script setup lang="ts">
import { NCard, NText } from 'naive-ui'

const { t } = useI18n()
usePageTitle(() => t('legal.retention.title'))

/** The sections of the retention and deletion policy, in reading order. */
const sections = [
  'principle',
  'personalization',
  'keys',
  'requests',
  'pki',
  'audit',
  'account',
  'deletion',
] as const
</script>

<template>
  <div class="epass42-page">
    <PageHeader :title="$t('legal.retention.title')" />
    <NCard>
      <NText depth="3">{{ $t('legal.updated') }}</NText>
      <LegalDoc ns="legal.retention" :sections="sections" />
      <LegalLinks current="retention" />
    </NCard>
  </div>
</template>
