<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  darkTheme,
  dateEnUS,
  enUS,
  lightTheme,
} from 'naive-ui'

const colorMode = useColorMode()
const theme = computed(() => (colorMode.value === 'dark' ? darkTheme : lightTheme))
</script>

<template>
  <NConfigProvider :theme="theme" :locale="enUS" :date-locale="dateEnUS">
    <NGlobalStyle />
    <NMessageProvider>
      <NDialogProvider>
        <NuxtLayout>
          <NuxtPage />
        </NuxtLayout>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
