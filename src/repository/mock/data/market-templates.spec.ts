import { describe, expect, it } from 'vitest'
import { MARKET_TEMPLATES } from '@/repository/mock/data/market-templates'
import { layout } from '@/core/layout-engine/pagination-engine'
import { renderHtml } from '@/core/renderer-html'
import { createCjkMeasurer } from '@/core/__tests__/cjk-measurer'

describe('market-templates —— 模板市场预设', () => {
  it('至少提供 6 个可用模板且覆盖主要品类', () => {
    expect(MARKET_TEMPLATES.length).toBeGreaterThanOrEqual(6)
    const cats = new Set(MARKET_TEMPLATES.map((t) => t.category))
    expect(cats.has('invoice')).toBe(true)
    expect(cats.has('receipt')).toBe(true)
    expect(cats.has('thermal')).toBe(true)
    expect(cats.has('label')).toBe(true)
  })

  it('每个模板 build() 产出的协议结构合法', () => {
    for (const tpl of MARKET_TEMPLATES) {
      const data = tpl.build()
      expect(data.version).toBe('1.0')
      expect(data.document.type).toBe('report')
      const page = data.document.page
      expect(page.width).toBeGreaterThan(0)
      expect(page.height).toBeGreaterThan(0)
      expect(page.unit).toBe('mm')
      // 页面尺寸与卡片标注一致
      expect(page.width).toBe(tpl.pageW)
      expect(page.height).toBe(tpl.pageH)

      const sections = data.document.sections
      expect(sections.some((s) => s.type === 'body')).toBe(true)

      // 控件 id 全局唯一 + 几何合法
      const ids = new Set<string>()
      const walk = (comps: unknown[]): void => {
        for (const c of comps as Array<{ id: string; left: number; top: number; width: number; height: number }>) {
          expect(ids.has(c.id)).toBe(false)
          ids.add(c.id)
          expect(c.left).toBeGreaterThanOrEqual(0)
          expect(c.width).toBeGreaterThan(0)
        }
      }
      for (const s of sections) walk(s.components as unknown[])
    }
  })

  it('含二维码的模板经 layout → renderHtml 能产出 SVG（开箱即用）', async () => {
    const tpl = MARKET_TEMPLATES.find((t) => t.id === 'market-qr-receipt')
    expect(tpl).toBeDefined()
    // 全部含 qrcode 控件的模板都验证一遍
    const qrTemplates = MARKET_TEMPLATES.filter((t) =>
      t.build().document.sections.some((s) =>
        (s.components as Array<{ type: string }>).some((c) => c.type === 'qrcode'),
      ),
    )
    expect(qrTemplates.length).toBeGreaterThanOrEqual(3)

    for (const qrTpl of qrTemplates) {
      const result = await layout(qrTpl.build(), {}, { measurer: createCjkMeasurer() })
      const html = renderHtml(result, { screen: false })
      // qrcode 库输出 SVG 路径；html-renderer 以 op-code 包裹
      expect(html).toContain('op-code')
      expect(html).toMatch(/<svg/)
    }
  })
})
