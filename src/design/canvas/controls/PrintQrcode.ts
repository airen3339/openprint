/**
 * PrintQrcode —— 二维码控件（§5.7，qrcode 库离屏渲染）
 */
import { FabricImage } from 'fabric'
import QRCode from 'qrcode'
import type { QrcodeControl } from '@/types/control'
import { mm, readBaseGeometry, type IPrintObject } from './PrintObject'

export class PrintQrcode extends FabricImage implements IPrintObject {
  controlId: string
  controlType = 'qrcode' as const
  zoneId?: string
  printable = true
  visibleIf?: string
  controlName?: string

  binding?: string
  textValue?: string
  errorLevel: 'L' | 'M' | 'Q' | 'H' = 'M'

  constructor(control: QrcodeControl) {
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
    this.errorLevel = control.errorLevel ?? 'M'
    this.printable = control.printable ?? true
    this.visibleIf = control.visibleIf
    this.controlName = control.name
    this.set({ width: mm(control.width), height: mm(control.height) })
    void this.regenerate()
  }

  async regenerate(): Promise<void> {
    // 目标显示尺寸（逻辑 px）；setElement 会重置 width/height，先保存
    const targetW = this.getScaledWidth() || 1
    const targetH = this.getScaledHeight() || 1
    const text = this.textValue ?? (this.binding ? `{{${this.binding}}}` : 'https://open-print.dev')
    const canvas = document.createElement('canvas')
    try {
      await QRCode.toCanvas(canvas, text, {
        width: Math.ceil(Math.max(targetW, targetH) * 2), // 2x 渲染保证缩放清晰
        margin: 1,
        errorCorrectionLevel: this.errorLevel,
      })
      this.setElement(canvas)
      this.set({ scaleX: targetW / canvas.width, scaleY: targetH / canvas.height })
    } catch {
      // 内容过长等异常：保持空白占位
    }
    this.setCoords()
    this.canvas?.requestRenderAll()
  }

  toControl(): QrcodeControl {
    return {
      ...readBaseGeometry(this),
      type: 'qrcode',
      binding: this.binding,
      value: this.textValue,
      errorLevel: this.errorLevel,
      printable: this.printable,
      visibleIf: this.visibleIf,
      name: this.controlName,
    }
  }

  applyControlProps(control: QrcodeControl): void {
    this.binding = control.binding
    this.textValue = control.value
    this.errorLevel = control.errorLevel ?? 'M'
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
