<script setup lang="ts">
/**
 * DataSourceTree —— 数据源字段树（《设计方案》§19.4.3a 第五节）
 *
 * 金蝶式树形：数据源 → 子表 → 分组/字段。
 * 字段可拖绑（占位），支持搜索过滤、手动刷新。
 */
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NSelect, NSpace, NTooltip, NSpin } from 'naive-ui'
import { useDataSourceStore } from '@/design/stores/dataSource'

const store = useDataSourceStore()
const keyword = ref('')

const sourceOptions = computed(() =>
  store.sources.map((s) => ({ label: s.name, value: s.id })),
)

const filteredGroups = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return store.fieldTree
  return store.fieldTree
    .map((t) => ({
      table: t.table,
      fields: t.fields.filter(
        (f) => f.label.toLowerCase().includes(kw) || f.path.toLowerCase().includes(kw),
      ),
    }))
    .filter((t) => t.fields.length > 0)
})

onMounted(() => {
  void store.init()
})

const typeColor = (type: string): string => {
  switch (type) {
    case 'number':
      return 'text-blue-500'
    case 'date':
      return 'text-green-500'
    case 'image':
      return 'text-purple-500'
    default:
      return 'text-brand-text-3'
  }
}

const typeLabel = (type: string): string => {
  switch (type) {
    case 'number':
      return 'N'
    case 'date':
      return 'D'
    case 'boolean':
      return 'B'
    case 'image':
      return 'I'
    default:
      return 'S'
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="border-b border-brand-border px-3 py-2">
      <div class="text-12px text-brand-text-3">数据源</div>
      <NSelect
        size="small"
        :value="store.activeSourceId"
        :options="sourceOptions"
        @update:value="store.selectSource($event)"
      />
    </div>

    <div class="flex items-center gap-1 p-2">
      <NInput v-model:value="keyword" size="small" placeholder="搜索字段" clearable />
      <NTooltip>
        <template #trigger>
          <NButton size="small" quaternary @click="store.refreshFields()">
            <div class="i-carbon-renew text-14px" />
          </NButton>
        </template>
        刷新字段
      </NTooltip>
    </div>

    <NSpin :show="store.loading" class="flex-1">
      <div class="overflow-y-auto p-2 pt-0">
        <div v-for="group in filteredGroups" :key="group.table.id" class="mb-3">
          <div class="mb-1 flex items-center gap-1 text-11px font-medium text-brand-text-3">
            <div class="i-carbon-data-table text-12px" />
            {{ group.table.name }}
            <span v-if="group.table.isArray" class="text-brand-primary">[]</span>
          </div>
          <div
            v-for="field in group.fields"
            :key="field.path"
            class="field-item group"
            draggable="true"
            @dragstart="(e: DragEvent) => {
              e.dataTransfer?.setData('application/x-openprint-binding', field.path)
            }"
          >
            <span class="flex-1 truncate text-12px">
              {{ field.label }}
              <span v-if="field.custom" class="ml-1 inline-block rounded bg-blue-50 px-1 text-9px text-blue-500">
                自定义
              </span>
            </span>
            <span class="text-9px" :class="typeColor(field.type)">
              {{ typeLabel(field.type) }}
            </span>
            <span class="ml-1 truncate text-9px text-brand-text-3">{{ field.path }}</span>
          </div>
        </div>
        <div v-if="filteredGroups.length === 0" class="py-4 text-center text-12px text-brand-text-3">
          暂无字段
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.field-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  cursor: grab;
  transition: background 0.15s;
}
.field-item:hover {
  background: color-mix(in srgb, var(--brand-primary) 6%, transparent);
}
</style>
