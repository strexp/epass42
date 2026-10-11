<template>
  <div class="epass42-shell">
    <a class="epass42-skip-link" href="#epass42-main">{{ $t('common.skipToContent') }}</a>
    <AppHeader />
    <main id="epass42-main" class="epass42-main" tabindex="-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
