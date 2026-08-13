/**
 * 本地打印机客户端服务层入口
 *
 * 用法：
 * ```ts
 * import { checkHealth, listPrinters, submitPrintJob } from '@/core/print-client'
 * import { resolvePrinterBaseUrl } from '@/config/printer'
 *
 * const base = resolvePrinterBaseUrl()
 * const health = await checkHealth(base)
 * const printers = await listPrinters(base)
 * ```
 */
export {
  DEFAULT_PRINTER_BASE_URL,
  PROBE_TIMEOUT_MS,
  SUBMIT_TIMEOUT_MS,
  checkHealth,
  listPrinters,
  submitPrintJob,
  generateJobId,
  blobToBase64,
  blobToText,
} from './client'

export { PrintClientError, describePrintError } from './types'

export { buildPrintPayload, formatPayloadSize } from './payload'
export type { PrintPayload, BuildPrintPayloadOptions } from './payload'

export type {
  PrinterHealth,
  PrinterInfo,
  PrinterKind,
  PrinterState,
  PrinterListResponse,
  PrintPayloadFormat,
  PrintPayloadEncoding,
  PrintJobRequest,
  PrintJobResponse,
  PrintClientErrorCode,
} from './types'
