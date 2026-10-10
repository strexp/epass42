<script setup lang="ts">
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  NNotificationProvider,
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
      <NNotificationProvider placement="bottom-right" :max="3">
        <NDialogProvider>
          <NuxtLayout>
            <NuxtPage />
          </NuxtLayout>
        </NDialogProvider>
      </NNotificationProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>
