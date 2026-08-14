import { describe, expect, it } from 'vitest'

import { layout } from '@/core/layout-engine/pagination-engine'
import { renderHtml } from '@/core/renderer-html'
import { createDemoTemplate } from '@/repository/mock/data/demo-template'
import { createCjkMeasurer } from '@/core/__tests__/cjk-measurer'
import { seedSummaryTail } from '@/core/layout-engine/table-cells'
import type { AnyControl, TableControl } from '@/types/control'
import type { TemplateData } from '@/types/template'
import type { LayoutResult, PlacedTable } from './types'

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

  // 正文可用高 275mm（Word 式：页眉/页脚在边距内不占正文）→ 40 行起跨页
  for (const rows of [40, 80]) {
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

describe('layout —— 表格拖到底部 + 下方控件（强转非末页回归）', () => {
  const measurer = createCjkMeasurer()

  /** A4 纵向 10mm 边距：正文可用高 = 297-10-10 = 277mm */
  function bottomTableTemplate(): TemplateData<AnyControl> {
    const amountCol = 1
    const table = seedSummaryTail(
      {
        id: 'ft',
        type: 'table',
        left: 10,
        top: 230, // 拖到正文区底部 → 页 1 可用高度 ≈ 47mm
        width: 190,
        height: 40,
        dataSource: 'items',
        columns: [
          { title: '名称', field: 'items[].name', width: 140, align: 'left', headerAlign: 'center' },
          { title: '金额', field: 'items[].amount', width: 50, headerAlign: 'center' },
        ],
        data: [
          { name: 'A', amount: 20 },
          { name: 'B', amount: 30 },
        ],
        options: { repeatHeader: true, repeatFooter: false },
      } as unknown as TableControl,
      { numericColumns: [amountCol], moneyColumn: amountCol, capital: true },
    )
    return {
      version: '1',
      document: {
        type: 'report',
        page: {
          width: 210,
          height: 297,
          unit: 'mm',
          orientation: 'portrait',
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
        },
        sections: [
          {
            type: 'body',
            components: [
              table,
              { id: 'sign', type: 'text', left: 10, top: 272, width: 120, height: 25, value: '签章' } as AnyControl,
            ],
          },
        ],
      },
    }
  }

  function tablesOf(pageNo: number, result: LayoutResult): PlacedTable[] {
    return result.pages[pageNo]!.body.filter((n): n is PlacedTable => n.kind === 'table')
  }

  const kinds = (pageNo: number, result: LayoutResult): string[] =>
    tablesOf(pageNo, result).flatMap((t) => t.footerRows.map((f) => f.footerKind ?? ''))
  const textOf = (pageNo: number, kind: string, col: number, result: LayoutResult): string | undefined =>
    tablesOf(pageNo, result)
      .flatMap((t) => t.footerRows)
      .find((f) => f.footerKind === kind)?.cells[col]?.text

  it('表格在页 1 放完但下方控件独占页 2 → 总计/大写只在页 2；本页合计逐页按本页数据计算', async () => {
    const result = await layout(bottomTableTemplate(), {}, { measurer })
    expect(
      result.pages.length,
      'pages=' + result.pages.length + ' warns=' + JSON.stringify(result.warnings.map((w) => w.code)),
    ).toBe(2)

    // 页 1：只有本页合计，绝无总计 / 大写金额；本页合计 = 20（仅本页第 1 行）
    expect(kinds(0, result)).toContain('pageSubtotal')
    expect(kinds(0, result)).not.toContain('grandTotal')
    expect(kinds(0, result)).not.toContain('capital')
    expect(textOf(0, 'pageSubtotal', 1, result)).toBe('20')

    // 页 2（文档末页）：本页合计 = 30（末页第 2 行）+ 总计 = 50 + 大写金额 = 伍拾元整
    expect(kinds(1, result)).toContain('pageSubtotal')
    expect(kinds(1, result)).toContain('grandTotal')
    expect(kinds(1, result)).toContain('capital')
    expect(textOf(1, 'pageSubtotal', 1, result)).toBe('30')
    expect(textOf(1, 'grandTotal', 1, result)).toBe('50')
    expect(textOf(1, 'capital', 1, result)).toBe('伍拾元整')
  })
})
