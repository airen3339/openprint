# OpenPrint 图表三修：矢量 PDF + 饼图空白 + 标签对齐

> 承接上轮「原生 SVG 图表组件」（chartkit + PrintChart + ChartViewLayer + data-binder 接入 + ChartProps）。本轮修复/增强三件事。

## 1. PDF 图表走矢量（svg2pdf）
**之前**：整页 HTML 经 `foreignObject` 栅格化成 PNG 再 `addImage` → 图表是位图，放大发虚。
**现在**：混合矢量导出（`src/core/export-engine/export-pdf.ts`）
- 每页先 `stripCharts(page)` 剥离 chart 控件 → 栅格化（文本/表格位图底图）→ `addImage` 作背景；
- 再遍历该页 chart 节点，用 `svg2pdf` 把其 SVG 以**矢量**注入 jsPDF 对应 mm 盒（`x/y/width/height`）。
- **思源宋体矢量文本**：`/fonts/SourceHanSerifCN-Regular.ttf`（1.0M 子集）注册进 jsPDF 为 `SourceHanSerifCN`；chartkit 三个渲染器 SVG 根 `font-family` 改为 `'SourceHanSerifCN','PingFang SC',...` 优先。
- **三重兜底**：图表旋转 → 整页退回全栅格化；单图 svg2pdf 失败 → 该图单独栅格化兜底；字体加载失败 → 整页退回全栅格化。非图表页行为不变。

## 2. 饼图中间空白（bug 修复）
**根因**：`chartkit/core.ts` 的 `arcPath` 实心饼画成 `M start A end Z`（圆弧+弦 = 圆缺段），楔形不到圆心 → 中间空白。
**修复**：实心饼改为 `M cx cy L start A end Z`（真正到达圆心的楔形）；环形保持外弧+内弧环形扇区；360° 整圆特例用两段半圆弧。新增回归测试：饼图 path 必须含圆心坐标。

## 3. 标签默认对齐（功能）
- `ChartOptions` 新增 `labelAlign?: 'left' | 'center' | 'right'`，**默认 `left`**（解决"下面的标签默认都居中"）。
- `chartkit/core.ts` 新增 `legendStartX` / `xAxisLabelPos` 两个 helper：`bar/line` 的 x 轴类目标签、`bar/line/pie` 的图例均按 `labelAlign` 对齐（图例居中/右对齐按单行总宽偏移）。
- `ChartProps.vue` 外观区新增「标签对齐」下拉（左 / 中 / 右）。

## 验证结果
- `vue-tsc --build`：**0 错误**
- `vitest`：**249 测全绿**（chartkit 11 + 原有 238）
- `vite build`：**成功**（`pdf` chunk 因并入 svg2pdf.js 由 400→487kB，属动态加载导出包，无害）
- `vite` dev server：HTTP 200

## ⚠️ 验证缺口（需在真实浏览器确认）
svg2pdf 的矢量渲染、中文 TTF 注入、旋转页回退逻辑**无法在本环境（happy-dom）验证**——`export-pdf.spec.ts` 只 mock 栅格化层以验证 jsPDF 装配。请用户在 Chromium 中实际导出含图表的 PDF，确认：
1. 图表在 PDF 中随缩放保持清晰（矢量）；
2. 中文标签正常显示（非方块/空白）；
3. 含旋转图表的页面正确回退为位图且不丢图。
