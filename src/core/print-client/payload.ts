/**
 * 打印载荷构建 —— 模板 + 数据 → 推送给本地打印客户端的文档内容
 *
 * 推送格式规则（2026-08-13 最终定案）：
 * - **统一推 PDF（base64）**，不论单页或多页。
 *
 * 演进历程：
 * - 早期单页走 SVG 原文 → Qt `QSvgRenderer` 不解析 foreignObject/HTML/CSS，打不出内容（已废弃）。
 * - 中间试过单页走 JPG → 但 JPG 是单张位图、没有页面尺寸/DPI 元数据，不如 PDF 适合打印；
 *   且用户希望打印格式统一便于客户端处理。最终回到统一 PDF。
 *
 * 清晰度优先：PDF 内部位图底图默认 **PNG（无损·最高清）**，文字/线条边缘真正锐利，
 * 打印推荐。体积较大（纯文字页 ~10+ MB）；体积敏感场景可传 `imageType: 'jpeg'`。
 */
import type { RenderRequest } from '@/core/sdk'
import { renderDocument } from '@/core/sdk'
import { documentToPdf } from '@/core/export-engine'
import { blobToBase64 } from './client'

export interface PrintPayload {
  /** 载荷格式：恒为 pdf */
  format: 'pdf'
  /** 载荷编码：恒为 base64 */
  encoding: 'base64'
  /** PDF 的 base64 字符串（不含 data: 前缀） */
  content: string
  /** 总页数 */
  pages: number
  /** 载荷字符长度（UI 展示体积用） */
  bytes: number
}

export interface BuildPrintPayloadOptions {
  /** 位图倍率，默认 3（288dpi·最高清）；要更锐可传 4 */
  scale?: number
  /**
   * 多页 PDF 的位图底图压缩格式（默认 `'png'`，无损最清晰）：
   * - `'png'`：无损，文字/线条边缘锐利，打印推荐；
   * - `'jpeg'`：体积小，仅体积敏感场景。
   */
  imageType?: 'jpeg' | 'png'
}

/**
 * 构建推送载荷（统一 PDF-base64）。
 *
 * 不论单页或多页，都先 `renderDocument()` → `documentToPdf()`（浏览器内用 Chromium
 * 栅格化 foreignObject 内容成位图底图，默认 PNG 无损最高清）→ `blobToBase64()`。
 * 本地客户端拿到的就是可直接 `QPrinter` 打印的 PDF 字节流。
 */
export async function buildPrintPayload(
  request: RenderRequest,
  options: BuildPrintPayloadOptions = {},
): Promise<PrintPayload> {
  const result = await renderDocument(request)
  const pages = result.pages.length
  const deco = request.output?.pageDecoration

  const blob = await documentToPdf(result, {
    scale: options.scale ?? 3,
    imageType: options.imageType ?? 'png',
    pageDecoration: deco,
  })
  const base64 = await blobToBase64(blob)
  return {
    format: 'pdf',
    encoding: 'base64',
    content: base64,
    pages: Math.max(pages, 1),
    bytes: base64.length,
  }
}

/** 人类可读体积（UI 提示用） */
export function formatPayloadSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
