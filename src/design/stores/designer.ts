/**
 * designer store —— 当前模板 / 选中控件 / 画布状态（《实施指南》Phase 4 先行版）
 *
 * 数据流：
 * - 画布交互（拖拽/缩放手柄）→ CanvasDesigner 事件 → 更新本 store 的模型
 * - 属性面板编辑 → 本 store 更新模型 → 同步回 CanvasDesigner
 * - 模型坐标单位 = mm（协议层），画布层 px 换算由 CanvasDesigner 负责
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  AnyControl,
  ControlType,
  RectControl,
  TableColumn,
  TableControl,
  ZoneControl,
} from '@/types/control'
import type { GridConfig, PageSetup, TemplateData, WatermarkConfig } from '@/types/template'
import { CanvasDesigner, type ViewportState } from '@/design/canvas/CanvasDesigner'
import { createLocalRepository } from '@/repository/local-repo'
import type { TemplateRepository } from '@/repository/types'
import { assertTemplate } from '@/core/spec/validator'
import { genId } from '@/utils/id'
import { useHistoryStore } from './history'
import { type ImportColumn } from '@/design/utils/data-import'
import { seedSummaryTail } from '@/core/layout-engine/table-cells'

/** 水印默认配置（开启后居中单个、45°、浅灰） */
export const DEFAULT_WATERMARK: WatermarkConfig = {
  enabled: false,
  text: 'OpenPrint',
  color: '#cccccc',
  fontSize: 16,
  rotation: 45,
  tile: false,
}

/** A4 纵向默认页面（§5.13 预设只活在 UI，协议存精确数字） */
const DEFAULT_PAGE: PageSetup = {
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  backgroundColor: '#ffffff',
  watermark: { ...DEFAULT_WATERMARK },
}

/** 画布网格默认配置（运行时视图状态，辅助设计，不持久化） */
const DEFAULT_GRID: GridConfig = { visible: false, sizeMm: 5, color: '#78829180' }

