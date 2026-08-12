<script setup lang="ts">
/**
 * PrintDialog —— 打印配置弹窗
 *
 * 本机客户端模式对接本地打印服务（默认 http://127.0.0.1:18888，地址可在设置里覆盖）：
 *   GET  /health   判活 + 版本
 *   GET  /printers 打印机列表（能力/状态/纸盒）
 *   POST /print    推送任务
 *
 * 推送格式（主任定）：**单页 → SVG 原文；多页 → PDF 转 base64**。
 * 载荷由 `buildPrintPayload()` 统一构建，与预览/导出共用同一条 render 链路，保证三者一致。
 *
 * 主任铁律：无后端全链路可用 —— 客户端不可达时只是不能出纸，设计器功能不受影响。
 */
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpin,
  NTag,
  NText,
  NTooltip,
  useMessage,
} from 'naive-ui'
import { useDesignerStore } from '@/design/stores/designer'
import { useDataSourceStore } from '@/design/stores/dataSource'
import { buildPreviewData } from '@/design/preview/preview-data'
import { usePrinterProbe } from '@/design/composables/usePrinterProbe'
import {
  buildPrintPayload,
  describePrintError,
  formatPayloadSize,
  submitPrintJob,
  type PrinterInfo,
} from '@/core/print-client'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useDesignerStore()
const dsStore = useDataSourceStore()
const message = useMessage()

/* ------------------------------ 打印模式 ------------------------------ */
type PrintTarget = 'local' | 'cloud'
const target = ref<PrintTarget>('local')

/* ------------------------------ 本机客户端探测（共享单例） ------------------------------ */
const {
  state: probeState,
  health: probeHealth,
  printers: localPrinters,
  defaultPrinter,
  errorText: probeError,
  baseUrl: printerBase,
  probe: runProbe,
} = usePrinterProbe()

/* ------------------------------ 云打印探测 ------------------------------ */
type PrinterStatus = 'checking' | 'connected' | 'disconnected'
const cloudStatus = ref<PrinterStatus>('checking')
const cloudPrinters = ref<Array<{ label: string; value: string }>>([])
const cloudError = ref('')

/* ------------------------------ 统一状态 ------------------------------ */
const printerStatus = computed<PrinterStatus>(() => {
  if (target.value === 'cloud') return cloudStatus.value
  switch (probeState.value) {
    case 'connected':
      return localPrinters.value.length > 0 ? 'connected' : 'disconnected'
    case 'disconnected':
      return 'disconnected'
    default:
      return 'checking'
  }
})

const isConnected = computed(() => printerStatus.value === 'connected')
/** 未连接时禁用下方所有配置选项（参考可看但不可选） */
const formDisabled = computed(() => !isConnected.value)

const statusTagText = computed(() => {
  switch (printerStatus.value) {
    case 'checking':
      return '检测中…'
    case 'connected':
      return target.value === 'local'
        ? `已连接 · ${localPrinters.value.length} 台打印机`
        : '已连接云打印服务'
    case 'disconnected':
      return target.value === 'local' ? '客户端不可达' : '无法连接云打印服务'
  }
})

const statusTagType = computed(() => {
  switch (printerStatus.value) {
    case 'checking':
      return 'warning' as const
    case 'connected':
      return 'success' as const
    case 'disconnected':
      return 'error' as const
  }
})

/** 未连接时的详细原因 */
const disconnectedTip = computed(() => {
  if (target.value === 'cloud') {
    return cloudError.value || '无法连接云打印服务。请检查服务地址和端口配置（设置 → 远程云打印）。'
  }
  if (probeState.value === 'connected' && localPrinters.value.length === 0) {
    return `已连上客户端（${printerBase.value}），但未枚举到任何打印机，请检查系统打印机安装情况。`
  }
  return `${probeError.value || '无法连接本机打印客户端'}。当前地址 ${printerBase.value}，可在「设置 → 本地打印」修改 IP / 端口。`
})

/* ------------------------------ 打印机列表 ------------------------------ */
const KIND_LABEL: Record<PrinterInfo['kind'], string> = {
  virtual: '虚拟',
  common: '普通',
  ticket: '票据',
}

const selectedPrinter = ref<string>('')

const printerOptions = computed(() => {
  if (target.value === 'cloud') return cloudPrinters.value
  return localPrinters.value.map((p) => ({
    label: `${p.name}${p.isDefault ? ' · 默认' : ''}${p.isOnline ? '' : '（离线）'}`,
    value: p.name,
    disabled: !p.isOnline,
  }))
})

