/**
 * DataBinder —— 控件 + 数据 → 渲染就绪内容
 * 真理源：《OpenPrint-设计方案.md》§5.2 / §5.4a（printable）/ §5.6（visibleIf）/ §5.7 / §5.8
 *
 * 职责边界：
 * - 只负责"内容是什么"，不负责"放在哪一页"（那是 pagination-engine 的事）
 * - 所有异步资源（二维码 SVG）在此解析完成，后续渲染全同步
 * - 条码/二维码统一输出 **SVG 矢量**（§5.7）：打印用位图会糊，扫码枪可能读不出
 */
import * as BwipJs from '@bwip-js/generic'
import DOMPurify from 'dompurify'
import QRCode from 'qrcode'

import type {
  AnyControl,
  BarcodeControl,
  ChartControl,
  ImageControl,
  QrcodeControl,
  RichTextControl,
  TextControl,
} from '@/types/control'
import { interpolate, evaluateVisible, resolveBinding, stringifyValue, formatCellValue } from './expression'
import type { EvalContext, ResolvedContent, RenderWarning } from './types'
import { renderChartControl } from '@/core/chartkit'

/* ------------------------------ 可见性判定 ------------------------------ */

/**
 * 渲染期是否输出该控件。
 * §5.4a：`printable:false` 渲染时跳过，但**设计画布仍可编辑**（所以只在这里过滤）。
 */
export function isControlPrintable(control: AnyControl, ctx: EvalContext): boolean {
  if (control.printable === false) return false
  return evaluateVisible(control.visibleIf, ctx)
}

/* -------------------------------- 文本 -------------------------------- */

/**
 * 文本取值优先级：expression > binding > value。
 * 注意 `value` 里也允许写 `{{}}`（用户在属性面板静态文本里手打变量是常见操作），
 * 所以静态文本同样过一遍插值。
 */
export function resolveTextValue(
  control: TextControl,
  ctx: EvalContext,
): { text: string; errors: string[] } {
  if (control.expression) return interpolate(control.expression, ctx)
  if (control.binding) {
    // binding 模式：按控件 format 格式化（expression 模式请用 {{field | date:'...'}} 过滤器）
    const raw = resolveBinding(control.binding, ctx)
    return { text: formatCellValue(raw, control.format), errors: [] }
  }
  return interpolate(control.value ?? '', ctx)
}

/* -------------------------------- 图片 -------------------------------- */

function resolveImageSrc(control: ImageControl, ctx: EvalContext): string {
  const v = control.value
  if (!v || !v.content) return ''
  switch (v.mode) {
    case 'binding': {
      const raw = resolveBinding(v.content, ctx)
      return raw === null || raw === undefined ? '' : String(raw)
    }
    case 'inline':
    case 'url':
    case 'asset':
    default:
      return v.content
  }
}

/* ------------------------------ 条码 / 二维码 ----------------------------- */

function resolveCodeText(control: BarcodeControl | QrcodeControl, ctx: EvalContext): string {
  if (control.binding) {
    const v = resolveBinding(control.binding, ctx)
    if (v !== null && v !== undefined && v !== '') return String(v)
  }
  if (control.value) return interpolate(control.value, ctx).text
  // 既没 binding 也没 value：设计画布兜底示例码，预览同样兜底，避免空白
  return control.type === 'qrcode' ? 'https://openprint.dev' : '0123456789'
}

/**
 * 让 SVG 自适应控件尺寸：去掉固定 width/height，保留 viewBox 由外层容器缩放。
 * bwip-js / qrcode 输出的 SVG 都带写死的 width/height，直接嵌入会溢出控件框。
 */
function makeSvgResponsive(svg: string): string {
  return svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/i, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/i, '<svg$1')
    .replace(/<svg\b/i, '<svg preserveAspectRatio="xMidYMid meet" width="100%" height="100%"')
}

function renderBarcodeSvg(control: BarcodeControl, text: string): string {
  // 与设计画布 barcode-draw.ts 保持一致：按控件几何反算条码条高度，让文字行不被压扁
  const controlHeightMM = control.height ?? 30
  const barHeightMM = Math.max(2, controlHeightMM * 0.6)
  const paddingMM = Math.max(0.5, controlHeightMM * 0.04)
  const svg = BwipJs.toSVG({
    bcid: (control.format ?? 'code128').toLowerCase(),
    text,
    scale: 2,
    height: barHeightMM,
    paddingtop: paddingMM,
    paddingbottom: paddingMM,
    includetext: control.showText ?? false,
    textxalign: 'center',
    textsize: 12,
  })
  return makeSvgResponsive(svg)
}

