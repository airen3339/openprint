/**
 * PaginationEngine —— 分页算法主流程
 * 真理源：《OpenPrint-设计方案.md》§7.2（分页算法流程）、§7.4（难点清单）、§8.1（二维排版，非流式）
 *
 * ## 分页模型：绝对定位 + 单表流动
 *
 * OpenPrint 是**二维排版工具，不是网页编辑器**（§8.1）：正文控件都是相对区块左上角的
 * 绝对定位盒子，本身不参与文档流。真正会"长高"的只有绑定了数据源的表格。
 * 因此分页的语义是：
 *
 * ```
 *  ┌── 表格上方控件（单据头：单号/客户/日期）  → 仅第 1 页
 *  ├── 明细表格                              → 按行切片流过 N 页
 *  └── 表格下方控件（单据尾：合计/签章）        → 仅最后一页，随表格实际高度下移
 * ```
 *
 * 这正是 ERP 单据的真实结构，也是金蝶/帆软等报表工具的一致做法。
 * 每页重复的内容（公司抬头、页码）交给 header/footer 区块（§5.14），不在正文里解决。
 *
 * 无表格时退化为「按位置切页」：控件按 top 落在第几个 bodyHeight 区间就进第几页，
 * 保证超长静态模板也不会被截断。
 */
import type { AnyControl, TableControl } from '@/types/control'
import type { PageSetup, Section, TemplateData } from '@/types/template'
import { toMm } from '@/core/units'
import { isControlPrintable, resolveControlContent } from './data-binder'
import {
  buildSectionControls,
  computePageMetrics,
  shouldRenderSection,
} from './header-footer'
import { getSharedMeasurer, type TextMeasurer } from './measure'
import {
  buildTableModel,
  minStartHeight,
  sliceTable,
  totalTableHeight,
  type TableModel,
} from './table-engine'
import { isDataTable } from './table-cells'
import {
  MAX_PAGES,
  type EvalContext,
  type LayoutPage,
  type LayoutResult,
  type PageMetrics,
  type PlacedControl,
  type PlacedNode,
  type PlacedTable,
  type RenderWarning,
} from './types'

/** 几何比较容差（mm），消除序列化四舍五入带来的边界抖动 */
const EPS = 0.5

export interface LayoutOptions {
  /** 自定义文本测量器（默认用共享的 DOM 测量器） */
  measurer?: TextMeasurer
  /** 最大页数保护 */
  maxPages?: number
}

/* ------------------------------ 正文结构分析 ------------------------------ */

interface BodyPlan {
  /** 驱动分页的流式表格（绑定了数据源） */
  flowTable: TableControl | null
  /** 表格上方控件 → 第 1 页 */
  above: AnyControl[]
  /** 与表格垂直重叠的控件 → 第 1 页原位 */
  overlap: AnyControl[]
  /** 表格下方控件 → 末页，随表格高度下移 */
  below: AnyControl[]
}

function analyzeBody(components: AnyControl[], unit: PageSetup['unit']): {
  plan: BodyPlan
  warnings: RenderWarning[]
} {
  const warnings: RenderWarning[] = []
  const tables = components.filter(
    (c): c is TableControl => c.type === 'table' && isDataTable(c),
  )

  if (tables.length > 1) {
    warnings.push({
      code: 'CONTENT_OVERFLOW',
      message: `正文存在 ${tables.length} 个数据表格，仅第一个（${tables[0]!.id}）参与分页流动，其余按静态控件渲染`,
      controlId: tables[1]!.id,
    })
  }

  const flowTable = tables[0] ?? null
  if (!flowTable) {
    return { plan: { flowTable: null, above: components, overlap: [], below: [] }, warnings }
  }

  const tTop = toMm(flowTable.top, unit)
  const tBottom = tTop + toMm(flowTable.height, unit)

  const above: AnyControl[] = []
  const overlap: AnyControl[] = []
  const below: AnyControl[] = []

  for (const c of components) {
    if (c.id === flowTable.id) continue
    const top = toMm(c.top, unit)
    const bottom = top + toMm(c.height, unit)
    if (bottom <= tTop + EPS) above.push(c)
    else if (top >= tBottom - EPS) below.push(c)
    else overlap.push(c)
  }

  return { plan: { flowTable, above, overlap, below }, warnings }
}

