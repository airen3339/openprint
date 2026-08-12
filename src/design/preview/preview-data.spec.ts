import { describe, expect, it } from 'vitest'

import type { FieldDef } from '@/types/datasource'
import { buildPreviewData } from '@/design/preview/preview-data'

const FIELDS: FieldDef[] = [
  { path: 'order.orderNo', label: '单号', type: 'string', sample: 'SO-001' },
  { path: 'customer.name', label: '客户', type: 'string', sample: '客户甲' },
  { path: 'items[].productCode', label: '编码', type: 'string', sample: 'P001' },
  { path: 'items[].productName', label: '名称', type: 'string', sample: '商品' },
  { path: 'items[].qty', label: '数量', type: 'number', sample: 5 },
  { path: 'items[].price', label: '单价', type: 'number', sample: 10 },
  { path: 'items[].amount', label: '金额', type: 'number', sample: 50 },
]

describe('buildPreviewData —— 预览数据合成', () => {
  it('按 rows 展开明细数组', () => {
    const data = buildPreviewData(FIELDS, { rows: 3 })
    expect(Array.isArray(data.items)).toBe(true)
    expect((data.items as unknown[]).length).toBe(3)
  })

  it('金额自洽：amount = qty × price', () => {
    const data = buildPreviewData(FIELDS, { rows: 5 })
    const items = data.items as Array<Record<string, number>>
    for (const row of items) {
      expect(Number(row.amount)).toBeCloseTo(Number(row.qty) * Number(row.price), 2)
    }
  })

  it('编码类字段按行号变化，肉眼可辨分页边界', () => {
    const data = buildPreviewData(FIELDS, { rows: 3 })
    const items = data.items as Array<Record<string, string>>
    expect(items[0]!.productCode).toContain('001')
    expect(items[1]!.productCode).toContain('002')
    expect(items[2]!.productCode).toContain('003')
  })

  it('顶层字段按 path 嵌套写入', () => {
    const data = buildPreviewData(FIELDS, { rows: 1 })
    expect((data.order as Record<string, unknown>).orderNo).toBe('SO-001')
    expect((data.customer as Record<string, unknown>).name).toBe('客户甲')
  })

  it('字段为空返回 {}', () => {
    expect(buildPreviewData([], { rows: 3 })).toEqual({})
  })
})
