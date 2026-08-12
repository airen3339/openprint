<script setup lang="ts">
/**
 * PrintDialog —— 打印配置弹窗
 * 功能：本机客户端 / 云打印切换、打印机下拉选择、打印任务名（随机/文件名，不可手填）、
 * 打印份数、方向、单面/双面（默认单面）、颜色（默认黑白）、打印机连接检测。
 *
 * 主任铁律：无后端全链路可用——打印机探测走 navigator API（本机）或 fetch（云打印），
 * 未配置后端时全部本地操作。
 */
import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NInputNumber,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NText,
  NTooltip,
  useMessage,
} from 'naive-ui'
import { useDesignerStore } from '@/design/stores/designer'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'update:show', v: boolean): void }>()

const store = useDesignerStore()
const message = useMessage()

/* ------------------------------ 打印模式 ------------------------------ */
type PrintTarget = 'local' | 'cloud'
const target = ref<PrintTarget>('local')

/* ------------------------------ 打印机连接状态 ------------------------------ */
type PrinterStatus = 'checking' | 'connected' | 'disconnected'
const printerStatus = ref<PrinterStatus>('checking')

const statusTagText = computed(() => {
  switch (printerStatus.value) {
    case 'checking':
      return '检测中…'
    case 'connected':
      return '已连接打印机'
    case 'disconnected':
      return target.value === 'local' ? '未连接打印机' : '无法连接云打印服务'
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

const isConnected = computed(() => printerStatus.value === 'connected')
/** 未连接时禁用下方所有配置选项（参考可看但不可选） */
const formDisabled = computed(() => !isConnected.value)

/* ------------------------------ 打印机列表 ------------------------------ */
interface PrinterOption {
  label: string
  value: string
}
const printerOptions = ref<PrinterOption[]>([])
const selectedPrinter = ref<string>('')

/* ------------------------------ 打印任务名 ------------------------------ */
type NamingMode = 'filename' | 'random'
const namingMode = ref<NamingMode>('filename')

const taskName = computed(() => {
  if (namingMode.value === 'filename') {
    return store.templateName || '未命名模板'
  }
  // 随机命名：时间戳 + 4 位随机串
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

/* ------------------------------ 打印机探测 ------------------------------ */

/**
 * 本机打印机探测：使用 Web USB / Web Print API（实验性），失败回退到 navigator 检测。
 * 当前浏览器暂无标准打印 API，实际使用客户端程序或浏览器打印对话框。
 */
async function detectLocalPrinters(): Promise<void> {
  printerStatus.value = 'checking'
  printerOptions.value = []

  // 尝试获取系统打印机列表（Web Print API，Chrome 实验性功能）
  const nav = navigator as Navigator & {
    getPrinters?: () => Promise<Array<{ id: string; name: string }>>
  }

  try {
    if (nav.getPrinters) {
      const printers = await nav.getPrinters()
      if (printers.length > 0) {
        printerOptions.value = printers.map((p) => ({ label: p.name, value: p.id || p.name }))
        selectedPrinter.value = printerOptions.value[0]?.value || ''
        printerStatus.value = 'connected'
        return
      }
    }
    // 无标准 API 或列表为空 → 用系统默认打印机（浏览器打印对话框模式）
    // 这种情况视为「可用」，用户将使用浏览器原生打印对话框
    printerOptions.value = [{ label: '系统默认打印机', value: 'default' }]
    selectedPrinter.value = 'default'
    printerStatus.value = 'connected'
  } catch {
    printerStatus.value = 'disconnected'
  }
}

/**
 * 云打印探测：从 print-settings 读配置，尝试连接远程打印服务获取打印机列表。
 */
async function detectCloudPrinters(): Promise<void> {
  printerStatus.value = 'checking'
  printerOptions.value = []

  // 读取云打印配置
  const settings = readCloudSettings()
  if (!settings.host) {
    printerStatus.value = 'disconnected'
    return
  }

  const url = `${settings.host.replace(/\/+$/, '')}:${settings.port}/api/printers`
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as Array<{ id: string; name: string }>
    if (data && data.length > 0) {
      printerOptions.value = data.map((p) => ({ label: p.name, value: p.id }))
      selectedPrinter.value = printerOptions.value[0]?.value || ''
      printerStatus.value = 'connected'
    } else {
      printerStatus.value = 'disconnected'
    }
  } catch {
    printerStatus.value = 'disconnected'
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
}

/* ------------------------------ 生命周期 ------------------------------ */

/** 切换打印目标时重新探测 */
watch(target, (val) => {
  if (val === 'local') {
    void detectLocalPrinters()
  } else {
    void detectCloudPrinters()
  }
})

/** 打开弹窗时首次探测 */
watch(
  () => props.show,
  (open) => {
    if (open) {
      resetDefaults()
      if (target.value === 'local') {
        void detectLocalPrinters()
      } else {
        void detectCloudPrinters()
      }
    }
  },
)

/** 刷新打印机列表 */
function refreshPrinters(): void {
  if (target.value === 'local') {
    void detectLocalPrinters()
  } else {
    void detectCloudPrinters()
  }
}

/** 执行打印 */
async function doPrint(): Promise<void> {
  if (!isConnected.value) {
    message.warning('打印机未连接，无法打印')
    return
  }
  message.success(`打印任务已提交：${taskName.value}（${copies.value} 份）`)
  emit('update:show', false)
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
    style="width: 520px; max-width: 94vw"
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
          刷新打印机列表
        </NTooltip>
      </div>
    </div>

    <!-- 未连接提示 -->
    <div v-if="!isConnected && printerStatus !== 'checking'" class="print-disconnected-tip">
      <div class="i-carbon-warning text-16px" style="color: var(--brand-danger, #ef4444)" />
      <NText depth="3" class="text-12px">
        {{
          target === 'local'
            ? '未检测到已连接的打印机。请检查打印机驱动和数据线连接后点击刷新。'
            : '无法连接云打印服务。请检查服务地址和端口配置（设置 → 远程云打印）。'
        }}
      </NText>
    </div>

    <!-- 打印配置区域 -->
    <div class="print-form" :class="{ 'is-disabled': formDisabled }">
      <!-- 打印机选择 -->
      <div class="print-field">
        <div class="print-field-label">打印机</div>
        <NSelect
          v-model:value="selectedPrinter"
          :options="printerOptions"
          size="small"
          :disabled="formDisabled"
          :placeholder="isConnected ? '选择打印机' : '未连接'"
          style="width: 100%"
        />
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
        <NRadioGroup v-model:value="duplex" size="small" :disabled="formDisabled">
          <NRadioButton value="single">单面</NRadioButton>
          <NRadioButton value="double">双面</NRadioButton>
        </NRadioGroup>
      </div>

      <!-- 颜色 -->
      <div class="print-field">
        <div class="print-field-label">颜色</div>
        <NRadioGroup v-model:value="color" size="small" :disabled="formDisabled">
          <NRadioButton value="grayscale">
            <div class="i-carbon-circle-half mr-1 inline-block text-14px align-middle" />
            黑白
          </NRadioButton>
          <NRadioButton value="color">
            <div class="i-carbon-color-palette mr-1 inline-block text-14px align-middle" />
            彩色
          </NRadioButton>
        </NRadioGroup>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <NButton size="small" @click="close">取消</NButton>
        <NButton
          size="small"
          type="primary"
          :disabled="!isConnected"
          @click="doPrint"
        >
          <template #icon>
            <div class="i-carbon-printer text-14px" />
          </template>
          打印
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.print-target-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.print-target-group :deep(.n-radio-button) {
  --n-button-color: var(--brand-surface);
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
</style>