/* ------------------------------- 控件定位 ------------------------------- */

async function placeControls(
  components: AnyControl[],
  ctx: EvalContext,
  unit: PageSetup['unit'],
  topShift = 0,
): Promise<{ placed: PlacedControl[]; warnings: RenderWarning[] }> {
  const placed: PlacedControl[] = []
  const warnings: RenderWarning[] = []

  for (const control of components) {
    if (control.type === 'zone') continue
    if (!isControlPrintable(control, ctx)) continue

    // 静态表格（布局网格 / 非流动表格）在这里整体渲染
    if (control.type === 'table') continue

    const { content, warnings: w } = await resolveControlContent(control, ctx)
    warnings.push(...w)
    placed.push({
      kind: 'control',
      id: control.id,
      left: toMm(control.left, unit),
      top: toMm(control.top, unit) + topShift,
      width: toMm(control.width, unit),
      height: toMm(control.height, unit),
      angle: control.angle,
      content,
      control,
    })
  }

  return { placed, warnings }
}

/** 静态表格（无数据源或非首个数据表格）整表渲染，不参与分页 */
function placeStaticTables(
  components: AnyControl[],
  flowTableId: string | null,
  ctx: EvalContext,
  unit: PageSetup['unit'],
  measurer: TextMeasurer,
  topShift = 0,
): { placed: PlacedTable[]; warnings: RenderWarning[] } {
  const placed: PlacedTable[] = []
  const warnings: RenderWarning[] = []

  for (const control of components) {
    if (control.type !== 'table' || control.id === flowTableId) continue
    if (!isControlPrintable(control, ctx)) continue

    const widthMm = toMm(control.width, unit)
    const heightMm = toMm(control.height, unit)
    const model = buildTableModel({ control, ctx, measurer, widthMm, heightMm })
    warnings.push(...model.warnings)
    placed.push({
      kind: 'table',
      id: control.id,
      left: toMm(control.left, unit),
      top: toMm(control.top, unit) + topShift,
      width: widthMm,
      height: Math.max(heightMm, totalTableHeight(model)),
      control,
      columns: model.columns,
      columnWidths: model.columnWidths,
      headerRows: model.headerRows,
      rows: model.rows,
      footerRows: model.footerRows,
      isLastSlice: true,
    })
  }

  return { placed, warnings }
}

/* -------------------------------- 分页骨架 ------------------------------- */

/** 表格切片在各页上的落位结果（尚未解析上下方控件） */
interface TableSkeleton {
  /** 每页一个切片；空数组表示表格无内容 */
  slices: Array<{ table: PlacedTable; pageIndex: number }>
  /** 表格实际占用的页数 */
  pageCount: number
  /** 末页上表格的实际底边（mm，相对正文区顶） */
  lastBottom: number
  warnings: RenderWarning[]
}

