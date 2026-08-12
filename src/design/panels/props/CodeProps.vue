<script setup lang="ts">
/**
 * CodeProps —— 条码 / 二维码控件属性（§5.7）
 */
import { computed } from 'vue'
import { NInput, NSelect, NSwitch } from 'naive-ui'
import type { BarcodeControl, QrcodeControl } from '@/types/control'
import { useDesignerStore } from '@/design/stores/designer'
import BindingEditor from './BindingEditor.vue'

const store = useDesignerStore()
const control = computed(() => store.selectedControl as BarcodeControl | QrcodeControl | null)
const isBarcode = computed(() => control.value?.type === 'barcode')

function patch(p: Record<string, unknown>): void {
  if (control.value) store.updateControl(control.value.id, p)
}

const contentMode = computed({
  get: () => (control.value?.binding ? 'binding' : 'static'),
  set: (m: string) => {
    if (m === 'binding') patch({ binding: 'order.orderNo', value: undefined })
    else patch({ binding: undefined, value: control.value?.value ?? '0123456789' })
  },
})

const barcodeFormats = [
  { label: 'CODE128', value: 'CODE128' },
  { label: 'EAN-13', value: 'EAN13' },
  { label: 'EAN-8', value: 'EAN8' },
  { label: 'CODE39', value: 'CODE39' },
  { label: 'ITF-14', value: 'ITF14' },
  { label: 'UPC-A', value: 'UPCA' },
]
</script>

<template>
  <div v-if="control" class="props-section">
    <div class="props-title">{{ isBarcode ? '条码设置' : '二维码设置' }}</div>

    <div class="props-row">
      <span class="props-label">内容</span>
      <NSelect
        v-model:value="contentMode"
        size="small"
        :options="[
          { label: '静态内容', value: 'static' },
          { label: '绑定字段', value: 'binding' },
        ]"
      />
    </div>

    <div v-if="contentMode === 'static'" class="props-row">
      <NInput
        size="small"
        :value="control.value ?? ''"
        placeholder="编码内容"
        @update:value="patch({ value: $event || undefined })"
      />
    </div>
    <div v-else class="props-row">
      <BindingEditor :value="control.binding" @update:value="patch({ binding: $event })" />
    </div>

    <template v-if="isBarcode">
      <div class="props-row">
        <span class="props-label">格式</span>
        <NSelect
          size="small"
          :value="(control as BarcodeControl).format ?? 'CODE128'"
          :options="barcodeFormats"
          @update:value="patch({ format: $event })"
        />
      </div>
      <div class="props-row">
        <span class="props-label">显示文字</span>
        <NSwitch
          size="small"
          :value="(control as BarcodeControl).showText ?? true"
          @update:value="patch({ showText: $event })"
        />
      </div>
    </template>

    <div v-else class="props-row">
      <span class="props-label">纠错级</span>
      <NSelect
        size="small"
        :value="(control as QrcodeControl).errorLevel ?? 'M'"
        :options="[
          { label: 'L（7%）', value: 'L' },
          { label: 'M（15%）', value: 'M' },
          { label: 'Q（25%）', value: 'Q' },
          { label: 'H（30%）', value: 'H' },
        ]"
        @update:value="patch({ errorLevel: $event })"
      />
    </div>
  </div>
</template>
