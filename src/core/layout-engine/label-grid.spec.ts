/**
 * label-grid 展开器单测 —— 验证「纯布局平铺」范式：
 *  - 总卡片数 = 列数 × 行数（行数由容器高度推导），每张卡 = children 一份完全相同的实例；
 *  - 多列按行铺开、行满换页（top 跨页绝对坐标自洽）；
 *  - 标签网格不带数据源，rowCtx 恒空（逐卡数据由卡内其他数据组件负责）；
 *  - 空 children（合法空布局）、超 maxPages 等边界正确。
 */
import { describe, expect, it } from 'vitest'

import {
  bodyStepMm,
  expandLabelGrids,
  resolveGridGeometry,
  withRowCtx,
} from '@/core/layout-engine/label-grid'
import { MAX_PAGES, type EvalContext, type PageMetrics } from '@/core/layout-engine/types'
import type { AnyControl, LabelGridControl } from '@/types/control'
import type { PageSetup, TemplateData } from '@/types/template'
import { layout } from '@/core/layout-engine/pagination-engine'
import { renderHtml } from '@/core/renderer-html'

/* ------------------------------ 测试夹具 ------------------------------ */

const A4: PageSetup = {
  width: 210,
  height: 297,
  unit: 'mm',
  orientation: 'portrait',
  margin: { top: 10, bottom: 10, left: 10, right: 10 },
  backgroundColor: '#ffffff',
}

const metrics: PageMetrics = {
  pageWidth: 210,
  pageHeight: 297,
  margin: { top: 10, right: 10, bottom: 10, left: 10 },
  contentWidth: 190,
  contentHeight: 277,
  headerHeight: 0,
  footerHeight: 0,
  bodyHeight: 277,
}

/** 卡片步长（卡高 + 纵间距），用于按行数反推容器高度 */
const STEP_Y = 33 // cardH 30 + gapY 3
/** 行数 R 对应的容器高度（保证 visibleCardRows 精确等于 R） */
function heightForRows(R: number): number {
  return STEP_Y * R - 3
}

/** 卡片模板：一个边框 + 一个静态文本（标签网格为纯布局，模板被原样重复） */
function makeCard(ids: { rect: string; name: string }): AnyControl[] {
  return [
    {
      id: ids.rect,
      type: 'rect',
      left: 0,
      top: 0,
      width: 40,
      height: 30,
      fill: 'transparent',
      stroke: '#333',
      strokeWidth: 0.5,
      printable: true,
    },
    {
      id: ids.name,
      type: 'text',
      left: 3,
      top: 3,
      width: 30,
      height: 6,
      value: '商品标签',
      style: { fontSize: 10 },
      printable: true,
    },
  ]
}

function makeGrid(over: Partial<LabelGridControl> = {}): LabelGridControl {
  return {
    id: 'grid1',
    type: 'labelgrid',
    left: 0,
    top: 0,
    width: 124, // 3*40 + 2*2
    height: heightForRows(3), // 3 行
    columns: 3,
    gapX: 2,
    gapY: 3,
    cardWidth: 40,
    cardHeight: 30,
    children: makeCard({ rect: 'c-rect', name: 'c-name' }),
    printable: true,
    ...over,
  }
}

function makeCtx(): EvalContext {
  return { data: {} }
}

/** 取某张卡某子控件的生成 id */
function genId(gridId: string, cardIndex: number, childId: string): string {
  return `${gridId}~${cardIndex}~${childId}`
}

/* ------------------------------ 测试用例 ------------------------------ */

describe('expandLabelGrids —— 几何与计数', () => {
  it('卡片数 = 列数 × 行数，每张卡 = children 一份实例', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)

    // 3 列 × 3 行 = 9 张卡 × 2 子控件 = 18 个生成控件
    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(18)
    // 标签网格不带数据源，行上下文恒空
    expect(res.rowCtx.size).toBe(0)
  })

  it('多列：同行走不同列 → left 按列宽+间距递增', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)

    const nameOf = (card: number) =>
      res.components.find((c) => c.id === genId('grid1', card, 'c-name'))!
    // 列宽 40 + 间距 2 = 42；列 0/1/2 的 left = 3 / 45 / 87（文本自身 left=3）
    expect(nameOf(0).left).toBeCloseTo(3, 5)
    expect(nameOf(1).left).toBeCloseTo(45, 5)
    expect(nameOf(2).left).toBeCloseTo(87, 5)
    // 不同列 top 相同（同一行）
    expect(nameOf(0).top).toBeCloseTo(nameOf(2).top, 5)
  })

  it('行数由容器高度推导：height 越大铺的行越多', () => {
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(4) })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    // 4 行 × 3 列 = 12 张卡 × 2 = 24 个控件
    expect(res.components.length).toBe(24)
  })
})

describe('expandLabelGrids —— 多页跨页', () => {
  it('行满换页：下一页控件 top 跨页绝对坐标自洽', () => {
    // bodyStep=100 → 每页 3 行（stepY=33）；10 行 = 30 张卡 → 跨 4 页
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      MAX_PAGES,
    )

    const tops = res.components.map((c) => c.top)
    // 第 1 页顶部行 top<100；第 2 页起 top>=100
    expect(Math.min(...tops)).toBeLessThan(100)
    expect(Math.max(...tops)).toBeGreaterThanOrEqual(100)
    // 10 行 × 3 列 = 30 张卡 × 2 子控件 = 60
    expect(res.components.length).toBe(60)
  })
})