/** 当前选中的本机打印机详情 */
const currentPrinter = computed<PrinterInfo | null>(() => {
  if (target.value !== 'local') return null
  return localPrinters.value.find((p) => p.name === selectedPrinter.value) ?? null
})

/** 选中打印机后自动收敛不支持的能力（不支持双面 → 强制单面） */
watch(currentPrinter, (p) => {
  if (!p) return
  if (!p.supportsDuplex) duplex.value = 'single'
  if (!p.supportsColor) color.value = 'grayscale'
})

/* ------------------------------ 打印任务名 ------------------------------ */
type NamingMode = 'filename' | 'random'
const namingMode = ref<NamingMode>('filename')
const randomSeed = ref(0)

const taskName = computed(() => {
  if (namingMode.value === 'filename') {
    return store.templateName || '未命名模板'
  }
  void randomSeed.value // 依赖种子：每次打开弹窗换一个新随机名
  const ts = Date.now().toString(36).slice(-6)
  const rand = Math.random().toString(36).slice(2, 6)
  return `Print-${ts}-${rand}`
})

/* ------------------------------ 打印参数 ------------------------------ */
const copies = ref(1)
type Orientation = 'portrait' | 'landscape'
const orientation = ref<Orientation>('portrait')
type Duplex = 'single' | 'double'
const duplex = ref<Duplex>('single')
type ColorMode = 'color' | 'grayscale'
const color = ref<ColorMode>('grayscale')

/* ------------------------------ 探测 ------------------------------ */

/** 本机：走共享探测单例 */
async function detectLocalPrinters(): Promise<void> {
  await runProbe()
  const def = defaultPrinter.value
  if (def && !localPrinters.value.some((p) => p.name === selectedPrinter.value)) {
    selectedPrinter.value = def.name
  }
}

/** 云打印探测：从 print-settings 读配置，尝试连接远程打印服务获取打印机列表。 */
async function detectCloudPrinters(): Promise<void> {
  cloudStatus.value = 'checking'
  cloudPrinters.value = []
  cloudError.value = ''

  const settings = readCloudSettings()
  if (!settings.host) {
    cloudStatus.value = 'disconnected'
    return
  }

  const url = `${settings.host.replace(/\/+$/, '')}:${settings.port}/api/printers`
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as Array<{ id: string; name: string }>
    if (data && data.length > 0) {
      cloudPrinters.value = data.map((p) => ({ label: p.name, value: p.id }))
      selectedPrinter.value = cloudPrinters.value[0]?.value || ''
      cloudStatus.value = 'connected'
    } else {
      cloudError.value = '云打印服务未返回任何打印机'
      cloudStatus.value = 'disconnected'
    }
  } catch (e) {
    cloudError.value = `无法连接 ${url}（${e instanceof Error ? e.message : String(e)}）`
    cloudStatus.value = 'disconnected'
  }
}

/** 从 localStorage 读云打印配置（复用 config/print-settings.ts 结构） */
function readCloudSettings(): { host: string; port: number } {
  try {
    const raw = localStorage.getItem('openprint:print-settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        host: parsed?.remote?.host || 'http://localhost',
        port: parsed?.remote?.port || 9100,
      }
    }
  } catch {
    // ignore
  }
  return { host: 'http://localhost', port: 9100 }
}

/** 重置为默认值 */
function resetDefaults(): void {
  copies.value = 1
  orientation.value = 'portrait'
  duplex.value = 'single'
  color.value = 'grayscale'
  namingMode.value = 'filename'
  randomSeed.value += 1
}

/* ------------------------------ 生命周期 ------------------------------ */

watch(target, (val) => {
  if (val === 'local') void detectLocalPrinters()
  else void detectCloudPrinters()
})

watch(
  () => props.show,
  (open) => {
    if (!open) return
    resetDefaults()
    if (target.value === 'local') void detectLocalPrinters()
    else void detectCloudPrinters()
  },
)

/** 刷新打印机列表 */
function refreshPrinters(): void {
  if (target.value === 'local') void detectLocalPrinters()
  else void detectCloudPrinters()
}

/* ------------------------------ 推送打印 ------------------------------ */

const printing = ref(false)
const printingHint = ref('')

