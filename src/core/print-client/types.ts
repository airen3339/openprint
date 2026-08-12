/**
 * 本地打印机客户端服务 —— 协议类型
 *
 * 对接本机常驻的打印客户端（默认 http://127.0.0.1:18888），提供：
 *   GET  /health   服务健康与版本
 *   GET  /printers 打印机列表
 *   POST /print    提交打印任务（单页 SVG / 多页 PDF-base64）
 *
 * 主任铁律：无后端全链路可用 —— 客户端不可达时设计器一切功能照常，只是不能推送打印。
 */

/* ------------------------------ /health ------------------------------ */

/** GET /health 响应体 */
export interface PrinterHealth {
  /** 客户端应用名，如 "OpenPrint" */
  app: string
  /** 服务是否正常 */
  ok: boolean
  /** 当前可用打印机数量 */
  printers: number
  /** 服务端时间（ISO 字符串） */
  time: string
  /** 已运行秒数 */
  uptimeSec: number
  /** 客户端版本号 */
  version: string
}

/* ------------------------------ /printers ------------------------------ */

/** 打印机类型：虚拟打印机 / 普通打印机 / 票据打印机 */
export type PrinterKind = 'virtual' | 'common' | 'ticket'

/** 打印机运行状态 */
export type PrinterState = 'idle' | 'error'

/** 单台打印机描述 */
export interface PrinterInfo {
  /** 驱动名 */
  driver: string
  /** 是否系统默认打印机 */
  isDefault: boolean
  /** 是否在线 */
  isOnline: boolean
  /** 打印机类型 */
  kind: PrinterKind
  /** 最大分辨率（DPI） */
  maxDpi: number
  /** 打印机名（提交任务时的唯一标识） */
  name: string
  /** 运行状态 */
  status: PrinterState
  /** 是否支持彩色 */
  supportsColor: boolean
  /** 是否支持双面 */
  supportsDuplex: boolean
  /** 纸盒列表 */
  trays: string[]
}

/** GET /printers 响应体 */
export interface PrinterListResponse {
  /** 服务端声明的数量（可能与 printers.length 不一致，以数组为准） */
  count: number
  ok: boolean
  printers: PrinterInfo[]
}

/* ------------------------------ /print ------------------------------ */

/** 推送载荷格式：单页 SVG（矢量文本），多页 PDF（base64） */
export type PrintPayloadFormat = 'svg' | 'pdf'

/** 载荷编码：svg 用 utf8 原文，pdf 用 base64 */
export type PrintPayloadEncoding = 'utf8' | 'base64'

/** POST /print 请求体 */
export interface PrintJobRequest {
  /** 任务名（用于打印队列显示） */
  taskName: string
  /** 目标打印机名（取自 /printers 的 name；留空由客户端用系统默认） */
  printer: string
  /** 载荷格式 */
  format: PrintPayloadFormat
  /** 载荷编码 */
  encoding: PrintPayloadEncoding
  /** 文档内容：svg=XML 原文；pdf=base64（不含 data: 前缀） */
  content: string
  /** 文档总页数 */
  pages: number
  /** 打印份数 */
  copies: number
  /** 纸张方向 */
  orientation: 'portrait' | 'landscape'
  /** 是否双面 */
  duplex: boolean
  /** 是否彩色（false = 黑白） */
  color: boolean
}

/** POST /print 响应体 */
export interface PrintJobResponse {
  ok: boolean
  /** 客户端队列任务 ID */
  jobId?: string
  /** 服务端消息（失败原因等） */
  message?: string
}

/* ------------------------------ 错误 ------------------------------ */

/**
 * 错误分类：
 * - `timeout`  请求超时（客户端未响应）
 * - `network`  连接失败（服务未启动 / 端口不通 / CORS 拦截）
 * - `http`     HTTP 非 2xx
 * - `parse`    响应不是合法 JSON 或字段缺失
 * - `service`  服务端返回 ok:false
 */
export type PrintClientErrorCode = 'timeout' | 'network' | 'http' | 'parse' | 'service'

/** 打印客户端统一错误 */
export class PrintClientError extends Error {
  readonly code: PrintClientErrorCode
  readonly status?: number

  constructor(code: PrintClientErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'PrintClientError'
    this.code = code
    this.status = status
  }
}

/** 把任意异常转成人话（用于 UI 提示） */
export function describePrintError(err: unknown): string {
  if (err instanceof PrintClientError) {
    switch (err.code) {
      case 'timeout':
        return '打印客户端响应超时，请确认服务未卡死'
      case 'network':
        return '无法连接打印客户端，请确认本机打印服务已启动'
      case 'http':
        return `打印客户端返回错误（HTTP ${err.status ?? '?'}）`
      case 'parse':
        return '打印客户端返回数据格式异常'
      case 'service':
        return err.message || '打印客户端拒绝了本次请求'
    }
  }
  return err instanceof Error ? err.message : String(err)
}
