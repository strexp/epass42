<script setup lang="ts">
import { NFormItem, NSwitch } from 'naive-ui'
import type { SecurityOptions } from '@epass42/shared'

const model = defineModel<SecurityOptions>({ required: true })

/** LDS2 applications always carry Chip Authentication, so it cannot be turned
 * off while any LDS2 application is emitted. */
defineProps<{ caDisabled?: boolean }>()
</script>

<template>
  <div class="epass42-grid">
    <NFormItem label="PACE ECDH-GM 3DES">
      <NSwitch v-model:value="model.paceEcdhGm3des" />
    </NFormItem>
    <NFormItem label="PACE ECDH-GM AES-128">
      <NSwitch v-model:value="model.paceEcdhGmAes128" />
    </NFormItem>
    <NFormItem label="Active Authentication">
      <NSwitch v-model:value="model.aa" />
    </NFormItem>
    <NFormItem label="Chip Authentication">
      <NSwitch v-model:value="model.ca" :disabled="caDisabled" />
    </NFormItem>
  </div>
</template>
