/**
 * PrintZone —— 页眉/页脚区域控件（《设计方案》§5.14）
 *
 * 画布表现：一条横向锁定色带（页顶或页底），
 * - 自身不可移动/旋转（位置由页顶/页底固定）
 * - 仅保留内边缘一个 resize 手柄改高度（header=下边缘 mb，footer=上边缘 mt）
 * - 单例：每页最多一个 header + 一个 footer（由 CanvasDesigner.addZone 保证）
 * - 序列化目标是 sections[header/footer]，不进 body.components
 */
import { Rect } from 'fabric'
import type { ZoneControl } from '@/types/control'
import { mm, px, round2, type IPrintObject } from './PrintObject'

export class PrintZone extends Rect implements IPrintObject {
  controlId: string
  controlType = 'zone' as const

  zone: 'header' | 'footer'
  repeat = true

  constructor(control: ZoneControl, pageWidthMm: number, pageHeightMm: number) {
    const h = mm(control.zoneHeight)
    super({
      left: 0,
      top: control.zone === 'header' ? 0 : mm(pageHeightMm) - h,
      width: mm(pageWidthMm),
      height: h,
      fill: control.zone === 'header' ? 'rgba(22,119,255,0.05)' : 'rgba(22,119,255,0.04)',
      stroke: 'rgba(22,119,255,0.45)',
      strokeWidth: 1,
      strokeDashArray: [6, 3],
      // 位置锁定：不可移动/旋转/横拉
      lockMovementX: true,
      lockMovementY: true,
      lockRotation: true,
      hasControls: true,
      hasBorders: true,
      selectable: true,
    })
    this.controlId = control.id
    this.zone = control.zone
    this.repeat = control.repeat ?? true
    this.restrictControls()
  }

  /** 只留内边缘手柄：header 用底部中点(mb)，footer 用顶部中点(mt) */
  private restrictControls(): void {
    const edge = this.zone === 'header' ? 'mb' : 'mt'
    const controls = { ...this.controls }
    for (const key of Object.keys(controls)) {
      if (key !== edge) {
        // 其余手柄禁用
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete controls[key]
      }
    }
    this.controls = controls
  }

  /** 页面尺寸变化时由 CanvasDesigner 调用，重贴页顶/页底 */
  relayout(pageWidthMm: number, pageHeightMm: number): void {
    const h = this.height * this.scaleY
    this.set({
      left: 0,
      width: mm(pageWidthMm),
      scaleX: 1,
      scaleY: 1,
      height: h,
      top: this.zone === 'header' ? 0 : mm(pageHeightMm) - h,
    })
    this.setCoords()
  }

  get zoneHeightMm(): number {
    return round2(px(this.height * this.scaleY))
  }

  toControl(): ZoneControl {
    return {
      id: this.controlId,
      type: 'zone',
      zone: this.zone,
      left: 0,
      top: 0,
      width: round2(px(this.getScaledWidth())),
      height: this.zoneHeightMm,
      zoneHeight: this.zoneHeightMm,
      repeat: this.repeat,
      printable: true,
      children: [], // 子组件由 CanvasDesigner.serialize 按几何归属填充
    }
  }

  applyControlProps(control: ZoneControl): void {
    this.repeat = control.repeat ?? true
    if (control.zoneHeight && control.zoneHeight !== this.zoneHeightMm) {
      const pageH = this.canvas ? px(this.canvas.getHeight()) : 0
      this.set({
        scaleY: 1,
        height: mm(control.zoneHeight),
        top: this.zone === 'header' ? 0 : mm(pageH) - mm(control.zoneHeight),
      })
      this.setCoords()
    }
    this.canvas?.requestRenderAll()
  }
}
