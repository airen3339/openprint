import { describe, it, expect } from 'vitest'
import { pageGapPx, modelTopToCanvasY, canvasYToModelTop } from './page-gap'
import { MM_TO_PX } from '@/utils/constants'

const GAP = 24
const A4_MM = 297
const MARGIN_TOP_PX = 10 * MM_TO_PX

describe('pageGapPx —— 页索引 → 累计间距', () => {
  it('首页/负值/零页高 → 0', () => {
    expect(pageGapPx(0, A4_MM, GAP)).toBe(0)
    expect(pageGapPx(100, A4_MM, GAP)).toBe(0)
    expect(pageGapPx(-10, A4_MM, GAP)).toBe(0)
    expect(pageGapPx(500, 0, GAP)).toBe(0)
  })

  it('第 2 页起每页累加一个间距', () => {
    expect(pageGapPx(300, A4_MM, GAP)).toBe(GAP)
    expect(pageGapPx(600, A4_MM, GAP)).toBe(GAP * 2)
    expect(pageGapPx(900, A4_MM, GAP)).toBe(GAP * 3)
  })
})

describe('modelTopToCanvasY / canvasYToModelTop —— 正反互换', () => {
  it('第 1 页控件往返不漂移', () => {
    for (const topMm of [0, 5, 100, 296.5]) {
      const y = modelTopToCanvasY(topMm, MARGIN_TOP_PX, A4_MM, GAP)
      expect(canvasYToModelTop(y, MARGIN_TOP_PX, A4_MM, GAP)).toBeCloseTo(topMm, 6)
    }
  })

  it('第 2 页控件含累计间距且往返不漂移', () => {
    const topMm = 300
    const y = modelTopToCanvasY(topMm, MARGIN_TOP_PX, A4_MM, GAP)
    // 第 2 页内容区顶 = (297 + 24) + 页边距，300mm 应在第 2 页内偏下 3mm
    expect(y).toBeCloseTo(MARGIN_TOP_PX + 300 * MM_TO_PX + GAP, 6)
    expect(canvasYToModelTop(y, MARGIN_TOP_PX, A4_MM, GAP)).toBeCloseTo(topMm, 6)
  })

  it('第 3 页控件往返不漂移（两层间距）', () => {
    const topMm = 610
    const y = modelTopToCanvasY(topMm, MARGIN_TOP_PX, A4_MM, GAP)
    expect(canvasYToModelTop(y, MARGIN_TOP_PX, A4_MM, GAP)).toBeCloseTo(topMm, 6)
  })

  it('页边界附近往返不漂移（迭代收敛）', () => {
    for (const topMm of [296.9, 297.1, 593.9, 594.2]) {
      const y = modelTopToCanvasY(topMm, MARGIN_TOP_PX, A4_MM, GAP)
      expect(canvasYToModelTop(y, MARGIN_TOP_PX, A4_MM, GAP)).toBeCloseTo(topMm, 6)
    }
  })
})