export const useDesignerStore = defineStore('designer', () => {
  /* ------------------------------- 状态 ------------------------------- */
  const templateName = ref('销售出库单模板')
  const pageSetup = ref<PageSetup>({ ...DEFAULT_PAGE })
  /** body 区控件模型（zone 子控件在 zones[].children 内） */
  const controls = ref<AnyControl[]>([])
  const zones = ref<ZoneControl[]>([])
  const selectedIds = ref<string[]>([])
  const dirty = ref(false)
  const lastSavedAt = ref<string | null>(null)

  /** 手动分页下限：物理页数至少为 N（0 = 完全由内容推导；随模板持久化） */
  const minPages = ref(0)
  /** 当前有效物理页数（由画布推导后同步，右侧页面面板展示/导航用） */
  const pageCount = ref(1)
  /** 当前查看的页码（0 起，页码导航 chips 高亮用） */
  const activePage = ref(0)

  /** 画布内核（非响应式，避免深度代理 Fabric 对象） */
  const designer = shallowRef<CanvasDesigner | null>(null)
  const viewport = ref<ViewportState>({ zoom: 1, offsetX: 0, offsetY: 0 })

  /**
   * 模板仓库：未配置后端时默认 localStorage（主任 2026-08-08 定：
   * 一切编辑纯本地，仅手动保存才持久化；后端 http-repo 经 setRepository 注入）。
   */
  const repository = shallowRef<TemplateRepository>(createLocalRepository())
  /** 当前模板在仓库中的 id（未保存过 = null） */
  const currentTemplateId = ref<string | null>(null)
  /** 持久化模式：local=本地存储 / cloud=云端（顶栏徽标 + 保存提示用） */
  const backendMode = ref<'local' | 'cloud'>('local')
  /** 画布网格配置（运行时视图状态，辅助设计，不持久化） */
  const gridConfig = ref<GridConfig>({ ...DEFAULT_GRID })

  /**
   * 当前正在双击编辑的单元格（方案 A：HTML overlay 原生 contenteditable 编辑）。
   * 为 null 时表示无编辑。
   */
  const editingCell = ref<{ controlId: string; row: number; col: number } | null>(null)
  /** 画布变换版本号：Fabric 对象移动/缩放/旋转或视口变化时自增，驱动 overlay 重算定位 */
  const canvasTick = ref(0)

  function openCellEditor(controlId: string, row: number, col: number): void {
    editingCell.value = { controlId, row, col }
  }
  function closeCellEditor(): void {
    editingCell.value = null
  }
  function bumpCanvasTick(): void {
    canvasTick.value++
  }

  /* ------------------------------ computed ----------------------------- */
  const selectedControl = computed<AnyControl | null>(() => {
    const id = selectedIds.value[0]
    if (!id) return null
    return findControl(id) ?? null
  })

  const saveStateText = computed(() =>
    dirty.value ? '未保存' : lastSavedAt.value ? `已保存 ${lastSavedAt.value}` : '已保存',
  )

  /* ------------------------------- 查找 -------------------------------- */

  function findControl(id: string): AnyControl | undefined {
    const inBody = controls.value.find((c) => c.id === id)
    if (inBody) return inBody
    for (const z of zones.value) {
      if (z.id === id) return z
      const child = z.children.find((c) => c.id === id)
      if (child) return child
    }
    return undefined
  }

  function replaceControl(updated: AnyControl): void {
    const i = controls.value.findIndex((c) => c.id === updated.id)
    if (i >= 0) {
      controls.value[i] = updated
      return
    }
    for (const z of zones.value) {
      if (z.id === updated.id && updated.type === 'zone') {
        const zi = zones.value.findIndex((x) => x.id === z.id)
        zones.value[zi] = updated as ZoneControl
        return
      }
      const ci = z.children.findIndex((c) => c.id === updated.id)
      if (ci >= 0) {
        z.children[ci] = updated
        return
      }
    }
  }

  /* ----------------------------- 画布挂载 ------------------------------ */

  function attachCanvas(el: HTMLCanvasElement, container: HTMLElement): void {
    const d = new CanvasDesigner()
    d.init(el, container, {
      onSelectionChange: (ids) => {
        selectedIds.value = ids
        // 选中切走 → 退出单元格编辑，避免 overlay 抢走画布指针
        if (editingCell.value && !ids.includes(editingCell.value.controlId)) closeCellEditor()
      },
      onObjectModified: (newControl) => {
        const old = findControl(newControl.id)
        replaceControl(newControl)
        if (old) {
          const history = useHistoryStore()
          history.push({
            undo: () => {
              replaceControl(old)
              designer.value?.updateControl(old)
            },
            redo: () => {
              replaceControl(newControl)
              designer.value?.updateControl(newControl)
            },
            description: `移动/缩放 ${newControl.type}`,
          })
        }
        dirty.value = true
      },
      onViewportChange: (vp) => {
        viewport.value = vp
      },
      onTransformTick: () => {
        canvasTick.value++
      },
      onPageCountChange: (count) => {
        pageCount.value = count
        if (activePage.value >= count) activePage.value = Math.max(0, count - 1)
      },
      onCellEdit: (info) => {
        // 物化 cells 网格（旧模板首次编辑时自动迁移）：派生数据，不入撤销栈、不标脏
        updateControlSilent(info.controlId, info.control as AnyControl)
        openCellEditor(info.controlId, info.row, info.col)
      },
    })
    d.setPage(pageSetup.value)
    designer.value = d
    viewport.value = d.getViewportState()
    pageCount.value = d.effectivePageCount
    d.setPageBackground(pageSetup.value.backgroundColor ?? '#ffffff')
    d.setWatermark(pageSetup.value.watermark)
  }

  function detachCanvas(): void {
    designer.value?.dispose()
    designer.value = null
  }

  /* ----------------------------- 控件操作 ------------------------------ */

  /** 从控件库拖入：在给定位置（相对内容区 mm）创建控件；init 允许控件库注入额外初始属性（如圆形 shape） */
  function addControlOfType(
    type: ControlType,
    at: { leftMm: number; topMm: number },
    init?: Partial<AnyControl>,
    zoneHostId?: string,
  ): void {
    const base = createDefaultControl(type, at)
    if (!base) return
    const control = init ? ({ ...base, ...init } as AnyControl) : base
    // 圆形默认正圆：确保外接框为正方形（宽=高），避免默认矩形尺寸导致椭圆
    if (control.type === 'rect' && (control as RectControl).shape === 'circle') {
      const r = control as RectControl
      if (r.width !== r.height) {
        const size = Math.max(r.width, r.height)
        r.width = size
        r.height = size
      }
    }
    if (control.type === 'zone') {
      // 拖入页眉/页脚区域控件本身
      if (zones.value.some((z) => z.zone === control.zone)) {
        selectControl(zones.value.find((z) => z.zone === control.zone)!.id)
        return
      }
      zones.value.push(control)
      designer.value?.addControl(control)
    } else if (zoneHostId) {
      // 拖入页眉/页脚区域内的子控件
      const host = zones.value.find((z) => z.id === zoneHostId)
      if (host) {
        host.children.push(control)
        designer.value?.addControl(control, { zoneHostId })
      } else {
        // zone 已不存在，降级到 body
        controls.value.push(control)
        designer.value?.addControl(control)
      }
    } else {
      controls.value.push(control)
      designer.value?.addControl(control)
    }
    // 撤销 = 删除此控件
    const history = useHistoryStore()
    const createdId = control.id
    const hostId = zoneHostId
    history.push({
      undo: () => removeControl(createdId),
      redo: () => {
        const c = findControl(createdId) ?? control
        if (!findControl(createdId)) {
          if (c.type === 'zone') zones.value.push(c as ZoneControl)
          else if (hostId) {
            const host = zones.value.find((z) => z.id === hostId)
            host?.children.push(c)
          } else controls.value.push(c)
        }
        designer.value?.addControl(c, { zoneHostId: hostId })
      },
      description: `添加 ${control.type}`,
    })
    dirty.value = true
  }

  /**
   * 导入数据 → 在画布生成一张「内嵌数据表格」。
   *
   * 表格以 `control.data` 携带解析后的记录行（与 dataSource 字段绑定彻底解耦），
   * 渲染期由引擎自动分页（flow table）。表格按内容区宽度自适应居中、表头重复、整表边框。
   * 行/列的去留与标题改名已在导入弹窗中确定，这里只负责落地成控件。
   */
  function importTable(payload: {
    columns: ImportColumn[]
    records: Array<Record<string, unknown>>
    sourceName?: string
  }): void {
    const ps = pageSetup.value
    const m = ps.margin
    const contentWidth = Math.max(40, Math.round((ps.width - m.left - m.right) * 10) / 10)
    const left = Math.round(m.left * 10) / 10
    const top = Math.round(m.top * 10) / 10
    const n = Math.max(1, payload.columns.length)
    const colWidth = Math.round((contentWidth / n) * 10) / 10

    const id = genId()
    const columns: TableColumn[] = payload.columns.map((c) => ({
      title: c.title || c.key,
      // 内嵌数据行经 resolveRows 落入 ctx.row，列 field 用 items[]. 前缀即可逐行取值
      field: `items[].${c.key}`,
      width: colWidth,
      headerAlign: 'center',
    }))
    const control: TableControl = {
      id,
      type: 'table',
      left,
      top,
      width: contentWidth,
      height: 60,
      printable: true,
      columns,
      headerRows: 1,
      data: payload.records,
      options: {
        repeatHeader: true,
        repeatFooter: true,
        pageRows: 'auto',
        borders: 'all',
        verticalAlign: 'middle',
        // 默认单元格居中（与初始化表格一致）
        defaultCellStyle: { align: 'center' },
      },
    }

    // 植入「本页合计 / 总计 / 大写金额」尾行：按首行采样推断数值列，金额取最后一个数值列
    const sample = payload.records[0] ?? {}
    const numericColumns = payload.columns
      .map((c, i) => (typeof sample[c.key] === 'number' ? i : -1))
      .filter((i) => i >= 0)
    const moneyColumn =
      numericColumns.find((i) => /金额|总额|合计|钱|amt|total|amount|price|sum/i.test(payload.columns[i]!.key)) ??
      numericColumns[numericColumns.length - 1]
    const tableControl = seedSummaryTail(control, { numericColumns, moneyColumn })
    controls.value.push(tableControl)
    designer.value?.addControl(tableControl)
    const history = useHistoryStore()
    history.push({
      undo: () => removeControl(id),
      redo: () => {
        if (!findControl(id)) {
          controls.value.push(tableControl)
          designer.value?.addControl(tableControl)
        }
      },
      description: `导入数据表（${payload.sourceName ?? '数据'}）`,
    })
    dirty.value = true
    selectControl(id)
  }

  /** 插入页眉/页脚区域控件（§5.14：单例，重复点击聚焦已有色带） */
  function addZone(zone: 'header' | 'footer'): void {
    const existing = zones.value.find((z) => z.zone === zone)
    if (existing) {
      selectControl(existing.id)
      return
    }
    const control: ZoneControl = {
      id: genId('zone'),
      type: 'zone',
      zone,
      left: 0,
      top: 0,
      width: pageSetup.value.width,
      height: zone === 'header' ? 20 : 14,
      zoneHeight: zone === 'header' ? 20 : 14,
      repeat: true,
      printable: true,
      children: [],
    }
    zones.value.push(control)
    designer.value?.addControl(control)
    // 撤销 = 删除 zone
    const history = useHistoryStore()
    const zoneId = control.id
    history.push({
      undo: () => removeControl(zoneId),
      redo: () => {
        if (!zones.value.some((z) => z.id === zoneId)) zones.value.push(control)
        designer.value?.addControl(control)
      },
      description: `添加${zone === 'header' ? '页眉' : '页脚'}`,
    })
    dirty.value = true
  }

  /** 属性面板编辑：更新模型并同步画布 */
  function updateControl(id: string, patch: Partial<AnyControl>): void {
    const current = findControl(id)
    if (!current) return
    const old = JSON.parse(JSON.stringify(current)) as AnyControl // 深拷贝旧状态
    const merged = { ...current, ...patch, id: current.id, type: current.type } as AnyControl
    replaceControl(merged)
    designer.value?.updateControl(merged)
    const history = useHistoryStore()
    history.push({
      undo: () => {
        replaceControl(old)
        designer.value?.updateControl(old)
        if (selectedIds.value.includes(id)) selectedIds.value = [id]
      },
      redo: () => {
        replaceControl(merged)
        designer.value?.updateControl(merged)
      },
      description: `编辑 ${current.type}`,
    })
    dirty.value = true
  }

  /**
   * 静默更新：只同步模型与画布，**不入撤销栈、不标脏**。
   * 仅用于派生数据物化（如首次双击表格时把列配置展开成 cells 网格），
   * 用户可感知的编辑一律走 updateControl。
   */
  function updateControlSilent(id: string, patch: Partial<AnyControl>): void {
    const current = findControl(id)
    if (!current) return
    const merged = { ...current, ...patch, id: current.id, type: current.type } as AnyControl
    replaceControl(merged)
    designer.value?.updateControl(merged)
  }

  function removeControl(id: string): void {
    const current = findControl(id)
    if (!current) return
    if (editingCell.value?.controlId === id) closeCellEditor()
    const old = JSON.parse(JSON.stringify(current)) as AnyControl
    let zoneHostId: string | undefined
    const i = controls.value.findIndex((c) => c.id === id)
    if (i >= 0) controls.value.splice(i, 1)
    else {
      for (const z of zones.value) {
        const ci = z.children.findIndex((c) => c.id === id)
        if (ci >= 0) { zoneHostId = z.id; z.children.splice(ci, 1); break }
      }
      const zi = zones.value.findIndex((z) => z.id === id)
      if (zi >= 0) zones.value.splice(zi, 1)
    }
    designer.value?.removeControl(id)
    if (selectedIds.value.includes(id)) selectedIds.value = []
    const history = useHistoryStore()
    // 撤销 = 重新添加（含 zone 宿主归属）
    const hostId = zoneHostId
    history.push({
      undo: () => {
        if (old.type === 'zone') zones.value.push(old as ZoneControl)
        else controls.value.push(old)
        designer.value?.addControl(old, { zoneHostId: hostId })
      },
      redo: () => {
        const idx = controls.value.findIndex((c) => c.id === id)
        if (idx >= 0) controls.value.splice(idx, 1)
        designer.value?.removeControl(id)
      },
      description: `删除 ${current.type}`,
    })
    dirty.value = true
  }

  function selectControl(id: string | null): void {
    selectedIds.value = id ? [id] : []
    designer.value?.setActiveControl(id)
  }

  /* ----------------------------- 保存/加载 ----------------------------- */

  /** 从画布序列化出完整 template.json（协议结构） */
  function buildTemplate(): TemplateData<AnyControl> {
    const synced = designer.value?.serialize()
    if (synced) {
      controls.value = synced.body
      zones.value = synced.zones
    }
    const sections: TemplateData<AnyControl>['document']['sections'] = []
    const header = zones.value.find((z) => z.zone === 'header')
    const footer = zones.value.find((z) => z.zone === 'footer')
    if (header) {
      sections.push({
        type: 'header',
        height: header.zoneHeight,
        repeat: header.repeat ?? true,
        components: header.children,
      })
    }
    sections.push({ type: 'body', components: controls.value })
    if (footer) {
      sections.push({
        type: 'footer',
        height: footer.zoneHeight,
        repeat: footer.repeat ?? true,
        components: footer.children,
      })
    }
    return {
      version: '1.0',
      document: {
        type: 'report',
        page: { ...pageSetup.value, minPages: minPages.value || undefined },
        sections,
      },
    }
  }

  function markSaved(): void {
    dirty.value = false
    lastSavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  /** 注入后端仓库（Phase 6：createHttpRepository）；mode 标记持久化模式（默认 cloud） */
  function setRepository(repo: TemplateRepository, mode: 'local' | 'cloud' = 'cloud'): void {
    repository.value = repo
    backendMode.value = mode
  }

  /** 设置画布网格（开关 / 间距）。仅运行时视图状态，应用到 SmartGuides；不标记 dirty、不持久化 */
  function setGrid(patch: Partial<GridConfig>): void {
    const next = { ...gridConfig.value, ...patch }
    if (next.sizeMm <= 0) next.sizeMm = DEFAULT_GRID.sizeMm
    gridConfig.value = next
    const d = designer.value
    if (d) {
      d.setGridVisible(next.visible)
      d.setGridSize(next.sizeMm)
      d.setGridColor(next.color)
    }
  }

  /**
   * 应用页面装饰（背景色 + 水印）到画布，并标记 dirty（随模板持久化）。
   * 右栏「页面外观」各组控件改完即调此方法即时预览。
   */
  function applyPageDecoration(): void {
    const d = designer.value
    if (d) {
      d.setPageBackground(pageSetup.value.backgroundColor ?? '#ffffff')
      d.setWatermark(pageSetup.value.watermark)
    }
    dirty.value = true
  }

  /* ----------------------------- 手动分页 ----------------------------- */

  /** 设置手动分页下限（floor，最小 0）并同步画布 */
  function setMinPages(n: number): void {
    const v = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0) || 0)
    minPages.value = v
    designer.value?.setManualPageCount(v)
  }

  /** 加一页：物理页数 +1（minPages = max(内容推导, 当前下限) + 1） */
  function addPage(): void {
    const d = designer.value
    const content = d?.contentPageCount ?? 1
    setMinPages(Math.max(minPages.value, content) + 1)
  }

  /** 减一页：手动下限 -1（内容推导页数仍会兜底，不会少于内容所需页数） */
  function removePage(): void {
    setMinPages(Math.max(0, minPages.value - 1))
  }

  /** 跳转到第 index 页（0 起）：滚动画布视口并把页码高亮 */
  function goToPage(index: number): void {
    const i = Math.max(0, Math.min(index, pageCount.value - 1))
    activePage.value = i
    designer.value?.scrollToPage(i)
  }

  /** 新建空白模板：清空画布与模型，currentTemplateId 归零（保存时走 create） */
  function newBlankTemplate(): void {
    closeCellEditor()
    currentTemplateId.value = null
    templateName.value = '未命名模板'
    pageSetup.value = { ...DEFAULT_PAGE }
    gridConfig.value = { ...DEFAULT_GRID }
    controls.value = []
    zones.value = []
    selectedIds.value = []
    minPages.value = 0
    pageCount.value = 1
    activePage.value = 0
    designer.value?.clearControls()
    designer.value?.setGridVisible(false)
    designer.value?.setGridSize(DEFAULT_GRID.sizeMm)
    designer.value?.setGridColor(DEFAULT_GRID.color)
    designer.value?.setPage(pageSetup.value)
    designer.value?.setManualPageCount(0)
    designer.value?.setPageBackground(pageSetup.value.backgroundColor ?? '#ffffff')
    designer.value?.setWatermark(pageSetup.value.watermark)
    useHistoryStore().clear()
    dirty.value = false
    lastSavedAt.value = null
  }

  /** 另存为：以新名称创建一份新模板（不清空当前画布，仅复制持久化） */
  async function saveTemplateAs(name: string): Promise<{ ok: boolean; error?: string }> {
    templateName.value = name
    currentTemplateId.value = null
    return saveTemplate()
  }

  /**
   * 手动保存：序列化 → 协议校验 → 写入仓库（唯一会触发持久化的入口）。
   * 已保存过 = update，首次 = create。
   */
  async function saveTemplate(): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!templateName.value.trim()) templateName.value = '未命名模板'
      const template = buildTemplate()
      assertTemplate(template)
      if (currentTemplateId.value) {
        await repository.value.update(currentTemplateId.value, {
          name: templateName.value,
          data: template,
        })
      } else {
        const record = await repository.value.create({
          name: templateName.value,
          editable: true,
          deletable: true,
          data: template,
        })
        currentTemplateId.value = record.id
      }
      markSaved()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 加载模板到画布（启动恢复 / 打开模板共用） */
  function loadTemplate(record: { id: string; name: string; data: TemplateData<AnyControl> }): void {
    const d = designer.value
    if (!d) return
    assertTemplate(record.data)
    closeCellEditor()
    const doc = record.data.document

    currentTemplateId.value = record.id
    templateName.value = record.name
    // 保留默认背景/水印，旧模板缺字段时自动回退
    pageSetup.value = {
      ...DEFAULT_PAGE,
      ...doc.page,
      backgroundColor: doc.page.backgroundColor ?? DEFAULT_PAGE.backgroundColor,
      watermark: doc.page.watermark ?? { ...DEFAULT_WATERMARK },
    }
    minPages.value = doc.page.minPages ?? 0
    d.setPage(doc.page)
    d.setManualPageCount(minPages.value)
    d.setPageBackground(pageSetup.value.backgroundColor ?? '#ffffff')
    d.setWatermark(pageSetup.value.watermark)
    d.clearControls()
    pageCount.value = d.effectivePageCount
    activePage.value = 0

    zones.value = []
    controls.value = []

    // 先建 zone（子控件需要宿主坐标）
    for (const section of doc.sections) {
      if (section.type === 'header' || section.type === 'footer') {
        const zone: ZoneControl = {
          id: genId('zone'),
          type: 'zone',
          zone: section.type,
          left: 0,
          top: 0,
          width: doc.page.width,
          height: section.height ?? 20,
          zoneHeight: section.height ?? 20,
          repeat: section.repeat ?? true,
          printable: true,
          children: [],
        }
        zones.value.push(zone)
        d.addControl(zone, { select: false })
      }
    }
    // 再装 body 与 zone 子控件
    for (const section of doc.sections) {
      if (section.type === 'body') {
        for (const c of section.components) {
          const control = { ...c, id: c.id || genId() }
          controls.value.push(control)
          d.addControl(control, { select: false })
        }
      } else {
        const host = zones.value.find((z) => z.zone === section.type)
        for (const c of section.components) {
          const control = { ...c, id: c.id || genId() }
          host?.children.push(control)
          d.addControl(control, { select: false, zoneHostId: host?.id })
        }
      }
    }
    dirty.value = false
    selectedIds.value = []
    useHistoryStore().clear()
  }
  async function restoreLastTemplate(): Promise<boolean> {
    try {
      const list = await repository.value.list()
      const latest = [...list].sort((a, b) =>
        (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
      )[0]
      if (!latest) return false
      const record = await repository.value.get(latest.id)
      if (!record) return false
      loadTemplate(record)
      markSaved()
      return true
    } catch {
      return false
    }
  }

  /* ------------------------------ 缩放代理 ------------------------------ */

  function setZoom(z: number): void {
    designer.value?.setZoom(z)
  }

  function fitCanvas(): void {
    const container = document.querySelector<HTMLElement>('.canvas-stage')
    if (container) designer.value?.fitToContainer(container)
  }

  return {
    templateName,
    pageSetup,
    controls,
    zones,
    selectedIds,
    selectedControl,
    dirty,
    lastSavedAt,
    saveStateText,
    designer,
    viewport,
    repository,
    backendMode,
    gridConfig,
    editingCell,
    canvasTick,
    minPages,
    pageCount,
    activePage,
    setMinPages,
    addPage,
    removePage,
    goToPage,
    openCellEditor,
    closeCellEditor,
    bumpCanvasTick,
    setGrid,
    attachCanvas,
    detachCanvas,
    addControlOfType,
    importTable,
    addZone,
    updateControl,
    updateControlSilent,
    removeControl,
    selectControl,
    buildTemplate,
    markSaved,
    currentTemplateId,
    setRepository,
    newBlankTemplate,
    saveTemplateAs,
    saveTemplate,
    loadTemplate,
    restoreLastTemplate,
    applyPageDecoration,
    setZoom,
    fitCanvas,

    // 撤销/重做委托
    undo: () => useHistoryStore().undo(),
    redo: () => useHistoryStore().redo(),
    canUndo: computed(() => useHistoryStore().canUndo),
    canRedo: computed(() => useHistoryStore().canRedo),
  }
})

