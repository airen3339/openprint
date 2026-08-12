/**
 * 模板市场预设数据 —— 常用 A4 单据 / 小票 / 热敏面单 / 标签（含二维码）
 *
 * 设计约定：
 * - 内容以**静态文本**为主（不绑定数据源），保证用户点击即可用、所见即所得；
 *   需要真实数据时再自行替换为绑定/表达式。
 * - 二维码控件为静态 value（qrcode 库直接编码，画布/渲染开箱即用）。
 * - 坐标全部 mm，相对所属 section 左上角（协议约定）。
 */
import type {
  AnyControl,
  BarcodeControl,
  ChartControl,
  QrcodeControl,
  RectControl,
  TableColumn,
  TableControl,
  TableOptions,
  TextControl,
} from '@/types/control'
import type { PageMargin, PageSetup, Section, TemplateData } from '@/types/template'
import { createDemoTemplate } from './demo-template'

/* ------------------------------- 类型 ------------------------------- */

export type MarketCategory = 'invoice' | 'report' | 'receipt' | 'thermal' | 'label'

export interface MarketTemplate {
  id: string
  name: string
  category: MarketCategory
  desc: string
  /** 纸张尺寸标签（市场卡片展示） */
  sizeLabel: string
  /** 纸张宽高（mm，卡片缩略图用，避免渲染时反复 build） */
  pageW: number
  pageH: number
  build: () => TemplateData<AnyControl>
}

export const MARKET_CATEGORY_LABEL: Record<MarketCategory, string> = {
  invoice: '单据',
  report: '报表',
  receipt: '小票',
  thermal: '热敏',
  label: '标签',
}

/* ------------------------------- helpers ------------------------------- */

function paper(
  width: number,
  height: number,
  margin: Partial<PageMargin> = {},
  orientation: 'portrait' | 'landscape' = 'portrait',
): PageSetup {
  return {
    width,
    height,
    unit: 'mm',
    orientation,
    margin: { top: 10, right: 10, bottom: 10, left: 10, ...margin },
  }
}

function build(page: PageSetup, sections: Section<AnyControl>[]): TemplateData<AnyControl> {
  return { version: '1.0', document: { type: 'report', page, sections } }
}

/** 只有正文区（小票/标签类） */
function bodyOnly(page: PageSetup, components: AnyControl[]): TemplateData<AnyControl> {
  return build(page, [{ type: 'body', components }])
}

/** 页眉 + 正文 + 页脚（单据类） */
function fullPage(
  page: PageSetup,
  header: AnyControl[],
  body: AnyControl[],
  footer: AnyControl[] = [],
): TemplateData<AnyControl> {
  const sections: Section<AnyControl>[] = [
    { type: 'header', height: 24, repeat: true, components: header },
    { type: 'body', components: body },
  ]
  if (footer.length) sections.push({ type: 'footer', height: 12, repeat: true, components: footer })
  return build(page, sections)
}

function txt(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  value: string,
  style: NonNullable<TextControl['style']> = {},
): AnyControl {
  return {
    id,
    type: 'text',
    left,
    top,
    width,
    height,
    value,
    printable: true,
    // 市场模板默认思源黑体（正式单据感），调用方可覆盖
    style: { fontSize: 10, fontFamily: '思源黑体', ...style },
  }
}

function rule(id: string, left: number, top: number, width: number, stroke = '#333333', strokeWidth = 1): AnyControl {
  return { id, type: 'line', left, top, width, height: 0, stroke, strokeWidth, printable: true }
}

function barcode(id: string, left: number, top: number, width: number, height: number, value: string): BarcodeControl {
  return { id, type: 'barcode', left, top, width, height, value, format: 'CODE128', showText: true, printable: true }
}

function qrcode(id: string, left: number, top: number, width: number, height: number, value: string): QrcodeControl {
  return { id, type: 'qrcode', left, top, width, height, value, errorLevel: 'M', printable: true }
}

/** 圆角色块（KPI 卡片底 / 色条 / 分区标题条） */
function box(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  fill: string,
  stroke?: string,
  cornerRadius = 4,
): AnyControl {
  const rect: RectControl = {
    id,
    type: 'rect',
    left,
    top,
    width,
    height,
    fill,
    cornerRadius,
    shape: 'rect',
    printable: true,
  }
  if (stroke) {
    rect.stroke = stroke
    rect.strokeWidth = 0.6
  }
  return rect
}

/** 图表控件（chartkit 原生 SVG，导出 PDF 走矢量） */
function chart(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  kind: ChartControl['kind'],
  categories: string[],
  series: ChartControl['series'],
  options: ChartControl['options'] = {},
): AnyControl {
  return {
    id,
    type: 'chart',
    left,
    top,
    width,
    height,
    kind,
    categories,
    series,
    printable: true,
    options: {
      showLegend: true,
      showAxis: true,
      showGrid: true,
      labelAlign: 'center',
      ...options,
    },
  }
}

function table(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
  columns: TableColumn[],
  options: TableOptions = {},
): AnyControl {
  return {
    id,
    type: 'table',
    left,
    top,
    width,
    height,
    columns,
    printable: true,
    options: {
      repeatHeader: true,
      pageRows: 'auto',
      rowHeightMode: 'auto',
      borders: 'all',
      verticalAlign: 'middle',
      ...options,
    },
  }
}

