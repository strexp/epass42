<script setup lang="ts">
definePageMeta({ layout: 'realm' })
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('audit.title')"
      :breadcrumbs="[{ label: $t('nav.csca'), to: '/csca' }, { label: $t('audit.title') }]"
    />
    <AuditLog realm="csca" />
  </div>
</template>