async function renderQrcodeSvg(control: QrcodeControl, text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: control.errorLevel ?? 'M',
    margin: 0,
  })
  return makeSvgResponsive(svg)
}

/* ------------------------------- 富文本消毒 ------------------------------ */

/** §11.2：Renderer 输出前必须对绑定内容消毒，防模板注入 XSS */
function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

/* ------------------------------ 内容解析总入口 ----------------------------- */

export interface ResolvedControlContent {
  content: ResolvedContent
  warnings: RenderWarning[]
}

/**
 * 把单个控件解析为渲染就绪内容。
 * 任何失败都降级为 placeholder + warning —— **绝不静默丢内容**，
 * 否则用户拿到一张缺字段的单据却毫不知情，这在 ERP 场景是事故。
 */
export async function resolveControlContent(
  control: AnyControl,
  ctx: EvalContext,
): Promise<ResolvedControlContent> {
  const warnings: RenderWarning[] = []

  switch (control.type) {
    case 'text': {
      const { text, errors } = resolveTextValue(control, ctx)
      for (const message of errors) {
        warnings.push({ code: 'EXPRESSION_ERROR', message, controlId: control.id })
      }
      if (!text && control.binding) {
        warnings.push({
          code: 'BINDING_MISSING',
          message: `字段 "${control.binding}" 在数据中为空`,
          controlId: control.id,
        })
      }
      return { content: { kind: 'text', text }, warnings }
    }

    case 'richtext': {
      const raw = (control as RichTextControl).value ?? ''
      const { text, errors } = interpolate(raw, ctx)
      for (const message of errors) {
        warnings.push({ code: 'EXPRESSION_ERROR', message, controlId: control.id })
      }
      return { content: { kind: 'html', html: sanitizeRichText(text) }, warnings }
    }

    case 'image': {
      const src = resolveImageSrc(control, ctx)
      if (!src) {
        warnings.push({
          code: 'IMAGE_UNRESOLVED',
          message: '图片来源为空',
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '图片' }, warnings }
      }
      return { content: { kind: 'image', src }, warnings }
    }

    case 'barcode': {
      const text = resolveCodeText(control, ctx)
      if (!text) {
        warnings.push({ code: 'BARCODE_FAILED', message: '条码内容为空', controlId: control.id })
        return { content: { kind: 'placeholder', label: '条码' }, warnings }
      }
      try {
        return { content: { kind: 'svg', svg: renderBarcodeSvg(control, text) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'BARCODE_FAILED',
          message: `条码生成失败（${control.format ?? 'code128'}）：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '条码' }, warnings }
      }
    }

    case 'qrcode': {
      const text = resolveCodeText(control, ctx)
      if (!text) {
        warnings.push({ code: 'BARCODE_FAILED', message: '二维码内容为空', controlId: control.id })
        return { content: { kind: 'placeholder', label: '二维码' }, warnings }
      }
      try {
        return { content: { kind: 'svg', svg: await renderQrcodeSvg(control, text) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'BARCODE_FAILED',
          message: `二维码生成失败：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '二维码' }, warnings }
      }
    }

    case 'rect':
    case 'line':
      return { content: { kind: 'shape' }, warnings }

    case 'chart': {
      // 原生 SVG 图表（零依赖）：与条码同理走矢量 svg，打印不糊。
      try {
        return { content: { kind: 'svg', svg: renderChartControl(control as ChartControl) }, warnings }
      } catch (e) {
        warnings.push({
          code: 'CHART_FAILED',
          message: `图表生成失败：${e instanceof Error ? e.message : String(e)}`,
          controlId: control.id,
        })
        return { content: { kind: 'placeholder', label: '图表' }, warnings }
      }
    }

    default:
      // table / zone 不走这里（由 table-engine / pagination-engine 处理）
      return { content: { kind: 'placeholder', label: control.type }, warnings }
  }
}
