import { describe, expect, it } from 'vitest'

import {
  MM_PER_PT,
  PX_PER_MM,
  fromMm,
  mmToPx,
  mmToPt,
  ptToMm,
  ptToPx,
  pxToMm,
  toMm,
} from '@/core/units'

describe('units 坐标换算', () => {
  it('mmToPx：10mm ≈ 37.795px（96dpi）', () => {
    expect(mmToPx(10)).toBeCloseTo(37.795, 2)
  })

  it('mmToPx / pxToMm 往返一致', () => {
    expect(pxToMm(mmToPx(10))).toBeCloseTo(10, 4)
    expect(mmToPx(pxToMm(100))).toBeCloseTo(100, 4)
  })

  it('英寸与毫米互换：1in = 25.4mm', () => {
    expect(toMm(1, 'in')).toBeCloseTo(25.4, 6)
    expect(fromMm(25.4, 'in')).toBeCloseTo(1, 6)
  })

  it('点(pt)与毫米：72pt = 25.4mm', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 4)
    expect(ptToMm(72)).toBeCloseTo(25.4, 4)
    expect(toMm(72, 'pt')).toBeCloseTo(25.4, 4)
    expect(fromMm(25.4, 'pt')).toBeCloseTo(72, 4)
  })

  it('ptToPx：72pt = 96px（CSS 标准）', () => {
    expect(ptToPx(72)).toBeCloseTo(96, 4)
  })

  it('px 与 mm 互转（px 是 CSS 内部单位，toMm 不接收 px 源单位，故直接测 mmToPx/pxToMm）', () => {
    expect(mmToPx(pxToMm(96))).toBeCloseTo(96, 4)
    expect(pxToMm(mmToPx(25.4))).toBeCloseTo(25.4, 4)
  })

  it('导出常量与推导一致', () => {
    expect(PX_PER_MM).toBeCloseTo(96 / 25.4, 4)
    expect(MM_PER_PT).toBeCloseTo(25.4 / 72, 4)
  })
})
