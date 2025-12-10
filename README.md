# QR & Barcode Label Generator (web)

本项目是一个基于 Next.js 的标签生成工具，可批量生成包含条形码和二维码的 PNG 标签，支持导出并在浏览器端查看。

## 核心实现
- **条形码**：使用 `bwip-js` 生成 Code128，默认 scale 24 / height 28，并对数量条码提升 scale 以增加清晰度。
- **二维码**：使用 `qrcode` 库生成 Data URL，宽度放大到 1240 像素，边距 1 保证边缘留白。
- **图像合成**：后端 API 将生成的条形码、二维码嵌入 SVG 布局，再用 `sharp` 转为不透明 PNG，保持高分辨率输出。
- **数据校验**：`POST /api/render` 接收 `{ columns, vd? }`，校验各列行数一致并提供缺失提示；按行生成结果。
- **标签字段**：行数据列顺序为 `BOX ID / P/N / QTY / MPN (必填)`，可选 `Maker / 4L / Description`。二维码内容格式为 `BB{BOX}||P{PN}||Q{QTY}||1P{MPN}||4L{4L}`（无 4L 时省略）。

## 运行方式
```bash
npm install
npm run dev
```
默认启动在 `http://localhost:3000`。

## 文件结构提示
- `app/api/render/route.ts`：核心生成逻辑（条码/二维码创建、SVG 布局、PNG 输出）。
- `app/`：前端页面与表单。
- `public/`：静态资源。

## 其他说明
- 标签画布尺寸：1700×2368 px，留白边距 90 px；根据原型坐标按比例缩放到像素，保证印刷分辨率。
- 返回数据：`results` 数组包含 `pill`（拼接内容）、`image`（base64 PNG Data URL）、`filename`，以及前端引导用 `labelHints`。

