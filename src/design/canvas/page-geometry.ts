/**
 * 画布多页几何纯函数（与渲染端 layoutStaticOnly 的落页口径一致）。
 *
 * 正文控件按 `marginTop + top` 绝对定位（top 为相对内容区 mm），
 * 越过内容区底部即落入下一页。物理页数 = floor(maxBottomMm / pageHeightMm) + 1。
 */
export function computePhysicalPageCount(maxBottomMm: number, pageHeightMm: number): number {
  if (pageHeightMm <= 0) return 1
  if (maxBottomMm <= 0) return 1
  return Math.max(1, Math.floor(maxBottomMm / pageHeightMm) + 1)
}
