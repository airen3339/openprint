/**
 * PrintBarcode —— 条形码控件（§5.7，bwip-js 离屏渲染）
 * 设计期用绑定路径占位文本渲染，运行期由渲染引擎注入真实值。
 */
import { FabricImage } from 'fabric'
import type { BarcodeControl } from '@/types/control'
import { mm, px, readBaseGeometry, type IPrintObject } from './PrintObject'
import { drawBarcode } from '../barcode-draw'

export class PrintBarcode extends FabricImage implements IPrintObject {
  controlId: string
  controlType = 'barcode' as const
  zoneId?: string
  printable = true
  visibleIf?: string
  controlName?: string

  binding?: string
  textValue?: string
  format = 'CODE128'
  showText = true

  constructor(control: BarcodeControl) {
    super(document.createElement('canvas'), {
      left: mm(control.left),
      top: mm(control.top),
      angle: control.angle ?? 0,
      lockMovementX: control.locked,
      lockMovementY: control.locked,
    })
    this.controlId = control.id
    this.binding = control.binding
    this.textValue = control.value
    this.format = control.format ?? 'CODE128'
    this.showText = control.showText ?? true
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    // 初始尺寸（未缩放），regenerate 会按它换算 scale
    this.set({ width: mm(control.width), height: mm(control.height) })
    void this.regenerate()
  }

  /** 重新渲染条码位图，并按控件宽高缩放显示 */
  async regenerate(): Promise<void> {
    const w = this.width || 1
    const h = this.height || 1
    const text = this.textValue ?? (this.binding ? `{{${this.binding}}}` : '0123456789')
    // 绑定占位符含中文/大括号无法编码，设计期用示例码代替
    const encodable = /[{}\u4e00-\u9fa5]/.test(text) ? 'DEMO123456' : text
    // 按控件几何反算条码条高度（mm）：条码条占 60%，剩 40% 留给文字行（textsize=12）+ 上下留白。
    // 这样 bwip-js 直接按目标尺寸渲染，canvas 自然高度 ≈ 控件高度，scaleY ≈ 1，文字不被压扁。
    const controlHeightMM = px(h)
    const barHeightMM = Math.max(2, controlHeightMM * 0.6)
    const paddingMM = Math.max(0.5, controlHeightMM * 0.04)
    const canvas = await drawBarcode({
      format: this.format,
      text: encodable,
      showText: this.showText,
      barHeightMM,
      paddingMM,
    })
    if (canvas) {
      this.setElement(canvas)
      // 等比缩放（meet 居中）填满控件框：保持条码条与下方人眼可读数字的宽高比，
      // 避免把控件拉宽 / 拉高时被横向或纵向拉伸变形。
      // 与预览端 data-binder 的 svg preserveAspectRatio="xMidYMid meet" 行为一致，所见即所得。
      const natW = canvas.width || 1
      const natH = canvas.height || 1
      const s = Math.min(w / natW, h / natH)
      this.set({ scaleX: s, scaleY: s })
    }
    this.setCoords()
    this.canvas?.requestRenderAll()
  }

  toControl(): BarcodeControl {
    return {
      ...readBaseGeometry(this),
      type: 'barcode',
      binding: this.binding,
      value: this.textValue,
      format: this.format,
      showText: this.showText,
      printable: this.printable,
      visibleIf: this.visibleIf,
      name: this.controlName,
    }
  }

  applyControlProps(control: BarcodeControl): void {
    this.binding = control.binding
    this.textValue = control.value
    this.format = control.format ?? 'CODE128'
    this.showText = control.showText ?? true
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    this.set({
      lockMovementX: control.locked,
      lockMovementY: control.locked,
      scaleX: 1,
      scaleY: 1,
      width: mm(control.width),
      height: mm(control.height),
    })
    void this.regenerate()
  }
}