/**
 * 精美财务分析报表（A4）。
 * 结构：页眉（公司 + 大标题 + 报告期）→ 4 张 KPI 指标卡 → 三张矢量图表
 * （月度营收柱状 / 营收构成环形 / 月度净利润折线）→ 分部经营明细表（内嵌数据自带合计）
 * → 页脚。所有数据均为静态示例，开箱即用无需绑定数据源。
 */
function buildFinancialReport(): TemplateData<AnyControl> {
  const w = 186

  /* —— 页眉 —— */
  const header: AnyControl[] = [
    txt('fr-co', 0, 0, 130, 6, '深圳某某集团股份有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#1677ff' }),
    txt('fr-title', 0, 7, w, 11, '2026 年上半年财务分析报表', { fontSize: 18, fontWeight: 'bold', textAlign: 'center' }),
    txt('fr-period', 0, 19, w, 5, '报告期：2026-01-01 ~ 2026-06-30　　币种：人民币 / 万元', {
      fontSize: 9,
      textAlign: 'center',
      fill: '#555555',
    }),
    rule('fr-rule', 0, 22, w, '#1677ff', 1),
  ]

  /* —— 4 张 KPI 指标卡 —— */
  const cardW = 43
  const cardGap = 4
  const cardTop = 0
  const cardH = 26
  const cardX = [1, 1 + (cardW + cardGap), 1 + 2 * (cardW + cardGap), 1 + 3 * (cardW + cardGap)]
  const cardAccent = ['#1677ff', '#52c41a', '#13c2c2', '#fa8c16']
  const cardLabel = ['营业收入', '营业利润', '经营现金流', '营收同比增长']
  const cardValue = ['12,860', '4,300', '3,420', '+18.6%']
  const cardUnit = ['万元', '万元', '万元', '同比']
  const cards: AnyControl[] = []
  for (let i = 0; i < 4; i++) {
    const x = cardX[i]!
    const accent = cardAccent[i]!
    const label = cardLabel[i]!
    const value = cardValue[i]!
    const unit = cardUnit[i]!
    cards.push(box(`fr-kpi-${i}-bg`, x, cardTop, cardW, cardH, '#ffffff', '#e8e8e8', 4))
    cards.push(box(`fr-kpi-${i}-bar`, x, cardTop, cardW, 5, accent, undefined, 4))
    cards.push(txt(`fr-kpi-${i}-lbl`, x + 3, cardTop + 8, cardW - 6, 5, label, {
      fontSize: 8,
      fill: '#666666',
    }))
    cards.push(txt(`fr-kpi-${i}-val`, x + 3, cardTop + 12, cardW - 6, 9, value, {
      fontSize: 16,
      fontWeight: 'bold',
      fill: accent,
    }))
    cards.push(txt(`fr-kpi-${i}-unit`, x + 3, cardTop + 21, cardW - 6, 4, unit, {
      fontSize: 8,
      fill: '#999999',
    }))
  }

  /* —— 图表标题 —— */
  const chartTop = 32
  cards.push(txt('fr-chart-title', 0, chartTop - 2, w, 5, '二、经营分析', { fontSize: 11, fontWeight: 'bold', fill: '#333333' }))

  /* —— 三张矢量图表 —— */
  const chartH = 70
  const barW = 88
  const sideW = 47
  const donutX = barW + 4
  const lineX = barW + 4 + sideW + 4
  const charts: AnyControl[] = [
    chart('fr-bar', 0, chartTop, barW, chartH, 'bar', ['1月', '2月', '3月', '4月', '5月', '6月'], [
      { name: '营收', data: [1980, 2100, 2240, 2050, 2180, 2310], color: '#1677ff' },
    ], { title: '月度营收（万元）', showLegend: false, showAxis: true, showGrid: true, valueLabel: true, palette: ['#1677ff'] }),
    chart('fr-donut', donutX, chartTop, sideW, chartH, 'pie', ['华东', '华南', '华北', '西南', '海外'], [
      { name: '营收构成', data: [4860, 3260, 2510, 1430, 800] },
    ], {
      title: '营收构成',
      donut: true,
      showLegend: true,
      showAxis: false,
      showGrid: false,
      valueLabel: false,
      palette: ['#1677ff', '#52c41a', '#13c2c2', '#fa8c16', '#9254de'],
    }),
    chart('fr-line', lineX, chartTop, sideW, chartH, 'line', ['1月', '2月', '3月', '4月', '5月', '6月'], [
      { name: '净利润', data: [300, 330, 360, 340, 360, 490], color: '#fa8c16' },
    ], {
      title: '月度净利润',
      showLegend: false,
      smooth: true,
      area: true,
      showAxis: true,
      showGrid: true,
      valueLabel: true,
      palette: ['#fa8c16'],
    }),
  ]

  /* —— 分部经营明细表（内嵌数据 + 合计） —— */
  const tableTop = chartTop + chartH + 8
  const detailRows: Array<Record<string, unknown>> = [
    { name: '华东大区', revenue: 4860, cost: 3120, profit: 1740, margin: 0.358 },
    { name: '华南大区', revenue: 3260, cost: 2180, profit: 1080, margin: 0.331 },
    { name: '华北大区', revenue: 2510, cost: 1760, profit: 750, margin: 0.299 },
    { name: '西南大区', revenue: 1430, cost: 980, profit: 450, margin: 0.315 },
    { name: '海外事业部', revenue: 800, cost: 520, profit: 280, margin: 0.35 },
  ]
  const detailTable: TableControl = {
    id: 'fr-detail',
    type: 'table',
    left: 0,
    top: tableTop,
    width: w,
    height: 56,
    printable: true,
    data: detailRows,
    columns: [
      { title: '分部', field: 'name', width: 40, align: 'left', headerAlign: 'center' },
      { title: '营收（万元）', field: 'revenue', width: 36, align: 'right', headerAlign: 'center', format: { kind: 'int' } },
      { title: '成本（万元）', field: 'cost', width: 36, align: 'right', headerAlign: 'center', format: { kind: 'int' } },
      { title: '利润（万元）', field: 'profit', width: 34, align: 'right', headerAlign: 'center', format: { kind: 'int' } },
      { title: '利润率', field: 'margin', width: 40, align: 'right', headerAlign: 'center', format: { kind: 'percent', digits: 1 } },
    ],
    options: {
      repeatHeader: true,
      pageRows: 'auto',
      rowHeightMode: 'auto',
      borders: 'three-line',
      tableStyle: 'report',
      verticalAlign: 'middle',
      summaryRow: {
        type: 'custom',
        fields: ['revenue', 'cost', 'profit', 'margin'],
        label: '合计',
        expressions: {
          revenue: 'sum.revenue',
          cost: 'sum.cost',
          profit: 'sum.profit',
          margin: 'sum.profit / sum.revenue',
        },
      },
    },
  }

  /* —— 说明 —— */
  const noteTop = tableTop + 56 + 6
  const notes: AnyControl[] = [
    box('fr-note-bg', 0, noteTop, w, 22, '#fafafa', '#e8e8e8', 4),
    txt('fr-note-title', 4, noteTop + 3, w - 8, 5, '指标说明', { fontSize: 9, fontWeight: 'bold', fill: '#333333' }),
    txt(
      'fr-note-1',
      4,
      noteTop + 9,
      w - 8,
      4,
      '1）金额单位均为万元；2）营业利润 = 营收 − 成本（分部合计 4,300 万元）；',
      { fontSize: 8, fill: '#555555' },
    ),
    txt(
      'fr-note-2',
      4,
      noteTop + 14,
      w - 8,
      4,
      '3）净利润 2,180 万元（归母净利润，已扣所得税及少数股东损益）；4）增长率对比 2025 年同期。',
      { fontSize: 8, fill: '#555555' },
    ),
  ]

  const body: AnyControl[] = [...cards, ...charts, detailTable, ...notes]

  /* —— 页脚 —— */
  const footer: AnyControl[] = [
    txt('fr-brand', 0, 3, 90, 6, '本报表由 OpenPrint 生成', { fontSize: 8, fill: '#888888' }),
    txt('fr-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
  ]

  return fullPage(paper(210, 297), header, body, footer)
}

