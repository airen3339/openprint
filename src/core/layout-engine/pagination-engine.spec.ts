import { describe, expect, it } from 'vitest'

import { layout } from '@/core/layout-engine/pagination-engine'
import { renderHtml } from '@/core/renderer-html'
import { createDemoTemplate } from '@/repository/mock/data/demo-template'
import { createCjkMeasurer } from '@/core/__tests__/cjk-measurer'

function makeData(rows: number): Record<string, unknown> {
  const items = Array.from({ length: rows }, (_, i) => {
    const qty = (i % 5) + 1
    const price = 10 + (i % 9)
    return {
      productCode: `P${String(i + 1).padStart(4, '0')}`,
      productName: `商品${i + 1}`,
      spec: '规格A',
      unit: '件',
      qty,
      price,
      amount: qty * price,
    }
  })
  return {
    order: { orderNo: 'SO-2026-0001', orderDate: '2026-08-08' },
    customer: { name: '演示客户' },
    items,
  }
}

describe('layout 分页引擎（集成 demo 模板）', () => {
  const template = createDemoTemplate()
  const measurer = createCjkMeasurer()

  for (const rows of [30, 80]) {
    it(`明细 ${rows} 行 → 多页，页眉页脚每页重复，合计仅末页`, async () => {
      const result = await layout(template, makeData(rows), { measurer })
      const pages = result.pages.length
      expect(pages).toBeGreaterThanOrEqual(2)

      const html = renderHtml(result, { screen: false })
      // 样式表不参与计数
      const body = html.replace(/<style[\s\S]*?<\/style>/g, '')

      // 页眉页脚每页重复
      expect((body.match(/op-section op-header/g) || []).length).toBe(pages)
      expect((body.match(/op-section op-footer/g) || []).length).toBe(pages)

      // 表格按页切片：每页一个 <table>
      expect((body.match(/op-node op-table/g) || []).length).toBe(pages)

      // 合计行仅一次（末页）
      expect((body.match(/is-summary/g) || []).length).toBe(1)

      // 零告警（数据完整、绑定可达）
      expect(result.warnings.length).toBe(0)
    })
  }
})