async function doPrint(): Promise<void> {
  if (!isConnected.value) {
    message.warning('打印机未连接，无法打印')
    return
  }
  if (target.value === 'cloud') {
    message.info('云打印推送尚未接入，请切换到「本机客户端」')
    return
  }
  if (printing.value) return

  printing.value = true
  try {
    printingHint.value = '正在排版渲染…'
    const template = store.buildTemplate()
    const data = buildPreviewData(dsStore.activeFields)
    const payload = await buildPrintPayload({
      template,
      data,
      output: {
        pageDecoration: {
          backgroundColor: store.pageSetup.backgroundColor ?? '#ffffff',
          watermark: store.pageSetup.watermark,
        },
      },
    })

    printingHint.value = `正在推送 ${payload.format.toUpperCase()}（${payload.pages} 页 · ${formatPayloadSize(payload.bytes)}）…`
    const res = await submitPrintJob(
      {
        taskName: taskName.value,
        printer: selectedPrinter.value,
        format: payload.format,
        encoding: payload.encoding,
        content: payload.content,
        pages: payload.pages,
        copies: copies.value,
        orientation: orientation.value,
        duplex: duplex.value === 'double',
        color: color.value === 'color',
      },
      printerBase.value,
    )

    const job = res.jobId ? ` · 任务号 ${res.jobId}` : ''
    message.success(
      `已推送到「${selectedPrinter.value}」：${payload.pages} 页 · ${payload.format.toUpperCase()} · ${formatPayloadSize(payload.bytes)} · ${copies.value} 份${job}`,
    )
    emit('update:show', false)
  } catch (e) {
    message.error(`推送失败：${describePrintError(e)}`)
  } finally {
    printing.value = false
    printingHint.value = ''
  }
}

