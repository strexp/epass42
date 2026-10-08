<script setup lang="ts">
import { NFormItem, NInputNumber, NSwitch } from 'naive-ui'
import type { SecurityOptions } from '@pkd42/shared'

const model = defineModel<SecurityOptions>({ required: true })
</script>

<template>
  <div class="pkd42-grid">
    <NFormItem label="PACE ECDH-GM 3DES">
      <NSwitch v-model:value="model.paceEcdhGm3des" />
    </NFormItem>
    <NFormItem label="PACE ECDH-GM AES-128">
      <NSwitch v-model:value="model.paceEcdhGmAes128" />
    </NFormItem>
    <NFormItem label="CA ECDH 3DES">
      <NSwitch v-model:value="model.caEcdh3des" />
    </NFormItem>
    <NFormItem label="CA ECDH AES-128">
      <NSwitch v-model:value="model.caEcdhAes128" />
    </NFormItem>
    <NFormItem label="CA key id">
      <NInputNumber v-model:value="model.caKeyId" :min="0" :max="255" />
    </NFormItem>
    <NFormItem label="Active Authentication">
      <NSwitch v-model:value="model.aa" />
    </NFormItem>
  </div>
</template>