function paginateFlowTable(
  model: TableModel,
  tableLeft: number,
  tableWidth: number,
  tableTop: number,
  metrics: PageMetrics,
  reserveBelow: number,
  maxPages: number,
): TableSkeleton {
  const warnings: RenderWarning[] = []
  const slices: TableSkeleton['slices'] = []
  const keepTogether = model.control.options?.keepTogether ?? false

  // keepTogether：首页放不下"表头 + 1 行 + 表尾"就整体下移到第 2 页（§7.4）
  let firstPageIndex = 0
  let firstTop = tableTop
  if (keepTogether && metrics.bodyHeight - tableTop < minStartHeight(model)) {
    firstPageIndex = 1
    firstTop = 0
  }

  let start = 0
  let pageIndex = firstPageIndex
  let lastBottom = firstTop
  let guard = 0

  for (;;) {
    if (++guard > maxPages) {
      warnings.push({
        code: 'PAGE_LIMIT_REACHED',
        message: `分页超过 ${maxPages} 页保护上限，已截断`,
        controlId: model.control.id,
      })
      break
    }

    const topOnPage = pageIndex === firstPageIndex ? firstTop : 0
    const availFull = Math.max(0, metrics.bodyHeight - topOnPage)

    // 先试"为下方控件预留空间"的窄预算；能一次放完，说明这就是末页
    let slice = null as ReturnType<typeof sliceTable> | null
    if (reserveBelow > 0 && availFull - reserveBelow > 0) {
      const trial = sliceTable(model, { avail: availFull - reserveBelow, start })
      if (trial.isLast) slice = trial
    }
    if (!slice) {
      slice = sliceTable(model, { avail: availFull, start })
      // 用满预算才放完 → 下方控件挤不下，让它们独占下一页
      if (slice.isLast && reserveBelow > 0 && availFull - slice.height < reserveBelow) {
        slice = { ...slice, isLast: false }
      }
    }

    warnings.push(...slice.warnings)

    // 跳过完全为空的尾片（上一页已放完全部数据行）：否则会渲染出一个空表 + 多余合计行
    const isEmptySlice =
      slice.rows.length === 0 && slice.headerRows.length === 0 && slice.footerRows.length === 0
    if (!isEmptySlice) {
      slices.push({
        table: {
          kind: 'table',
          id: model.control.id,
          left: tableLeft,
          top: topOnPage,
          width: tableWidth,
          height: slice.height,
          control: model.control,
          columns: model.columns,
          columnWidths: model.columnWidths,
          headerRows: slice.headerRows,
          rows: slice.rows,
          footerRows: slice.footerRows,
          isLastSlice: slice.isLast,
        },
        pageIndex,
      })
    }

    lastBottom = topOnPage + slice.height

    if (slice.isLast) break
    if (slice.nextStart === start && slice.rows.length === 0) {
      // 没有任何前进 → 防死循环
      warnings.push({
        code: 'CONTENT_OVERFLOW',
        message: '表格可用高度不足以容纳任何一行，已终止分页',
        controlId: model.control.id,
      })
      break
    }

    start = slice.nextStart
    pageIndex++
  }

  return {
    slices,
    pageCount: pageIndex + 1,
    lastBottom,
    warnings,
  }
}

/* ================================ 主入口 ================================ */

