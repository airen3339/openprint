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

---

# 导出/打印空白纸修复

## 问题
用户反馈：导出 PDF、推送本地打印都是空白纸。

## 根因
`src/core/renderer-html/css-generator.ts` 的 `tableCss()` 里有一段 CSS 注释包含未转义的 `<table>` 字符串：

```css
/* ---------- 表格样式预设（Excel 式快速切换；class 由渲染端挂在 <table> 上） ---------- */
```

导出/打印时，整页 CSS 被塞进 SVG 的 `<style>` 元素中。XML 解析器把注释里的 `<table>` 当成真实的 HTML 开标签，随后遇到 `</style>` 时抛出：

```
Opening and ending tag mismatch: table line 180 and style
```

整张 SVG 无法作为 `<img>` 加载，`rasterize.ts` 的 `svgToCanvas` 触发超时/错误兜底，返回**白底空 canvas**，最终 PDF / 打印推送都是白纸。

## 修复
将注释改为无尖括号的描述：

```css
/* ---------- 表格样式预设（Excel 式快速切换；class 由渲染端挂在 table 元素上） ---------- */
```

改动仅一行：`src/core/renderer-html/css-generator.ts`。

## 验证
- 用真实 Chromium 无头复现修复前：`<img>` 加载 SVG `onerror`，canvas/iframe 空白。
- 修复后：真实 Chromium 截图显示小票内容完整；`pageToImageBlob` JPEG blob 约 77KB；`documentToPdf` 底层栅格化路径恢复。
- `vue-tsc --build`：0 错误。
- `vitest run`：253 passed（31 文件）。

---

# 导出/打印「模糊」修复

## 问题
空白纸修好后，用户反馈：导出 PDF、本地打印都**模糊**，"之前的版本很清晰"。

## 根因
`src/core/export-engine/rasterize.ts` 的 `svgToCanvas` 走的是「**低分渲染 + drawImage 插值放大**」：

1. `buildPageSvg` 生成的 SVG 宽高是 96dpi 像素值（58mm 小票仅 **220×454 px**）；
2. `svgToCanvas` 把这个低分 SVG 渲染成位图 img，再 `drawImage` **放大**到 `×scale` 的 canvas。

`drawImage` 放大只是**像素插值**，不产生任何新细节 —— 文字在 220px 宽上光栅化后被拉伸，边缘发虚。这就是模糊的根源（JPEG 有损进一步放大这种感觉）。

> 关键认知：两种做法的 canvas 尺寸完全相同（都是 440×908），区别只在**内容来源**（插值 vs 原生）。所以单看尺寸测不出来，必须真实浏览器看文字边缘。

## 修复
新增 `scaleSvgViewport()`：**加载前**把 SVG 根节点的 `width/height` 直接 `×scale`（`viewBox` 不动）。这样 foreignObject 内容以高分辨率**原生渲染**成位图，img 本身就是高分图；canvas 尺寸 = img 尺寸、`drawImage(img, 0, 0)` 不再缩放插值。

改动：`src/core/export-engine/rasterize.ts`（`svgToCanvas` + 新增 `scaleSvgViewport`）。

## scale 决策（保持不变 = 2）
对照 `scale=2`（76KB / 192dpi）vs `scale=3`（138KB / 288dpi）：修复后两者文字都清晰、差异很小。故**保持 `scale=2` 默认**——清晰度足够且体积友好，不为提 scale 让体积反弹。需要更高清晰度时 `documentToPdf(result,{scale:3})` / 推送 `buildPrintPayload(req,{scale:3})` 可调。

## 验证
- 真实 Chromium 对照：修复前文字边缘锯齿毛糙，修复后平滑锐利。
- 真实导出 PDF（`documentToPdf` scale=2 jpeg）落盘 **81301 B**；`pdftoppm` 按 **300 DPI** 渲染后，小票标题/地址/电话/明细/合计全部清晰锐利（见 `临时/pdf-300dpi渲染.png`、`临时/export-test-清晰版.pdf`）。
- `vue-tsc --build`：0 错误；`vitest run`：253 passed（31 文件）。

---

# 导出/打印清晰度策略：PNG 无损 + 默认最高清 + 移除清晰度选择器

## 问题
模糊修复后，用户实测仍觉得不如之前清晰；复盘认为「底图从 PNG 切到 JPEG」是主因，要求：
- 换回 **PNG 无损底图**；
- 导出/打印默认**最高清**，不要再让用户选清晰度。

## 决策
1. **底图默认从 JPEG 改回 PNG（无损）**
   - `export-pdf.ts`、`export-engine/index.ts`、`print-client/payload.ts`、`rasterize.ts` 的默认 `imageType` 统一改为 `'png'`。
   - 思源宋体仍以 data-URI 内联；PNG 底图对中文/细线/条码边缘无 DCT 伪影。
2. **默认 scale 从 2（192dpi）提到 3（288dpi·最高清）**
   - PDF 导出、打印推送、底层 `pageToImageBlob` 的默认 scale 全部提到 `3`。
   - 程序/headless 仍可传 `scale: 2/4` 覆盖；只是不再暴露 UI 选择。
3. **移除导出弹窗的「清晰度」选择器**
   - `ExportDialog.vue` 删除 `scale` ref、`scaleOptions`、`NSelect` 行，以及 `onExport` 里的 `scale` 参数；用户不再面对清晰度选择。

## 文件改动
- `src/core/export-engine/export-pdf.ts`：默认 `scale=3`、`imageType='png'`；注释更新。
- `src/core/export-engine/index.ts`：默认 `scale=3`、`pdfImageType='png'`；注释更新。
- `src/core/export-engine/rasterize.ts`：`pageToImageBlob` 默认 `scale=3`。
- `src/core/print-client/payload.ts`：默认 `scale=3`、`imageType='png'`。
- `src/core/print-client/client.ts`、`src/design/modals/PrintDialog.vue`：注释同步为 PNG 无损。
- `src/design/toolbar/ExportDialog.vue`：移除「清晰度」选择器及 `NSelect` 导入。

## 验证
- `vue-tsc --build`：**0 错误**
- `vitest run`：**253 passed（31 文件）**
- 真实 Chromium 导出：
  - 收银小票（58mm）默认 PNG scale=3 导出 PDF：**2.57 MB**；
  - 用 `pdftoppm -r 300` 打印级渲染后文字/条码全部锐利（见 `临时/receipt-300dpi-png-scale3.png`）。
  - 量化对比（同页同 scale=3）：PNG 拉普拉斯高频能量 / JPEG ≈ **0.998**，说明清晰度的主要决定因素是前一轮的「高分原生渲染」修复；PNG 在此基础上彻底消除 JPEG 的 DCT 块伪影，与「最清晰」目标一致。

## 体积提示
- PNG 无损清晰度最高，但体积显著大于 JPEG：
  - 收银小票 PNG scale=3 ≈ 2.6 MB；
  - 销售出库单/数据报表类 A4 页 PNG scale=3 可达 **20+ MB/页**。
- 若本地打印客户端对 base64 载荷敏感，可在调用点显式传 `scale: 2` 或 `imageType: 'jpeg'`。