function close(): void {
  emit('update:show', false)
}
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    title="打印"
    style="width: 560px; max-width: 94vw"
    :mask-closable="false"
    @update:show="emit('update:show', $event)"
  >
    <!-- 打印目标切换 -->
    <div class="print-target-bar">
      <NRadioGroup v-model:value="target" class="print-target-group">
        <NRadioButton value="local">
          <div class="i-carbon-printer mr-1 inline-block text-14px align-middle" />
          本机客户端
        </NRadioButton>
        <NRadioButton value="cloud">
          <div class="i-carbon-cloud mr-1 inline-block text-14px align-middle" />
          云打印
        </NRadioButton>
      </NRadioGroup>

      <!-- 连接状态 -->
      <div class="flex items-center gap-2">
        <NSpin v-if="printerStatus === 'checking'" :size="14" />
        <NTag :type="statusTagType" size="small" round>{{ statusTagText }}</NTag>
        <NTooltip>
          <template #trigger>
            <NButton quaternary size="tiny" @click="refreshPrinters">
              <div class="i-carbon-renew text-14px" />
            </NButton>
          </template>
          重新检测打印机
        </NTooltip>
      </div>
    </div>

    <!-- 服务地址（本机模式） -->
    <div v-if="target === 'local'" class="print-base-line">
      <div class="i-carbon-plug text-13px" />
      <span>服务地址 {{ printerBase }}</span>
      <span v-if="probeHealth" class="op-70">
        · {{ probeHealth.app }} v{{ probeHealth.version }}
      </span>
    </div>

    <!-- 未连接提示 -->
    <div v-if="!isConnected && printerStatus !== 'checking'" class="print-disconnected-tip">
      <div class="i-carbon-warning text-16px" style="color: var(--brand-danger, #ef4444)" />
      <NText depth="3" class="text-12px">{{ disconnectedTip }}</NText>
    </div>

    <!-- 打印配置区域 -->
    <div class="print-form" :class="{ 'is-disabled': formDisabled }">
      <!-- 打印机选择 -->
      <div class="print-field">
        <div class="print-field-label">打印机</div>
        <div class="flex-1">
          <NSelect
            v-model:value="selectedPrinter"
            :options="printerOptions"
            size="small"
            :disabled="formDisabled"
            :placeholder="isConnected ? '选择打印机' : '未连接'"
            style="width: 100%"
          />
          <!-- 打印机能力详情 -->
          <div v-if="currentPrinter" class="printer-meta">
            <NTag size="tiny" round :type="currentPrinter.status === 'idle' ? 'success' : 'error'">
              {{ currentPrinter.status === 'idle' ? '空闲' : '异常' }}
            </NTag>
            <NTag size="tiny" round>{{ KIND_LABEL[currentPrinter.kind] }}</NTag>
            <NTag size="tiny" round>{{ currentPrinter.maxDpi }} DPI</NTag>
            <NTag size="tiny" round :type="currentPrinter.supportsColor ? 'info' : 'default'">
              {{ currentPrinter.supportsColor ? '支持彩色' : '仅黑白' }}
            </NTag>
            <NTag size="tiny" round :type="currentPrinter.supportsDuplex ? 'info' : 'default'">
              {{ currentPrinter.supportsDuplex ? '支持双面' : '仅单面' }}
            </NTag>
            <NTag v-if="currentPrinter.trays.length" size="tiny" round>
              纸盒：{{ currentPrinter.trays.join(' / ') }}
            </NTag>
          </div>
          <div v-if="currentPrinter?.driver" class="printer-driver">
            驱动：{{ currentPrinter.driver }}
          </div>
        </div>
      </div>

      <!-- 打印任务名 -->
      <div class="print-field">
        <div class="print-field-label">任务名称</div>
        <div class="print-name-bar">
          <NRadioGroup v-model:value="namingMode" size="small" :disabled="formDisabled">
            <NRadioButton value="filename">文件名</NRadioButton>
            <NRadioButton value="random">随机</NRadioButton>
          </NRadioGroup>
          <div class="print-name-preview">{{ taskName }}</div>
        </div>
      </div>

      <!-- 打印份数 -->
      <div class="print-field">
        <div class="print-field-label">打印份数</div>
        <NInputNumber
          v-model:value="copies"
          size="small"
          :min="1"
          :max="99"
          button-placement="both"
          :disabled="formDisabled"
          style="width: 100px"
        />
      </div>

      <!-- 方向 -->
      <div class="print-field">
        <div class="print-field-label">方向</div>
        <NRadioGroup v-model:value="orientation" size="small" :disabled="formDisabled">
          <NRadioButton value="portrait">
            <div class="i-carbon-document-blank mr-1 inline-block text-14px align-middle" />
            纵向
          </NRadioButton>
          <NRadioButton value="landscape">
            <div class="i-carbon-document-horizontal mr-1 inline-block text-14px align-middle" />
            横向
          </NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 单面/双面 -->
      <div class="print-field">
        <div class="print-field-label">双面打印</div>
        <NRadioGroup
          v-model:value="duplex"
          size="small"
          :disabled="formDisabled || currentPrinter?.supportsDuplex === false"
        >
          <NRadioButton value="single">单面</NRadioButton>
          <NRadioButton value="double">双面</NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 颜色 -->
      <div class="print-field">
        <div class="print-field-label">颜色</div>
        <NRadioGroup
          v-model:value="color"
          size="small"
          :disabled="formDisabled || currentPrinter?.supportsColor === false"
        >
          <NRadioButton value="grayscale">
            <div class="i-carbon-contrast mr-1 inline-block text-14px align-middle" />
            黑白
          </NRadioButton>
          <NRadioButton value="color">
            <div class="i-carbon-color-palette mr-1 inline-block text-14px align-middle" />
            彩色
          </NRadioButton>
        </NRadioGroup>
      </div>
    </div>

    <!-- 推送格式说明 -->
    <div class="print-format-note">
      <div class="i-carbon-information text-13px" />
      <span>推送规则：单页文档以 <b>SVG</b> 矢量原文推送，多页文档转 <b>PDF（base64）</b> 推送。</span>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <NText depth="3" class="text-12px">{{ printingHint }}</NText>
        <div class="flex justify-end gap-2">
          <NButton size="small" :disabled="printing" @click="close">取消</NButton>
          <NButton
            size="small"
            type="primary"
            :loading="printing"
            :disabled="!isConnected || printing"
            @click="doPrint"
          >
            <template #icon>
              <div class="i-carbon-printer text-14px" />
            </template>
            打印
          </NButton>
        </div>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.print-target-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.print-target-group :deep(.n-radio-button) {
  --n-button-color: var(--brand-surface);
}

.print-base-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--brand-text-3, var(--brand-text-2));
  font-family: monospace;
}

.print-disconnected-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 16px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.print-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.print-form.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.print-field {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.print-field-label {
  width: 72px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--brand-text-2);
  line-height: 28px;
}

.printer-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.printer-driver {
  margin-top: 4px;
  font-size: 12px;
  color: var(--brand-text-3, var(--brand-text-2));
  opacity: 0.8;
}

.print-name-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.print-name-preview {
  font-size: 13px;
  color: var(--brand-text-1);
  font-family: monospace;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--brand-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.print-format-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--brand-surface);
  font-size: 12px;
  color: var(--brand-text-2);
}
</style>
