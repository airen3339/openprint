<script setup lang="ts">
/**
 * LeftPanel —— 左栏容器：组件库 / 数据源树 / 批量数据 / 图层
 */
import { NTabs, NTabPane } from 'naive-ui'
import ControlLibrary from './ControlLibrary.vue'
import DataSourceTree from './DataSourceTree.vue'
import LayerPanel from './LayerPanel.vue'
import { useUiStore } from '@/design/stores/ui'

const ui = useUiStore()
</script>

<template>
  <div class="flex h-full flex-col bg-brand-surface">
    <div class="flex items-center justify-between border-b border-brand-border px-3 py-2">
      <span class="text-13px font-medium">组件库</span>
    </div>
    <NTabs v-model:value="ui.leftTab" type="segment" size="small" class="flex-1 px-2" animated>
      <NTabPane name="components" tab="组件">
        <ControlLibrary />
      </NTabPane>
      <NTabPane name="datasource" tab="数据源">
        <DataSourceTree />
      </NTabPane>
      <NTabPane name="layers" tab="图层">
        <LayerPanel />
      </NTabPane>
    </NTabs>
  </div>
</template>
