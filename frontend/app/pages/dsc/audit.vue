<script setup lang="ts">
definePageMeta({ layout: 'realm' })
</script>

<template>
  <div class="epass42-page">
    <PageHeader
      :title="$t('audit.title')"
      :breadcrumbs="[{ label: $t('nav.dsc'), to: '/dsc' }, { label: $t('audit.title') }]"
    />
    <AuditLog realm="dsc" />
  </div>
</template>
