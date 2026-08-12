import { describe, expect, it } from 'vitest'
import { resolveTextValue, resolveControlContent } from './data-binder'
import type { TextControl } from '@/types/control'
import type { EvalContext } from './types'

function text(partial: Partial<TextControl>): TextControl {
  return { id: 't1', type: 'text', left: 0, top: 0, width: 50, height: 10, ...partial }
}

describe('resolveTextValue —— 文本控件格式化', () => {
  const ctx: EvalContext = { data: { order: { date: '2026-08-11', total: 12800.5, qty: 1234.5, rate: 0.125 } } }

  it('无 format 时回落默认 stringify', () => {
    const r = resolveTextValue(text({ binding: 'order.total' }), ctx)
    expect(r.text).toBe('12800.5')
  })

  it('日期格式', () => {
    const r = resolveTextValue(
      text({ binding: 'order.date', format: { kind: 'date', pattern: 'YYYY年MM月DD日' } }),
      ctx,
    )
    expect(r.text).toBe('2026年08月11日')
  })

  it('整数 + 千分位', () => {
    const r = resolveTextValue(
      text({ binding: 'order.qty', format: { kind: 'int', thousands: true } }),
      ctx,
    )
    expect(r.text).toBe('1,235')
  })

  it('小数 + 千分位', () => {
    const r = resolveTextValue(
      text({ binding: 'order.total', format: { kind: 'decimal', digits: 2, thousands: true } }),
      ctx,
    )
    expect(r.text).toBe('12,800.50')
  })

  it('货币', () => {
    const r = resolveTextValue(
      text({ binding: 'order.total', format: { kind: 'currency', code: 'USD', digits: 2, thousands: true } }),
      ctx,
    )
    expect(r.text).toBe('$12,800.50')
  })

  it('百分比', () => {
    const r = resolveTextValue(
      text({ binding: 'order.rate', format: { kind: 'percent', digits: 1 } }),
      ctx,
    )
    expect(r.text).toBe('12.5%')
  })

  it('expression 模式不被 format 影响（过滤器优先）', () => {
    const r = resolveTextValue(
      text({ expression: '{{order.total | currency:\'CNY\'}}', format: { kind: 'int' } }),
      ctx,
    )
    expect(r.text).toContain('12,800.50')
  })
})

describe('resolveControlContent —— 文本格式贯穿渲染', () => {
  const ctx: EvalContext = { data: { order: { date: '2026-08-11' } } }

  it('绑定字段按 format 输出（走 content 解析总入口）', async () => {
    const { content, warnings } = await resolveControlContent(
      text({ id: 't2', binding: 'order.date', format: { kind: 'date', pattern: 'MM/DD/YYYY' } }),
      ctx,
    )
    expect(content.kind).toBe('text')
    if (content.kind === 'text') expect(content.text).toBe('08/11/2026')
    expect(warnings).toEqual([])
  })
})