export async function layout(
  template: TemplateData<AnyControl>,
  data: Record<string, unknown>,
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const measurer = options.measurer ?? getSharedMeasurer()
  const maxPages = options.maxPages ?? MAX_PAGES
  const warnings: RenderWarning[] = []

  const doc = template.document
  const unit = doc.page.unit
  const sections = doc.sections ?? []
  const headerSection = sections.find((s) => s.type === 'header') as Section<AnyControl> | undefined
  const footerSection = sections.find((s) => s.type === 'footer') as Section<AnyControl> | undefined
  const bodySection = sections.find((s) => s.type === 'body') as Section<AnyControl> | undefined

  const metrics = computePageMetrics(doc.page, headerSection, footerSection)
  const baseCtx: EvalContext = { data }

  const bodyComponents = bodySection?.components ?? []
  const { plan, warnings: planWarnings } = analyzeBody(bodyComponents, unit)
  warnings.push(...planWarnings)

  /* ── 情况 A：无流式表格 → 按位置切页 ── */
  if (!plan.flowTable) {
    const staticPages = await layoutStaticOnly(
      plan.above,
      baseCtx,
      unit,
      metrics,
      measurer,
      maxPages,
      warnings,
    )
    const pages = await buildPages(
      staticPages.length,
      new Map(staticPages.map((p, i) => [i, p])),
      headerSection,
      footerSection,
      baseCtx,
      unit,
      warnings,
    )
    return { pages, metrics, page: doc.page, warnings: dedupeWarnings(warnings) }
  }

  /* ── 情况 B：有流式表格 ── */
  const table = plan.flowTable
  const tableTop = toMm(table.top, unit)
  const tableLeft = toMm(table.left, unit)
  const tableWidth = toMm(table.width, unit)
  const tableBottom = tableTop + toMm(table.height, unit)

  const model = buildTableModel({
    control: table,
    ctx: baseCtx,
    measurer,
    widthMm: tableWidth,
    heightMm: toMm(table.height, unit),
  })
  warnings.push(...model.warnings)

  // 下方控件相对表格底边的偏移量与所需高度
  const belowOffsets = plan.below.map((c) => ({
    control: c,
    delta: toMm(c.top, unit) - tableBottom,
  }))
  const reserveBelow = belowOffsets.reduce(
    (max, b) => Math.max(max, b.delta + toMm(b.control.height, unit)),
    0,
  )

  const skeleton = paginateFlowTable(
    model,
    tableLeft,
    tableWidth,
    tableTop,
    metrics,
    reserveBelow,
    maxPages,
  )
  warnings.push(...skeleton.warnings)

  const tableLastPage = skeleton.slices.at(-1)?.pageIndex ?? 0
  // 下方控件放得下就跟在末片后面，否则独占新的一页（top 从 0 起）
  const belowFitsOnTablePage = skeleton.lastBottom + reserveBelow <= metrics.bodyHeight + EPS
  const belowPageIndex = belowFitsOnTablePage ? tableLastPage : tableLastPage + 1
  const belowBaseTop = belowFitsOnTablePage ? skeleton.lastBottom : 0

  const totalPages = Math.max(1, Math.max(tableLastPage, belowPageIndex) + 1)
  const lastPageNo = totalPages

  /* ── 组装每页正文 ── */
  const bodyByPage = new Map<number, PlacedNode[]>()
  const pushNode = (pageIndex: number, node: PlacedNode): void => {
    const list = bodyByPage.get(pageIndex)
    if (list) list.push(node)
    else bodyByPage.set(pageIndex, [node])
  }

  for (const { table: slice, pageIndex } of skeleton.slices) pushNode(pageIndex, slice)

  // 第 1 页：表格上方 + 重叠控件 + 静态表格
  const firstCtx: EvalContext = { ...baseCtx, page: 1, pages: totalPages }
  const firstControls = await placeControls([...plan.above, ...plan.overlap], firstCtx, unit)
  warnings.push(...firstControls.warnings)
  for (const c of firstControls.placed) pushNode(0, c)

  const staticTables = placeStaticTables(
    [...plan.above, ...plan.overlap],
    table.id,
    firstCtx,
    unit,
    measurer,
  )
  warnings.push(...staticTables.warnings)
  for (const t of staticTables.placed) pushNode(0, t)

  // 末页：表格下方控件，按表格实际底边下移
  if (plan.below.length > 0) {
    const belowCtx: EvalContext = { ...baseCtx, page: lastPageNo, pages: totalPages }
    for (const { control, delta } of belowOffsets) {
      if (control.type === 'zone') continue
      if (!isControlPrintable(control, belowCtx)) continue
      if (control.type === 'table') continue
      const { content, warnings: w } = await resolveControlContent(control, belowCtx)
      warnings.push(...w)
      pushNode(belowPageIndex, {
        kind: 'control',
        id: control.id,
        left: toMm(control.left, unit),
        top: belowBaseTop + delta,
        width: toMm(control.width, unit),
        height: toMm(control.height, unit),
        angle: control.angle,
        content,
        control,
      })
    }

    const belowStatic = placeStaticTables(
      plan.below,
      table.id,
      { ...baseCtx, page: lastPageNo, pages: totalPages },
      unit,
      measurer,
      belowBaseTop - tableBottom,
    )
    warnings.push(...belowStatic.warnings)
    for (const t of belowStatic.placed) pushNode(belowPageIndex, t)
  }

  /* ── 注入页眉页脚 ── */
  const pages = await buildPages(
    totalPages,
    bodyByPage,
    headerSection,
    footerSection,
    baseCtx,
    unit,
    warnings,
  )

  return { pages, metrics, page: doc.page, warnings: dedupeWarnings(warnings) }
}