/* ------------------------------ 模板定义 ------------------------------ */

export const MARKET_TEMPLATES: MarketTemplate[] = [
  /* ============ 单据（A4 / A5） ============ */
  {
    id: 'market-sale-order',
    name: '销售出库单',
    category: 'invoice',
    desc: 'A4 标准销售出库单：单据头 + 商品明细表 + 合计 + 签收栏，表头每页重复',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: createDemoTemplate,
  },
  {
    id: 'market-purchase-order',
    name: '采购入库单',
    category: 'invoice',
    desc: 'A4 采购入库单：供应商信息 + 到货明细表 + 验收签收栏',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('pch-co', 0, 0, 120, 6, '深圳市某某制造有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#333333' }),
        txt('pch-title', 0, 7, w, 11, '采 购 入 库 单', { fontSize: 18, fontWeight: 'bold', textAlign: 'center' }),
        rule('pch-rule', 0, 21, w),
      ]
      const body: AnyControl[] = [
        txt('pch-no', 0, 0, 62, 6, '单据号：CG-2026-0001'),
        txt('pch-date', 62, 0, 62, 6, '入库日期：2026-08-08'),
        txt('pch-wh', 124, 0, 62, 6, '仓库：一号仓'),
        txt('pch-supplier', 0, 7, 92, 6, '供应商：深圳市某某电子有限公司'),
        txt('pch-contact', 92, 7, 94, 6, '联系人：张先生　电话：0755-8888 6666'),
        txt('pch-addr', 0, 14, w, 6, '送货地址：宝安区某某工业园 A 栋'),
        table('pch-tbl', 0, 23, w, 60, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 14, align: 'center', headerAlign: 'center' },
          { title: '物料编码', field: 'productCode', width: 26, align: 'left', headerAlign: 'center' },
          { title: '物料名称', field: 'productName', width: 58, align: 'left', headerAlign: 'center' },
          { title: '规格型号', field: 'spec', width: 34, align: 'left', headerAlign: 'center' },
          { title: '单位', field: 'unit', width: 12, align: 'center', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 14, align: 'right', headerAlign: 'center' },
          { title: '单价', field: 'price', width: 14, align: 'right', headerAlign: 'center' },
          { title: '金额', field: 'amount', width: 14, align: 'right', headerAlign: 'center' },
        ]),
        txt('pch-total', 0, 85, w, 7, '合计金额（大写）：叁万捌仟陆佰元整', { fontSize: 11, fontWeight: 'bold' }),
        txt('pch-memo', 0, 93, w, 6, '备注：本单须经仓库验收确认后方可入库', { fontSize: 9, fill: '#555555' }),
        txt('pch-sign', 0, 103, w, 6, '验收：＿＿＿＿　　仓管：＿＿＿＿　　采购：＿＿＿＿　　制单：＿＿＿＿', { fontSize: 9 }),
      ]
      const footer: AnyControl[] = [
        txt('pch-brand', 0, 3, 90, 6, '本单据由 OpenPrint 生成', { fontSize: 8, fill: '#888888' }),
        txt('pch-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },
  {
    id: 'market-quotation',
    name: '报价单',
    category: 'invoice',
    desc: 'A4 报价单：客户抬头 + 报价明细 + 有效期与条款说明',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('qt-co', 0, 0, 100, 6, '深圳市某某科技有限公司', { fontSize: 11, fontWeight: 'bold', fill: '#1677ff' }),
        barcode('qt-bc', 140, 0, 46, 12, 'QUO-2026-0801'),
        txt('qt-title', 0, 14, w, 10, '报 价 单', { fontSize: 16, fontWeight: 'bold', textAlign: 'center' }),
        rule('qt-rule', 0, 22, w, '#1677ff', 1),
      ]
      const body: AnyControl[] = [
        txt('qt-cust', 0, 0, w, 6, '致：某某采购中心　　联系人：李经理　　电话：0755-1234 5678'),
        txt('qt-no', 0, 7, w, 6, '报价单号：QUO-2026-0801　　报价日期：2026-08-08　　有效期：30 天'),
        table('qt-tbl', 0, 16, w, 70, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 12, align: 'center', headerAlign: 'center' },
          { title: '产品名称', field: 'productName', width: 56, align: 'left', headerAlign: 'center' },
          { title: '规格型号', field: 'spec', width: 30, align: 'left', headerAlign: 'center' },
          { title: '单位', field: 'unit', width: 12, align: 'center', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 14, align: 'right', headerAlign: 'center' },
          { title: '单价（元）', field: 'price', width: 22, align: 'right', headerAlign: 'center' },
          { title: '小计（元）', field: 'amount', width: 24, align: 'right', headerAlign: 'center' },
          { title: '备注', field: 'memo', width: 16, align: 'left', headerAlign: 'center' },
        ]),
        txt('qt-total', 0, 88, w, 7, '合计金额（不含税）：￥38,600.00', { fontSize: 11, fontWeight: 'bold', textAlign: 'right' }),
        txt('qt-terms', 0, 97, w, 6, '付款方式：月结 30 天；交货周期：收到订单后 7 个工作日内', { fontSize: 9, fill: '#555555' }),
        txt('qt-note', 0, 104, w, 6, '以上报价含税 13%，如需开票请在下单时说明开票信息。', { fontSize: 9, fill: '#555555' }),
      ]
      const footer: AnyControl[] = [
        txt('qt-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },
  {
    id: 'market-delivery-order',
    name: '送货单',
    category: 'invoice',
    desc: 'A5 送货单：随货联，收货方签收后留档',
    sizeLabel: 'A5 · 148×210',
    pageW: 148,
    pageH: 210,
    build: () => {
      const w = 128
      const header: AnyControl[] = [
        txt('dl-title', 0, 0, w, 10, '送 货 单', { fontSize: 15, fontWeight: 'bold', textAlign: 'center' }),
        txt('dl-no', 0, 11, w, 5, '送货单号：SH-2026-0801', { fontSize: 9 }),
        rule('dl-rule', 0, 18, w),
      ]
      const body: AnyControl[] = [
        txt('dl-to', 0, 0, w, 5, '收货单位：某某商贸有限公司', { fontSize: 9 }),
        txt('dl-from', 0, 6, w, 5, '发货单位：某某科技有限公司', { fontSize: 9 }),
        txt('dl-date', 0, 12, w, 5, '送货日期：2026-08-08　　车牌：粤B·88888', { fontSize: 9 }),
        table('dl-tbl', 0, 20, w, 60, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 12, align: 'center', headerAlign: 'center' },
          { title: '商品名称', field: 'productName', width: 46, align: 'left', headerAlign: 'center' },
          { title: '单位', field: 'unit', width: 12, align: 'center', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 16, align: 'right', headerAlign: 'center' },
          { title: '备注', field: 'memo', width: 42, align: 'left', headerAlign: 'center' },
        ]),
        txt('dl-sign', 0, 84, w, 6, '收货人签收：＿＿＿＿＿＿　　日期：＿＿＿＿＿＿', { fontSize: 9 }),
      ]
      return fullPage(paper(148, 210, { top: 8, bottom: 8 }), header, body)
    },
  },

  /* ============ 报表（A4 · 图表 + 内嵌数据） ============ */
  {
    id: 'market-financial-report',
    name: '精美财务分析报表',
    category: 'report',
    desc: 'A4 财务分析报表：4 张 KPI 指标卡 + 柱状/环形/折线三张矢量图表 + 分部经营明细表（内嵌数据，自带合计），开箱即用无需绑定数据源',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: buildFinancialReport,
  },

  /* ============ 小票（58 / 80 热敏） ============ */
  {
    id: 'market-pos-58',
    name: '收银小票（58mm）',
    category: 'receipt',
    desc: '58mm 热敏收银小票：店名 + 商品行 + 合计，下方留白可自行扩展内容',
    sizeLabel: '58×120',
    pageW: 58,
    pageH: 120,
    build: () => {
      const w = 50
      const items: Array<[string, string, string]> = [
        ['可口可乐 330ml', '2', '6.00'],
        ['农夫山泉 550ml', '3', '4.50'],
        ['乐事薯片 原味', '1', '7.50'],
        ['康师傅方便面', '2', '9.00'],
        ['蒙牛纯牛奶 250ml', '2', '7.60'],
      ]
      const lines: AnyControl[] = [
        txt('pos-name', 0, 0, w, 6, '某某便利超市', { fontSize: 12, fontWeight: 'bold', textAlign: 'center' }),
        txt('pos-addr', 0, 6.5, w, 4, '地址：宝安区某某路 88 号', { fontSize: 8, textAlign: 'center', fill: '#555555' }),
        txt('pos-tel', 0, 11, w, 4, '电话：0755-6666 8888', { fontSize: 8, textAlign: 'center', fill: '#555555' }),
        rule('pos-rule1', 0, 16, w, '#999999', 0.5),
        txt('pos-no', 0, 17.5, w, 4, '单号：20260808-0012', { fontSize: 8 }),
        txt('pos-time', 0, 22, w, 4, '时间：2026-08-08 18:30:00', { fontSize: 8 }),
        rule('pos-rule2', 0, 27, w, '#999999', 0.5),
      ]
      let top = 28.5
      items.forEach(([name, qty, price], i) => {
        lines.push(txt(`pos-item${i}`, 0, top, w, 4.5, `${name}`, { fontSize: 9 }))
        lines.push(txt(`pos-item${i}-q`, 26, top, 12, 4.5, `x${qty}`, { fontSize: 9, textAlign: 'right' }))
        lines.push(txt(`pos-item${i}-p`, 38, top, 12, 4.5, price, { fontSize: 9, textAlign: 'right' }))
        top += 5
      })
      top += 1
      lines.push(rule('pos-rule3', 0, top, w, '#999999', 0.5))
      lines.push(txt('pos-total', 0, top + 2, w, 6, '合计：￥34.60', { fontSize: 12, fontWeight: 'bold', textAlign: 'right' }))
      lines.push(txt('pos-qr', 0, top + 9, w, 4, '扫码关注公众号', { fontSize: 7.5, textAlign: 'center', fill: '#555555' }))
      return bodyOnly(paper(58, 120, { top: 4, right: 4, bottom: 4, left: 4 }), lines)
    },
  },
  {
    id: 'market-waimai-80',
    name: '外卖小票（80mm）',
    category: 'receipt',
    desc: '80mm 外卖小票：店铺信息 + 订单明细 + 合计 + 备注',
    sizeLabel: '80×150',
    pageW: 80,
    pageH: 150,
    build: () => {
      const w = 72
      const header: AnyControl[] = [
        txt('wm-name', 0, 0, w, 6, '某某餐饮店', { fontSize: 13, fontWeight: 'bold', textAlign: 'center' }),
        txt('wm-slogan', 0, 6.5, w, 4, '好吃不贵，快速送达', { fontSize: 8, textAlign: 'center', fill: '#888888' }),
        rule('wm-rule1', 0, 12, w, '#999999', 0.5),
        txt('wm-no', 0, 13.5, w, 4, '订单号：WM2026080800123', { fontSize: 8.5 }),
        txt('wm-type', 50, 13.5, 22, 4, '堂食 / 外卖', { fontSize: 8.5, textAlign: 'right' }),
        txt('wm-time', 0, 18, w, 4, '下单时间：2026-08-08 12:05:30', { fontSize: 8.5 }),
        rule('wm-rule2', 0, 23, w, '#999999', 0.5),
      ]
      const body: AnyControl[] = [
        table('wm-tbl', 0, 0, w, 55, [
          { title: '商品', field: 'productName', width: 40, align: 'left', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 12, align: 'center', headerAlign: 'center' },
          { title: '小计', field: 'amount', width: 20, align: 'right', headerAlign: 'center' },
        ], { borders: 'none', repeatHeader: false }),
        txt('wm-total', 0, 58, w, 6, '合计：￥58.00', { fontSize: 12, fontWeight: 'bold', textAlign: 'right' }),
        txt('wm-fee', 0, 65, w, 4, '配送费：￥3.00　　包装费：￥1.00', { fontSize: 8.5, fill: '#555555' }),
        rule('wm-rule3', 0, 71, w, '#999999', 0.5),
        txt('wm-addr', 0, 73, w, 6, '送达地址：南山区科技园某某大厦 3 楼', { fontSize: 8.5 }),
        txt('wm-memo', 0, 80, w, 6, '备注：不要辣，多加一双筷子', { fontSize: 8.5 }),
        txt('wm-thanks', 0, 92, w, 5, '感谢惠顾，欢迎再次光临！', { fontSize: 9, textAlign: 'center', fontWeight: 'bold' }),
      ]
      return fullPage(paper(80, 150, { top: 6, right: 4, bottom: 6, left: 4 }), header, body)
    },
  },

  /* ============ 热敏面单 ============ */
  {
    id: 'market-express',
    name: '快递面单（热敏）',
    category: 'thermal',
    desc: '100×180 热敏快递面单：收/寄件信息分区 + 订单条码 + 运单号',
    sizeLabel: '100×180',
    pageW: 100,
    pageH: 180,
    build: () => {
      const w = 92
      const lines: AnyControl[] = [
        txt('ex-title', 0, 0, w, 6, '快 递 面 单', { fontSize: 13, fontWeight: 'bold', textAlign: 'center' }),
        rule('ex-rule', 0, 8, w, '#999999', 0.5),
        txt('ex-send-t', 0, 10, w, 4, '【寄件人】', { fontSize: 9, fontWeight: 'bold' }),
        txt('ex-send-name', 0, 15, w, 4, '张三　13800138000', { fontSize: 9.5 }),
        txt('ex-send-addr', 0, 20, w, 6, '广东省深圳市南山区科技园南路 100 号', { fontSize: 9.5 }),
        rule('ex-rule2', 0, 28, w, '#999999', 0.5),
        txt('ex-recv-t', 0, 30, w, 4, '【收件人】', { fontSize: 9, fontWeight: 'bold' }),
        txt('ex-recv-name', 0, 35, w, 4, '李四　13900139000', { fontSize: 9.5 }),
        txt('ex-recv-addr', 0, 40, w, 6, '北京市朝阳区建国路 88 号院 2 号楼', { fontSize: 9.5 }),
        rule('ex-rule3', 0, 48, w, '#999999', 0.5),
        barcode('ex-bc', 20, 52, 52, 14, 'SF1234567890'),
        txt('ex-no', 0, 69, w, 4, '运单号：SF1234567890', { fontSize: 9, textAlign: 'center' }),
        txt('ex-remark', 0, 75, w, 5, '备注：易碎品，请轻拿轻放', { fontSize: 8.5, fill: '#555555' }),
      ]
      return bodyOnly(paper(100, 180, { top: 6, right: 4, bottom: 6, left: 4 }), lines)
    },
  },

  /* ============ 标签 ============ */
  {
    id: 'market-price-label',
    name: '价格标签',
    category: 'label',
    desc: '40×30 商品价格标签：大号价格 + 商品名 + 条码，可复制多个排布',
    sizeLabel: '40×30',
    pageW: 40,
    pageH: 30,
    build: () => {
      const w = 36
      const lines: AnyControl[] = [
        txt('lb-name', 0, 0, w, 5, '可乐 500ml', { fontSize: 8, textAlign: 'center' }),
        txt('lb-price', 0, 6, w, 10, '￥3.50', { fontSize: 20, fontWeight: 'bold', textAlign: 'center', fill: '#e60000' }),
        barcode('lb-bc', 6, 18, 24, 8, '6901234567890'),
      ]
      return bodyOnly(paper(40, 30, { top: 3, right: 2, bottom: 3, left: 2 }), lines)
    },
  },

  /* ============ 新增：退货 / 报销 / 领料 / 对账（A4） ============ */
  {
    id: 'market-return-order',
    name: '销售退货单',
    category: 'invoice',
    desc: 'A4 销售退货单：原单信息 + 退货明细（含原因）+ 退款结算栏',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('rt-co', 0, 0, 100, 6, '深圳某某科技有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#333333' }),
        txt('rt-title', 0, 7, w, 11, '销 售 退 货 单', { fontSize: 18, fontWeight: 'bold', textAlign: 'center', fill: '#c0392b' }),
        rule('rt-rule', 0, 21, w),
      ]
      const body: AnyControl[] = [
        txt('rt-no', 0, 0, 62, 6, '退货单号：TH-2026-0008'),
        txt('rt-date', 62, 0, 62, 6, '退货日期：2026-08-08'),
        txt('rt-origin', 124, 0, 62, 6, '原出库单：CK-2026-0156'),
        txt('rt-cust', 0, 7, 92, 6, '客户：某某商贸有限公司'),
        txt('rt-contact', 92, 7, 94, 6, '联系人：王先生　电话：0755-5555 1234'),
        txt('rt-addr', 0, 14, w, 6, '退货地址：宝安区某某工业园 B 栋 2 层'),
        table('rt-tbl', 0, 23, w, 60, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 14, align: 'center', headerAlign: 'center' },
          { title: '商品编码', field: 'productCode', width: 26, align: 'left', headerAlign: 'center' },
          { title: '商品名称', field: 'productName', width: 48, align: 'left', headerAlign: 'center' },
          { title: '规格', field: 'spec', width: 26, align: 'left', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 14, align: 'right', headerAlign: 'center' },
          { title: '退货原因', field: 'reason', width: 58, align: 'left', headerAlign: 'center' },
        ]),
        txt('rt-total', 0, 85, w, 7, '退货合计（大写）：人民币陆佰元整', { fontSize: 11, fontWeight: 'bold' }),
        txt('rt-memo', 0, 93, w, 6, '备注：退货须附原出库单与验收记录', { fontSize: 9, fill: '#555555' }),
        txt('rt-sign', 0, 103, w, 6, '客户确认：＿＿＿＿　　仓库验收：＿＿＿＿　　财务退款：＿＿＿＿', { fontSize: 9 }),
      ]
      const footer: AnyControl[] = [
        txt('rt-brand', 0, 3, 90, 6, '本单据由 OpenPrint 生成', { fontSize: 8, fill: '#888888' }),
        txt('rt-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },
  {
    id: 'market-expense-claim',
    name: '费用报销单',
    category: 'invoice',
    desc: 'A4 费用报销单：费用明细表 + 合计 + 多级审批签名栏',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('exp-co', 0, 0, 100, 6, '某某科技有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#333333' }),
        txt('exp-title', 0, 7, w, 11, '费 用 报 销 单', { fontSize: 18, fontWeight: 'bold', textAlign: 'center' }),
        rule('exp-rule', 0, 21, w),
      ]
      const body: AnyControl[] = [
        txt('exp-no', 0, 0, 62, 6, '报销单号：BX-2026-0234'),
        txt('exp-date', 62, 0, 62, 6, '报销日期：2026-08-08'),
        txt('exp-dept', 124, 0, 62, 6, '部门：市场部'),
        txt('exp-user', 0, 7, 62, 6, '报销人：陈小明'),
        txt('exp-purpose', 62, 7, 124, 6, '事由：客户拜访差旅费'),
        table('exp-tbl', 0, 16, w, 50, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 14, align: 'center', headerAlign: 'center' },
          { title: '费用类型', field: 'feeType', width: 42, align: 'left', headerAlign: 'center' },
          { title: '发生日期', field: 'feeDate', width: 30, align: 'center', headerAlign: 'center' },
          { title: '摘要', field: 'summary', width: 50, align: 'left', headerAlign: 'center' },
          { title: '票据张数', field: 'billCount', width: 18, align: 'right', headerAlign: 'center' },
          { title: '金额', field: 'amount', width: 32, align: 'right', headerAlign: 'center' },
        ]),
        txt('exp-total', 0, 68, w, 7, '报销合计：￥1,860.00', { fontSize: 11, fontWeight: 'bold', textAlign: 'right' }),
        txt('exp-note', 0, 76, w, 6, '备注：附发票及行程单，发票张数 12 张', { fontSize: 9, fill: '#555555' }),
        txt('exp-sign', 0, 88, w, 6, '报销人：＿＿＿＿　　部门负责人：＿＿＿＿　　财务审核：＿＿＿＿', { fontSize: 9 }),
        txt('exp-sign2', 0, 95, w, 6, '财务总监：＿＿＿＿　　总经理审批：＿＿＿＿', { fontSize: 9 }),
      ]
      const footer: AnyControl[] = [
        txt('exp-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },
  {
    id: 'market-material-request',
    name: '领料单',
    category: 'invoice',
    desc: 'A4 领料单：领用明细表（物料/数量/用途）+ 发料领料签收栏',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('pl-co', 0, 0, 100, 6, '某某制造有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#333333' }),
        txt('pl-title', 0, 7, w, 11, '领 料 单', { fontSize: 18, fontWeight: 'bold', textAlign: 'center' }),
        rule('pl-rule', 0, 21, w),
      ]
      const body: AnyControl[] = [
        txt('pl-no', 0, 0, 62, 6, '领料单号：LL-2026-0066'),
        txt('pl-date', 62, 0, 62, 6, '日期：2026-08-08'),
        txt('pl-dept', 124, 0, 62, 6, '领料部门：生产一部'),
        txt('pl-user', 0, 7, 62, 6, '领料人：刘师傅'),
        txt('pl-wh', 62, 7, 124, 6, '仓库：原材料仓　用途：A 线本月排产'),
        table('pl-tbl', 0, 16, w, 55, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 14, align: 'center', headerAlign: 'center' },
          { title: '物料编码', field: 'productCode', width: 26, align: 'left', headerAlign: 'center' },
          { title: '物料名称', field: 'productName', width: 48, align: 'left', headerAlign: 'center' },
          { title: '规格型号', field: 'spec', width: 30, align: 'left', headerAlign: 'center' },
          { title: '单位', field: 'unit', width: 14, align: 'center', headerAlign: 'center' },
          { title: '数量', field: 'qty', width: 18, align: 'right', headerAlign: 'center' },
          { title: '备注', field: 'memo', width: 36, align: 'left', headerAlign: 'center' },
        ]),
        txt('pl-total', 0, 73, w, 6, '合计领用：5 项 / 共 360 件', { fontSize: 10, fontWeight: 'bold' }),
        txt('pl-sign', 0, 84, w, 6, '领料人：＿＿＿＿　　发料人：＿＿＿＿　　车间主管：＿＿＿＿', { fontSize: 9 }),
      ]
      const footer: AnyControl[] = [
        txt('pl-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },
  {
    id: 'market-statement',
    name: '对账单',
    category: 'invoice',
    desc: 'A4 客户对账单：账期往来明细（应收/已收/余额）+ 确认盖章栏',
    sizeLabel: 'A4 · 210×297',
    pageW: 210,
    pageH: 297,
    build: () => {
      const w = 186
      const header: AnyControl[] = [
        txt('st-co', 0, 0, 100, 6, '某某科技有限公司', { fontSize: 10, fontWeight: 'bold', fill: '#1677ff' }),
        txt('st-title', 0, 7, w, 11, '对 账 单', { fontSize: 18, fontWeight: 'bold', textAlign: 'center' }),
        rule('st-rule', 0, 21, w, '#1677ff', 1),
      ]
      const body: AnyControl[] = [
        txt('st-cust', 0, 0, w, 6, '致：某某商贸有限公司　　账期：2026-06-01 ~ 2026-07-31'),
        txt('st-no', 0, 7, w, 6, '对账编号：DZ-2026-0801　　打印日期：2026-08-08'),
        table('st-tbl', 0, 16, w, 60, [
          { title: '序号', expression: '{{rowIndex + 1}}', width: 14, align: 'center', headerAlign: 'center' },
          { title: '日期', field: 'billDate', width: 26, align: 'center', headerAlign: 'center' },
          { title: '单据号', field: 'billNo', width: 34, align: 'left', headerAlign: 'center' },
          { title: '摘要', field: 'summary', width: 44, align: 'left', headerAlign: 'center' },
          { title: '应收（元）', field: 'debit', width: 24, align: 'right', headerAlign: 'center' },
          { title: '已收（元）', field: 'credit', width: 22, align: 'right', headerAlign: 'center' },
          { title: '余额（元）', field: 'balance', width: 22, align: 'right', headerAlign: 'center' },
        ]),
        txt('st-begin', 0, 78, w, 6, '期初余额：￥0.00', { fontSize: 10 }),
        txt('st-end', 0, 85, w, 7, '期末应收余额：￥38,600.00', { fontSize: 11, fontWeight: 'bold' }),
        txt('st-note', 0, 93, w, 6, '请核对以上往来明细，如无异议请签章确认后回传。', { fontSize: 9, fill: '#555555' }),
        txt('st-sign', 0, 104, w, 6, '客户确认（盖章）：＿＿＿＿＿＿　　日期：＿＿＿＿＿＿', { fontSize: 9 }),
      ]
      const footer: AnyControl[] = [
        txt('st-page', 96, 3, 90, 6, '第 {{page}} 页 / 共 {{pages}} 页', { fontSize: 9, textAlign: 'right', fill: '#555555' }),
      ]
      return fullPage(paper(210, 297), header, body, footer)
    },
  },

  /* ============ 新增：带二维码的模板 ============ */
  {
    id: 'market-qr-receipt',
    name: '收款码小票（带二维码）',
    category: 'receipt',
    desc: '58mm 收款小票：商品行 + 合计 + 收款二维码（静态示例链接，可改为收款码图片/绑定）',
    sizeLabel: '58×130',
    pageW: 58,
    pageH: 130,
    build: () => {
      const w = 50
      const lines: AnyControl[] = [
        txt('qr-name', 0, 0, w, 6, '某某小面馆', { fontSize: 12, fontWeight: 'bold', textAlign: 'center' }),
        txt('qr-addr', 0, 6.5, w, 4, '宝安区某某路 66 号', { fontSize: 8, textAlign: 'center', fill: '#555555' }),
        rule('qr-rule1', 0, 11.5, w, '#999999', 0.5),
        txt('qr-no', 0, 13, w, 4, '单号：20260808-0033', { fontSize: 8 }),
        txt('qr-time', 0, 17.5, w, 4, '时间：2026-08-08 19:00:00', { fontSize: 8 }),
        rule('qr-rule2', 0, 22.5, w, '#999999', 0.5),
        txt('qr-i1', 0, 24, w, 4.5, '招牌牛肉面　　18.00', { fontSize: 9 }),
        txt('qr-i2', 0, 29, w, 4.5, '卤蛋 x2　　　 4.00', { fontSize: 9 }),
        txt('qr-i3', 0, 34, w, 4.5, '冰红茶　　　　 3.00', { fontSize: 9 }),
        rule('qr-rule3', 0, 40, w, '#999999', 0.5),
        txt('qr-total', 0, 42, w, 6, '合计：￥25.00', { fontSize: 12, fontWeight: 'bold', textAlign: 'right' }),
        txt('qr-hint', 0, 51, w, 4, '扫一扫付款', { fontSize: 8, textAlign: 'center', fill: '#555555' }),
        qrcode('qr-code', 17, 56, 16, 16, 'https://pay.example.com/merchant/1001'),
      ]
      return bodyOnly(paper(58, 130, { top: 4, right: 4, bottom: 4, left: 4 }), lines)
    },
  },
  {
    id: 'market-asset-label',
    name: '资产二维码标签',
    category: 'label',
    desc: '50×30 固定资产标签：资产名称/编号 + 二维码（扫码查看资产档案）',
    sizeLabel: '50×30',
    pageW: 50,
    pageH: 30,
    build: () => {
      const w = 46
      const lines: AnyControl[] = [
        txt('as-name', 0, 0, 30, 5, '笔记本电脑', { fontSize: 9, fontWeight: 'bold' }),
        txt('as-no', 0, 6, 30, 4, '编号：ZC-2026-0158', { fontSize: 7.5, fill: '#555555' }),
        txt('as-user', 0, 11, 30, 4, '使用人：张三', { fontSize: 7.5, fill: '#555555' }),
        qrcode('as-qr', 32, 0, 14, 14, 'https://asset.example.com/zc-2026-0158'),
        txt('as-date', 0, 20, 46, 4, '购置日期：2026-05-20', { fontSize: 7.5, fill: '#888888' }),
      ]
      return bodyOnly(paper(50, 30, { top: 3, right: 2, bottom: 3, left: 2 }), lines)
    },
  },
  {
    id: 'market-trace-label',
    name: '商品溯源标签',
    category: 'label',
    desc: '60×40 溯源标签：商品信息 + 二维码（扫码查看溯源/质检信息）',
    sizeLabel: '60×40',
    pageW: 60,
    pageH: 40,
    build: () => {
      const w = 56
      const lines: AnyControl[] = [
        txt('tr-name', 0, 0, w, 5, '有机大米 5kg', { fontSize: 10, fontWeight: 'bold' }),
        txt('tr-spec', 0, 6, w, 4, '产地：黑龙江五常　　批次：2026-A07', { fontSize: 7.5, fill: '#555555' }),
        txt('tr-price', 0, 11, 36, 8, '￥89.00', { fontSize: 16, fontWeight: 'bold', fill: '#e60000' }),
        qrcode('tr-qr', 38, 11, 18, 18, 'https://trace.example.com/lot/2026-A07'),
        txt('tr-note', 0, 32, w, 4, '扫码溯源 · 品质可查', { fontSize: 7.5, textAlign: 'center', fill: '#888888' }),
      ]
      return bodyOnly(paper(60, 40, { top: 3, right: 2, bottom: 3, left: 2 }), lines)
    },
  },
]
