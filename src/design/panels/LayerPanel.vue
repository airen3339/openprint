<script setup lang="ts">
/**
 * LayerPanel —— 图层面板：展示画布控件列表（z-order，可选中/删除）
 */
import { computed } from 'vue'
import { NButton, NScrollbar } from 'naive-ui'
import { useDesignerStore } from '@/design/stores/designer'
import { CONTROL_TYPE_LABEL } from '@/design/canvas/controls'

const store = useDesignerStore()

/** 按画布 z-order 排列（body + zones + zone children） */
const layers = computed(() => {
  // 从 designer 对象获取实际顺序（Fabric objects 有固有 z-index）
  const objs = store.designer?.getPrintObjects() ?? []
  const ids = objs.map((o) => o.controlId)
  const all: Array<{ id: string; type: string; name: string }> = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const c = store.controls.find((x) => x.id === id) ??
      store.zones.find((x) => x.id === id || x.children.some((ch) => ch.id === id))
    let entry: { id: string; type: string; name: string } | undefined
    if (store.zones.find((x) => x.id === id)) {
      const z = store.zones.find((x) => x.id === id)!
      entry = { id: z.id, type: 'zone', name: z.zone === 'header' ? '页眉区域' : '页脚区域' }
    } else if (store.controls.find((x) => x.id === id)) {
      const c = store.controls.find((x) => x.id === id)!
      entry = { id: c.id, type: c.type, name: c.name ?? CONTROL_TYPE_LABEL[c.type] ?? c.type }
    } else {
      // zone child
      for (const z of store.zones) {
        const child = z.children.find((ch) => ch.id === id)
        if (child) {
          entry = { id: child.id, type: child.type, name: child.name ?? (CONTROL_TYPE_LABEL[child.type] ?? child.type) }
          break
        }
      }
    }
    if (entry) all.push(entry)
  }
  return all
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b border-brand-border px-3 py-2 text-12px text-brand-text-3">
      图层（{{ layers.length }} 项）
    </div>
    <NScrollbar class="flex-1 min-h-0">
      <div class="p-1">
        <div
          v-for="layer in layers"
          :key="layer.id"
          class="layer-item group"
          :class="{ selected: store.selectedIds.includes(layer.id) }"
          @click="store.selectControl(layer.id)"
        >
          <span class="truncate text-12px">{{ layer.name }}</span>
          <NButton
            text
            size="tiny"
            class="opacity-0 group-hover:opacity-100"
            @click.stop="store.removeControl(layer.id)"
          >
            <div class="i-carbon-close text-12px text-brand-text-3" />
          </NButton>
        </div>
      </div>
    </NScrollbar>
  </div>
</template>

<style scoped>
.layer-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--brand-text-2);
  transition: background 0.15s;
}
.layer-item:hover,
.layer-item.selected {
  background: color-mix(in srgb, var(--brand-primary) 8%, transparent);
  color: var(--brand-primary);
}
</style>