/* ---------------------------- 无表格：按位置切页 ---------------------------- */

/**
 * 无流式表格时的退化策略：控件按 top 落在第几个 bodyHeight 区间就进第几页。
 * 返回「每页的正文节点数组」，页眉页脚由调用方统一注入。
 */
async function layoutStaticOnly(
  components: AnyControl[],
  baseCtx: EvalContext,
  unit: PageSetup['unit'],
  metrics: PageMetrics,
  measurer: TextMeasurer,
  maxPages: number,
  warnings: RenderWarning[],
): Promise<PlacedNode[][]> {
  const bodyH = Math.max(1, metrics.bodyHeight)

  // 控件按 top 落在第几个 bodyHeight 区间就进第几页
  let maxPageIndex = 0
  const buckets = new Map<number, AnyControl[]>()
  for (const c of components) {
    const idx = Math.max(0, Math.min(maxPages - 1, Math.floor(toMm(c.top, unit) / bodyH)))
    maxPageIndex = Math.max(maxPageIndex, idx)
    const list = buckets.get(idx)
    if (list) list.push(c)
    else buckets.set(idx, [c])
  }

  const totalPages = maxPageIndex + 1
  const bodyByPage = new Map<number, PlacedNode[]>()

  for (const [idx, list] of buckets) {
    const ctx: EvalContext = { ...baseCtx, page: idx + 1, pages: totalPages }
    const shift = -idx * bodyH
    const { placed, warnings: w } = await placeControls(list, ctx, unit, shift)
    warnings.push(...w)
    const tables = placeStaticTables(list, null, ctx, unit, measurer, shift)
    warnings.push(...tables.warnings)
    bodyByPage.set(idx, [...placed, ...tables.placed])
  }

  return Array.from({ length: totalPages }, (_, i) => bodyByPage.get(i) ?? [])
}

/* ------------------------------ 页眉页脚注入 ------------------------------ */

async function buildPages(
  totalPages: number,
  bodyByPage: Map<number, PlacedNode[]>,
  headerSection: Section<AnyControl> | undefined,
  footerSection: Section<AnyControl> | undefined,
  baseCtx: EvalContext,
  unit: PageSetup['unit'],
  warnings: RenderWarning[],
): Promise<LayoutPage[]> {
  const pages: LayoutPage[] = []

  for (let i = 0; i < totalPages; i++) {
    // 页码变量按页求值 —— "第 X 页 / 共 Y 页" 正确的前提
    const pageCtx: EvalContext = { ...baseCtx, page: i + 1, pages: totalPages }

    let header: PlacedControl[] = []
    if (shouldRenderSection(headerSection, 'header', i, totalPages)) {
      const r = await buildSectionControls(headerSection?.components, pageCtx, unit)
      warnings.push(...r.warnings)
      header = r.controls
    }

    let footer: PlacedControl[] = []
    if (shouldRenderSection(footerSection, 'footer', i, totalPages)) {
      const r = await buildSectionControls(footerSection?.components, pageCtx, unit)
      warnings.push(...r.warnings)
      footer = r.controls
    }

    pages.push({ index: i, pageNo: i + 1, header, body: bodyByPage.get(i) ?? [], footer })
  }

  return pages
}

/* -------------------------------- 工具 -------------------------------- */

/** 同一条告警可能在多页重复产生（页眉每页解析一次），这里按 code+message+controlId 去重 */
function dedupeWarnings(list: RenderWarning[]): RenderWarning[] {
  const seen = new Set<string>()
  const out: RenderWarning[] = []
  for (const w of list) {
    const key = `${w.code}|${w.controlId ?? ''}|${w.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
  }
  return out
}
