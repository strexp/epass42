<script setup lang="ts">
import { NCard, NGi, NGrid, NText } from 'naive-ui'
</script>

<template>
  <div class="pkd42-page">
    <h1>{{ $t('app.name') }}</h1>
    <NText depth="2">{{ $t('home.intro') }}</NText>
    <NGrid :cols="3" :x-gap="16" :y-gap="16" style="margin-top: 16px">
      <NGi>
        <NuxtLink to="/csca" style="text-decoration: none">
          <NCard :title="$t('nav.csca')" hoverable>
            <NText depth="2">{{ $t('home.cscaCard') }}</NText>
          </NCard>
        </NuxtLink>
      </NGi>
      <NGi>
        <NuxtLink to="/dsc" style="text-decoration: none">
          <NCard :title="$t('nav.dsc')" hoverable>
            <NText depth="2">{{ $t('home.dscCard') }}</NText>
          </NCard>
        </NuxtLink>
      </NGi>
      <NGi>
        <NuxtLink to="/pkd" style="text-decoration: none">
          <NCard :title="$t('nav.pkd')" hoverable>
            <NText depth="2">{{ $t('home.pkdCard') }}</NText>
          </NCard>
        </NuxtLink>
      </NGi>
    </NGrid>
  </div>
</template>
