/**
 * 本地打印机客户端 HTTP 客户端 —— 纯 TypeScript，零框架依赖
 *
 * 所有方法都显式接收 baseUrl（由 `@/config/printer` 解析），
 * 便于 headless / 单测直接注入，不隐式读全局配置。
 */
import {
  PrintClientError,
  type PrinterHealth,
  type PrinterInfo,
  type PrinterListResponse,
  type PrintJobRequest,
  type PrintJobResponse,
} from './types'

/** 出厂默认地址（用户未配置时使用） */
export const DEFAULT_PRINTER_BASE_URL = 'http://127.0.0.1:18888'

/** 探测类请求默认超时（ms）—— 本机服务，短超时快速失败 */
export const PROBE_TIMEOUT_MS = 3000

/** 提交打印任务默认超时（ms）—— 大文档 base64 传输留足时间 */
export const SUBMIT_TIMEOUT_MS = 30000

/** 去掉尾部斜杠，拼接路径 */
function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

/**
 * 带超时 + 错误分类的 fetch。
 * 用手工 AbortController 而非 AbortSignal.timeout，才能区分「超时」与「连不上」。
 */
async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)

  let res: Response
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal })
  } catch {
    if (timedOut) {
      throw new PrintClientError('timeout', `请求超时（${timeoutMs}ms）：${url}`)
    }
    throw new PrintClientError('network', `无法连接打印客户端：${url}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new PrintClientError('http', `HTTP ${res.status} ${res.statusText}`, res.status)
  }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new PrintClientError('parse', '响应不是合法 JSON')
  }
  if (json === null || typeof json !== 'object') {
    throw new PrintClientError('parse', '响应结构异常')
  }
  return json as T
}

/* ------------------------------ GET /health ------------------------------ */

/**
 * 健康检查。成功返回服务版本、打印机数量、运行时长。
 * @throws PrintClientError 连接失败 / 超时 / ok:false
 */
export async function checkHealth(
  baseUrl: string = DEFAULT_PRINTER_BASE_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<PrinterHealth> {
  const data = await request<Partial<PrinterHealth>>(
    joinUrl(baseUrl, '/health'),
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
  )
  if (data.ok !== true) {
    throw new PrintClientError('service', '打印客户端报告服务异常（ok=false）')
  }
  return {
    app: data.app ?? 'Unknown',
    ok: true,
    printers: typeof data.printers === 'number' ? data.printers : 0,
    time: data.time ?? '',
    uptimeSec: typeof data.uptimeSec === 'number' ? data.uptimeSec : 0,
    version: data.version ?? '',
  }
}

/* ------------------------------ GET /printers ------------------------------ */

/** 单台打印机字段归一化（服务端字段缺失时给安全默认，避免 UI 崩） */
function normalizePrinter(raw: Partial<PrinterInfo>, index: number): PrinterInfo {
  return {
    driver: raw.driver ?? '',
    isDefault: raw.isDefault === true,
    isOnline: raw.isOnline !== false,
    kind: raw.kind === 'virtual' || raw.kind === 'ticket' ? raw.kind : 'common',
    maxDpi: typeof raw.maxDpi === 'number' ? raw.maxDpi : 0,
    name: raw.name ?? `未命名打印机 ${index + 1}`,
    status: raw.status === 'error' ? 'error' : 'idle',
    supportsColor: raw.supportsColor === true,
    supportsDuplex: raw.supportsDuplex === true,
    trays: Array.isArray(raw.trays) ? raw.trays.filter((t): t is string => typeof t === 'string') : [],
  }
}

/**
 * 获取打印机列表。
 * 注意：**以 `printers` 数组长度为准**，服务端的 `count` 字段仅供参考（实测可能不一致）。
 */
export async function listPrinters(
  baseUrl: string = DEFAULT_PRINTER_BASE_URL,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<PrinterInfo[]> {
  const data = await request<Partial<PrinterListResponse>>(
    joinUrl(baseUrl, '/printers'),
    { method: 'GET', headers: { Accept: 'application/json' } },
    timeoutMs,
  )
  if (data.ok === false) {
    throw new PrintClientError('service', '打印客户端未能枚举打印机')
  }
  if (!Array.isArray(data.printers)) {
    throw new PrintClientError('parse', '响应缺少 printers 数组')
  }
  return data.printers.map((p, i) => normalizePrinter(p ?? {}, i))
}

/* ------------------------------ POST /print ------------------------------ */

/**
 * 提交打印任务。
 * 载荷约定（见《打印机数据交互文档》）：
 * - 单页 → `format:'svg'`，`encoding:'utf8'`，content 为 SVG 原文
 * - 多页 → `format:'pdf'`，`encoding:'base64'`，content 为 base64（无 data: 前缀）
 */
export async function submitPrintJob(
  job: PrintJobRequest,
  baseUrl: string = DEFAULT_PRINTER_BASE_URL,
  timeoutMs: number = SUBMIT_TIMEOUT_MS,
): Promise<PrintJobResponse> {
  const data = await request<Partial<PrintJobResponse>>(
    joinUrl(baseUrl, '/print'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(job),
    },
    timeoutMs,
  )
  if (data.ok !== true) {
    throw new PrintClientError('service', data.message || '打印客户端拒绝了本次任务')
  }
  return { ok: true, jobId: data.jobId, message: data.message }
}

/* ------------------------------ 工具 ------------------------------ */

/**
 * Blob → base64（不含 `data:*;base64,` 前缀）。
 * 用于把 PDF 二进制转成可 JSON 传输的字符串。
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取导出文件失败'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/** Blob → utf8 文本（用于 SVG 载荷） */
export function blobToText(blob: Blob): Promise<string> {
  return blob.text()
}
