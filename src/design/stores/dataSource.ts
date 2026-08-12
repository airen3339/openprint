/**
 * dataSource store —— 字段缓存 + 手动刷新（§19.4.3a 第六节）
 *
 * 设计器加载时拉一次字段并缓存（TTL 10 分钟），用户可手动刷新。
 * 未注入真实 DataSourceRepository 时自动回退到 createMockDataSource（开箱即用）。
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { DataSourceRepository, DataSourceMeta, FieldDef, TableMeta } from '@/types/datasource'
import { createMockDataSource } from '@/repository/mock/mock-datasource'

const CACHE_TTL = 10 * 60 * 1000 // 10 分钟

interface CacheEntry {
  fields: FieldDef[]
  fetchedAt: number
}

export const useDataSourceStore = defineStore('dataSource', () => {
  const _repo = shallowRef<DataSourceRepository>(createMockDataSource())
  const sources = ref<DataSourceMeta[]>([])
  const activeSourceId = ref<string>('sale_order') // 当前选中数据源
  const fieldCache = ref<Map<string, CacheEntry>>(new Map())
  const loading = ref(false)

  const activeSource = computed(() => sources.value.find((s) => s.id === activeSourceId.value) ?? null)
  const activeFields = computed(() => fieldCache.value.get(activeSourceId.value)?.fields ?? [])
  /** 按 tableId+group 分组后的树形字段（DataSourceTree 渲染用） */
  const fieldTree = computed(() => {
    const fields = activeFields.value.filter((f) => !f.hidden)
    const tables = activeSource.value?.tables ?? []
    const byTable: Record<string, FieldDef[]> = {}
    for (const t of tables) byTable[t.id] = []
    for (const f of fields) {
      const tid = f.tableId ?? ''
      ;(byTable[tid] ??= []).push(f)
    }
    return tables.map((t) => ({
      table: t,
      fields: (byTable[t.id] ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)),
    }))
  })

  /** 扁平字段列表（供 BindingEditor 下拉） */
  const flatFields = computed(() =>
    activeFields.value
      .filter((f) => !f.hidden)
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  )

  /* ---------- 操作 ---------- */

  /** 注入后端仓库（Phase 6：createDataSourceHttp）；不传则保持 Mock */
  function setRepository(repo: DataSourceRepository): void {
    _repo.value = repo
    fieldCache.value.clear()
  }

  async function fetchSources(): Promise<void> {
    sources.value = await _repo.value.listSources()
    if (!sources.value.find((s) => s.id === activeSourceId.value)) {
      activeSourceId.value = sources.value[0]?.id ?? ''
    }
  }

  async function fetchFields(forceRefresh = false): Promise<void> {
    const id = activeSourceId.value
    if (!id) return
    const cached = fieldCache.value.get(id)
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL
    if (fresh && !forceRefresh) return

    loading.value = true
    try {
      const fields = await _repo.value.getFields(id)
      fieldCache.value.set(id, { fields, fetchedAt: Date.now() })
    } finally {
      loading.value = false
    }
  }

  /** 初始化：拉数据源列表 + 默认源字段（canvas 挂载时调用） */
  async function init(): Promise<void> {
    await fetchSources()
    await fetchFields()
  }

  /** 用户手动刷新 */
  async function refreshFields(): Promise<void> {
    await fetchFields(true)
  }

  function selectSource(id: string): void {
    activeSourceId.value = id
    void fetchFields()
  }

  return {
    sources,
    activeSourceId,
    activeSource,
    activeFields,
    fieldTree,
    flatFields,
    loading,
    setRepository,
    init,
    fetchSources,
    fetchFields,
    refreshFields,
    selectSource,
  }
})