describe('expandLabelGrids —— 边界', () => {
  it('超 maxPages → 截断 + PAGE_LIMIT_REACHED', () => {
    // maxPages=1，但 10 行需要 4 页 → 只渲染第 1 页的 9 张卡
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      1,
    )

    expect(res.components.length).toBe(18) // 9 张卡 × 2 子控件
    expect(res.warnings.some((w) => w.code === 'PAGE_LIMIT_REACHED')).toBe(true)
  })

  it('children 为空 → 合法空布局：0 张卡、无告警', () => {
    const res = expandLabelGrids(
      [makeGrid({ children: [] })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.expanded).toBe(true)
    expect(res.components.length).toBe(0)
    expect(res.warnings.length).toBe(0)
  })
})

describe('withRowCtx —— 标签网格恒空行上下文', () => {
  it('无行上下文时原样返回 base ctx（零开销、无 row 字段）', () => {
    const ctx = makeCtx()
    expect(withRowCtx('grid1~0~c-name', ctx)).toBe(ctx)
    expect((withRowCtx('grid1~0~c-name', ctx) as EvalContext).row).toBeUndefined()
  })
})

describe('resolveGridGeometry —— 几何推算', () => {
  it('缺省 cardWidth 由 width 与列数/间距反推', () => {
    const geo = resolveGridGeometry({
      width: 124,
      height: heightForRows(3),
      columns: 3,
      gapX: 2,
      children: makeCard({ rect: 'r', name: 'n' }),
    })
    expect(geo.columns).toBe(3)
    expect(geo.cardWidth).toBeCloseTo(40, 5)
    expect(geo.cardHeight).toBeCloseTo(30, 5)
  })
})

/* ------------------------------ 端到端集成 ------------------------------ */

function makeTemplate(grid: LabelGridControl): TemplateData<AnyControl> {
  return {
    version: '1.0',
    document: {
      type: 'report',
      page: A4,
      sections: [{ type: 'body', components: [grid] }],
    },
  }
}

describe('layout() 端到端 —— 标签网格走完整渲染链路', () => {
  it('展开出的卡片静态模板逐张平铺，HTML 含每卡内容', async () => {
    const grid = makeGrid({ children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {})

    // 不报错、无告警（合法布局）
    expect(result.warnings.length).toBe(0)

    const html = renderHtml(result, { screen: false })
    // 每张卡都印出模板里的静态文本
    expect(html).toContain('商品标签')
    // 生成控件 id 带行号后缀（证明走了「入口摊平」）
    expect(html).toContain('grid1~0~c-rect')
    expect(html).toContain('grid1~8~c-name')
    // 网格参考线随预览渲染（所见即所得）
    expect(html).toContain('op-gridlines')
    expect(html).toContain('op-gridline')
  })

  it('多页：行数超一页时跨页，page 变量每页递增', async () => {
    // 真实 A4：bodyStep = 287；stepY=33 → 每页容量 floor((287+3)/33)=8 行。
    // 10 行 / 3 列 = 30 张卡 → 跨 2 页。
    const grid = makeGrid({ height: heightForRows(10), children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {}, { maxPages: MAX_PAGES })
    expect(result.pages.length).toBeGreaterThan(1)
    // 末页 pageNo 应等于总页数
    expect(result.pages[result.pages.length - 1]!.pageNo).toBe(result.pages.length)
  })

  it('关闭网格线：预览不含网格参考线', async () => {
    const grid = makeGrid({ showLines: false, children: makeCard({ rect: 'c-rect', name: 'c-name' }) })
    const result = await layout(makeTemplate(grid), {})
    const html = renderHtml(result, { screen: false })
    // 注意：CSS 里始终含 .op-gridline 选择器规则，故需校验「是否真的渲染了 div」
    expect(html).not.toContain('<div class="op-gridline"')
    expect(html).not.toContain('<div class="op-gridlines">')
  })
})

describe('expandLabelGrids —— 网格参考线（所见即所得）', () => {
  it('单页：网格线 = 卡片数 + 容器分段，默认实线', () => {
    const res = expandLabelGrids([makeGrid()], makeCtx(), 'mm', bodyStepMm(metrics), MAX_PAGES)
    // 3×3 = 9 张卡片 + 1 段容器（网格落在单页内）= 10 条
    expect(res.gridLines.length).toBe(10)
    expect(res.gridLines.every((g) => g.line.solid)).toBe(true)
    // 全部落在第 0 页
    expect(res.gridLines.every((g) => g.pageIndex === 0)).toBe(true)
  })

  it('虚线：lineStyle=dashed 时所有线 solid=false', () => {
    const res = expandLabelGrids(
      [makeGrid({ lineStyle: 'dashed' })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.gridLines.length).toBeGreaterThan(0)
    expect(res.gridLines.every((g) => !g.line.solid)).toBe(true)
  })

  it('关闭网格线：不产生任何参考线', () => {
    const res = expandLabelGrids(
      [makeGrid({ showLines: false })],
      makeCtx(),
      'mm',
      bodyStepMm(metrics),
      MAX_PAGES,
    )
    expect(res.gridLines.length).toBe(0)
  })

  it('多页：容器按页分段，网格线分布到各页', () => {
    // bodyStep=100 → 容器高 327 → 跨 4 页（分段 0..3）；卡片 30 张
    const res = expandLabelGrids(
      [makeGrid({ height: heightForRows(10) })],
      makeCtx(),
      'mm',
      100,
      MAX_PAGES,
    )
    // 4 段容器 + 30 张卡片 = 34
    expect(res.gridLines.length).toBe(34)
    const pages = new Set(res.gridLines.map((g) => g.pageIndex))
    expect([...pages].sort()).toEqual([0, 1, 2, 3])
  })
})
