<script setup lang="ts">
definePageMeta({ layout: 'realm' })

const { t } = useI18n()
usePageTitle(() => t('audit.title'))
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('audit.title')"
      :breadcrumbs="[{ label: $t('nav.ml'), to: '/ml' }, { label: $t('audit.title') }]"
    />
    <AuditLog realm="ml" />
  </div>
</template>
