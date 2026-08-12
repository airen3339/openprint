/**
 * 画布页间留白几何纯函数（设计态专用）。
 *
 * 模型 mm 保持 flush（与渲染/导出一致），页间距只叠加在画布 px 坐标上：
 * - 页 1 顶部 = 页边距；页 i+1 顶部 = i × (页高 + 间距) + 页边距
 * - 正文控件绝对 y = 页边距 + topMm×PX + 累计页间距（按所在页索引）
 */
import { MM_TO_PX } from '@/utils/constants'

/** 模型 top(mm, flush) 所在页索引 → 该页之前的累计页间距(px)；首页恒为 0 */
export function pageGapPx(topMm: number, pageHeightMm: number, gapPx: number): number {
  if (topMm <= 0 || pageHeightMm <= 0) return 0
  const i = Math.floor(topMm / pageHeightMm)
  return i > 0 ? i * gapPx : 0
}

/** 模型 top(mm, flush) → 画布绝对 y(px)：页边距 + 页内偏移 + 累计页间距 */
export function modelTopToCanvasY(
  topMm: number,
  marginTopPx: number,
  pageHeightMm: number,
  gapPx: number,
): number {
  return marginTopPx + topMm * MM_TO_PX + pageGapPx(topMm, pageHeightMm, gapPx)
}

/** 画布绝对 y(px) → 模型 top(mm, flush)：反解累计页间距（近页边界最多迭代 2 次收敛） */
export function canvasYToModelTop(
  y: number,
  marginTopPx: number,
  pageHeightMm: number,
  gapPx: number,
): number {
  const y0 = y - marginTopPx
  let topMm = y0 / MM_TO_PX
  let gap = pageGapPx(topMm, pageHeightMm, gapPx)
  if (gap > 0) {
    topMm = (y0 - gap) / MM_TO_PX
    const gap2 = pageGapPx(topMm, pageHeightMm, gapPx)
    if (gap2 !== gap) topMm = (y0 - gap2) / MM_TO_PX
  }
  return topMm
}