/* --------------------------- 默认控件工厂 --------------------------- */

function createDefaultControl(
  type: ControlType,
  at: { leftMm: number; topMm: number },
): AnyControl | null {
  const id = genId()
  // 坐标兜底：at.leftMm/topMm 可能因上游时序（如拖拽时 viewport 未就绪）为 NaN/undefined，
  // Math.max(0, Math.round(NaN*100)/100) 会得到 NaN，写进 store 后 NInputNumber 会渲染删除线。
  // 这里强制收敛为有限数字，保证几何字段永远是有效数字。
  const safeMm = (v: unknown): number => {
    // 坐标统一收敛到 0.1mm（与属性面板 precision=1、step=0.1 一致）。
    // 关键：Naive UI 的 NInputNumber 设了 step 后会校验值是否为 step 网格（0.1 整数倍），
    // 非倍数会被判 displayedValueInvalid 并画删除线。任意坐标（如 139.82）必须 snap 到
    // 0.1 倍数，否则 XY 一进画布就显示删除线（这就是“默认划横线”的真因，与 NaN 无关）。
    const n = Math.round((typeof v === 'number' && Number.isFinite(v) ? v : 0) * 10) / 10
    return n < 0 ? 0 : n
  }
  const base = {
    id,
    left: safeMm(at.leftMm),
    top: safeMm(at.topMm),
    printable: true,
  }
  switch (type) {
    case 'text':
      return { ...base, type, width: 50, height: 8, value: '文本', style: { fontSize: 12 } }
    case 'image':
      return { ...base, type, width: 40, height: 25, value: { mode: 'inline', content: '' }, fit: 'contain' }
    case 'table':
      return seedSummaryTail(
        {
          ...base,
          type,
          width: 180,
          height: 60,
          columns: [
            { title: '序号', expression: '{{rowIndex + 1}}', width: 15, align: 'center', headerAlign: 'center' },
            { title: '名称', field: 'items[].name', width: 60 },
            { title: '数量', field: 'items[].qty', width: 25, headerAlign: 'center' },
            { title: '单价', field: 'items[].price', width: 30, headerAlign: 'center' },
            { title: '金额', field: 'items[].amount', width: 30, headerAlign: 'center' },
          ],
          // 自带示例数据：预览 / 打印即可看到填充内容与自动计算的小计
          data: [
            { name: '示例商品 A', qty: 2, price: 12.5, amount: 25 },
            { name: '示例商品 B', qty: 1, price: 36, amount: 36 },
            { name: '示例商品 C', qty: 5, price: 8, amount: 40 },
          ],
          // 默认单元格居中（defaultCellStyle 兜底，列/单元格显式对齐仍可覆盖）
          options: {
            repeatHeader: true,
            repeatFooter: true,
            pageRows: 'auto',
            borders: 'all',
            verticalAlign: 'middle',
            defaultCellStyle: { align: 'center' },
          },
        },
        // 默认植入完整「本页合计 + 总计 + 大写金额」三行尾结构
        { numericColumns: [2, 3, 4], moneyColumn: 4, capital: true },
      )
    case 'barcode':
      // 高度 30mm ≈ 113px：足够容纳 bwip-js 条码条（约 21mm）+ 文字行 + 上下留白，
      // 避免默认 15mm 时文字行被 scaleY 压扁到看不见。
      return { ...base, type, width: 60, height: 30, format: 'CODE128', showText: true }
    case 'qrcode':
      return { ...base, type, width: 25, height: 25, errorLevel: 'M' }
    case 'rect':
      return { ...base, type, width: 40, height: 25, fill: 'transparent', stroke: '#000000', strokeWidth: 1 }
    case 'line':
      return { ...base, type, width: 60, height: 0, stroke: '#000000', strokeWidth: 1 }
    case 'zone':
      // zone 由面板显式指定 header/footer，拖入默认 header
      return { ...base, type, width: 210, height: 20, zone: 'header', zoneHeight: 20, repeat: true, children: [] }
    case 'richtext':
      return {
        ...base,
        type,
        width: 80,
        height: 24,
        value: '<h3>标题</h3><p>在这里输入<strong>富文本</strong>内容，支持列表、加粗等排版。</p>',
      }
    case 'chart':
      return {
        ...base,
        type,
        width: 90,
        height: 60,
        kind: 'bar',
        categories: ['一月', '二月', '三月', '四月'],
        series: [
          { name: '销量', data: [120, 200, 150, 80] },
          { name: '退货', data: [20, 35, 15, 10] },
        ],
        options: { showAxis: true, showGrid: true, showLegend: true, valueLabel: false },
      }
  }
}
