/**
 * 打印载荷构建 —— 模板 + 数据 → 推送给本地打印客户端的文档内容
 *
 * 推送格式规则（主任定，2026-08-12）：
 * - **单页** → SVG（矢量原文，utf8）。体积小、矢量无损，客户端可直接送打印或转 EMF。
 * - **多页** → PDF（base64）。PDF 天然多页，base64 后可走 JSON 传输。
 *
 * 只 render 一次：先 `renderDocument()` 拿到 LayoutResult 判定页数，
 * 再按页数走对应导出器，避免 `exportDocument()` 内部二次分页。
 */
import type { RenderRequest } from '@/core/sdk'
import { renderDocument } from '@/core/sdk'
import { documentToPdf, documentToSvgString } from '@/core/export-engine'
import type { FontFaceDef } from '@/core/export-engine'
import { templateUsedFonts, toExportFontDefs } from '@/core/fonts/loader'
import { blobToBase64 } from './client'
import type { PrintPayloadEncoding, PrintPayloadFormat } from './types'

export interface PrintPayload {
  /** 载荷格式：单页 svg / 多页 pdf */
  format: PrintPayloadFormat
  /** 载荷编码：svg=utf8 / pdf=base64 */
  encoding: PrintPayloadEncoding
  /** 文档内容 */
  content: string
  /** 总页数 */
  pages: number
  /** 载荷字符长度（UI 展示体积用） */
  bytes: number
}

export interface BuildPrintPayloadOptions {
  /** PDF 位图底图倍率，默认 2（192dpi） */
  scale?: number
  /**
   * 需要内联进 SVG 的字体。不传则自动从模板里提取用到的内置字体，
   * 保证客户端渲染 SVG 时中文不掉字（SVG 是隔离上下文，看不到宿主 @font-face）。
   */
  fonts?: FontFaceDef[]
}

/** 构建推送载荷（单页 SVG / 多页 PDF-base64） */
export async function buildPrintPayload(
  request: RenderRequest,
  options: BuildPrintPayloadOptions = {},
): Promise<PrintPayload> {
  const result = await renderDocument(request)
  const pages = result.pages.length
  const deco = request.output?.pageDecoration

  if (pages <= 1) {
    const fonts = options.fonts ?? toExportFontDefs(templateUsedFonts(request.template))
    const svg = await documentToSvgString(result, fonts.length ? fonts : undefined, deco)
    return { format: 'svg', encoding: 'utf8', content: svg, pages: Math.max(pages, 1), bytes: svg.length }
  }

  const blob = await documentToPdf(result, { scale: options.scale ?? 2, pageDecoration: deco })
  const base64 = await blobToBase64(blob)
  return { format: 'pdf', encoding: 'base64', content: base64, pages, bytes: base64.length }
}

/** 人类可读体积（UI 提示用） */
export function formatPayloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
