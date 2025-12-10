import { NextResponse } from 'next/server';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import sharp from 'sharp';

const VIEW_W = 233.93;
const VIEW_H = 278.11;
const W = 1700;
const H = 2368;
const MARGIN = 90;
const INNER_W = W - MARGIN * 2;
const INNER_H = H - MARGIN * 2;
const SCALE_X = INNER_W / VIEW_W;
const SCALE_Y = INNER_H / VIEW_H;
const pxX = (v: number) => Math.round(v * SCALE_X);
const pxY = (v: number) => Math.round(v * SCALE_Y);
const pxW = (v: number) => Math.round(v * SCALE_X);
const pxH = (v: number) => Math.round(v * SCALE_Y);

const labelHints = [
  'BOX ID',
  'P/N',
  'QTY',
  'MPN (QVL)',
  'Maker',
  '4L',
  'MITAC P/N description',
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { columns, vd } = body as { columns: string[][]; vd?: string };

    if (!Array.isArray(columns) || columns.length < 4) {
      return NextResponse.json({ error: '缺少必要列数据' }, { status: 400 });
    }

    const [boxCol = [], pnCol = [], qtyCol = [], mpnCol = [], makerCol = [], fourLCol = [], descCol = []] = columns;
    const rowCount = boxCol.length;
    if (!rowCount) {
      return NextResponse.json({ error: '请至少填写 BOX ID' }, { status: 400 });
    }

    const required = [pnCol, qtyCol, mpnCol];
    const requiredNames = ['P/N', 'QTY', 'MPN'];
    const invalidRequired = required.findIndex(col => col.length !== rowCount);
    if (invalidRequired !== -1) {
      return NextResponse.json({ error: `必填列行数需与 BOX ID 一致：${requiredNames[invalidRequired]}` }, { status: 400 });
    }

    const optionalPairs: Array<[string[], string]> = [
      [makerCol, 'Maker'],
      [fourLCol, '4L'],
      [descCol, 'Desc'],
    ];
    const invalidOptional = optionalPairs.findIndex(([col]) => col.length !== 0 && col.length !== rowCount);
    if (invalidOptional !== -1) {
      return NextResponse.json({ error: `可选列若填写需与 BOX ID 行数一致：${optionalPairs[invalidOptional][1]}` }, { status: 400 });
    }

    const results: Array<{ pill: string; image: string; filename: string }> = [];
    for (let i = 0; i < rowCount; i += 1) {
      const boxRaw = trim(boxCol[i]);
      const pnRaw = trim(pnCol[i]);
      const qtyRaw = trim(qtyCol[i]);
      const mpnRaw = trim(mpnCol[i]);
      const makerRaw = trim(makerCol[i]);
      const fourLRaw = trim(fourLCol[i]).toUpperCase();
      const fourLCode = fourLRaw ? `4L${fourLRaw}` : '';
      const vdText = trim(vd) || deriveVD(boxRaw);
      const makerName = makerRaw || 'MAKER';
      const cooText = fourLRaw || 'N/A'; // 显示时仅显示 4L 值本身

      if (!boxRaw || !pnRaw || !qtyRaw || !mpnRaw) {
        return NextResponse.json({ error: `第 ${i + 1} 行缺少必填项` }, { status: 400 });
      }

      const boxCode = `BB${boxRaw}`;
      const pnCode = `P${pnRaw}`;
      const qtyCode = `Q${qtyRaw}`;
      const mpnCode = `1P${mpnRaw}`;
      const qrText = [boxCode, pnCode, qtyCode, mpnCode, fourLCode].filter(Boolean).join('||');

      const [boxBarcode, pnBarcode, qtyBarcode, mpnBarcode, qrPng] = await Promise.all([
        makeBarcode(boxCode),
        makeBarcode(pnCode),
        // QTY 条码再提升分辨率
        makeBarcode(qtyCode, 36),
        makeBarcode(mpnCode),
        makeQr(qrText),
      ]);

      const svg = buildSvg({
        boxCode,
        pnRaw,
        qtyRaw,
        mpnRaw,
        makerName,
        cooText,
        vdText,
        fourLCode,
        barcodes: { boxBarcode, pnBarcode, qtyBarcode, mpnBarcode },
        qrPng,
      });

      const png = await svgToPng(svg);
      const dataUri = `data:image/png;base64,${png.toString('base64')}`;
      const pill = [boxCode, pnCode, qtyCode, mpnCode, fourLCode || 'N/A'].join('||');
      const filenameBase = pnRaw || `label-${i + 1}`;
      results.push({ pill, image: dataUri, filename: `${filenameBase}.png` });
    }

    return NextResponse.json({ results, labelHints });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '服务器错误' }, { status: 500 });
  }
}

function trim(v?: string): string {
  return (v || '').trim();
}

async function makeBarcode(text: string, scale = 24, height = 28): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    // 提升清晰度：默认放大 3 倍，可按需调整
    scale,
    height,
    includetext: false,
    textxalign: 'center',
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function makeQr(text: string): Promise<string> {
  // 提升清晰度：宽度提升一倍
  return QRCode.toDataURL(text, { width: 1240, margin: 1 });
}

async function svgToPng(svg: string) {
  // 生成不透明 PNG
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

function deriveVD(boxRaw: string) {
  const digits = boxRaw.replace(/\D/g, '');
  return digits.slice(0, 6) || boxRaw.slice(0, 6) || '';
}

type SvgInput = {
  boxCode: string;
  pnRaw: string;
  qtyRaw: string;
  mpnRaw: string;
  makerName: string;
  cooText: string;
  vdText: string;
  fourLCode: string;
  barcodes: {
    boxBarcode: string;
    pnBarcode: string;
    qtyBarcode: string;
    mpnBarcode: string;
  };
  qrPng: string;
};

function buildSvg(data: SvgInput) {
  const { boxCode, pnRaw, qtyRaw, mpnRaw, makerName, cooText, vdText, fourLCode, barcodes, qrPng } = data;
  const rules = [
    { y: 46.12, h: 1.3 },
    { y: 105.65, h: 1.3 },
    { y: 165.18, h: 1.3 },
    { y: 224.71, h: 1.3 },
  ];
  const layout = {
    boxText: { x: 1.41, y: 38.9 },
    pnText: { x: 1.88, y: 95.59 },
    qtyText: { x: 1.9, y: 126.77 },
    mpnText: { x: 1.9, y: 185.3 },
    maker: { x: 2.29, y: 249.98 },
    coo: { x: 0.45, y: 271.34 },
    vd: { x: 166.71, y: 66.71 },
    barcodeTop: { x: 3.58, y: 0, w: 168 - 3.58, h: 22.68 },
    barcodeMid: { x: 3.58, y: 56.49, w: 144.31 - 3.58, h: 22.68 },
    barcodeLow: { x: 3.58, y: 137.48, w: 82.95 - 3.58, h: 22.68 },
    barcodeMpn: { x: 3.58, y: 197.01, w: 144.31 - 3.58, h: 22.68 },
    qr: { x: 168.12, y: 233.9, size: 43.2 },
  } as const;

  const qrSizePx = Math.round(Math.min(pxW(layout.qr.size), pxH(layout.qr.size))) + 60;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="white" />
  <g transform="translate(${MARGIN},${MARGIN})">
    <rect width="${INNER_W}" height="${INNER_H}" fill="white" />
    ${rules
      .map(rule => `<rect x="${pxX(0)}" y="${pxY(rule.y)}" width="${pxW(VIEW_W)}" height="${pxH(rule.h)}" fill="#231815" />`)
      .join('')}

    <image href="${barcodes.boxBarcode}" x="${pxX(layout.barcodeTop.x)}" y="${pxY(layout.barcodeTop.y)}" width="${pxW(layout.barcodeTop.w)}" height="${pxH(layout.barcodeTop.h)}" preserveAspectRatio="none" />
    <text x="${pxX(layout.boxText.x)}" y="${pxY(layout.boxText.y)}" fill="#231815" font-family="Arial" font-size="${12 * SCALE_Y}">[B]BOX ID:${boxCode.replace('BB', 'B')}</text>

    <image href="${barcodes.pnBarcode}" x="${pxX(layout.barcodeMid.x)}" y="${pxY(layout.barcodeMid.y)}" width="${pxW(layout.barcodeMid.w)}" height="${pxH(layout.barcodeMid.h)}" preserveAspectRatio="none" />
    <text x="${pxX(layout.pnText.x)}" y="${pxY(layout.pnText.y)}" fill="#231815" font-family="Arial" font-size="${12 * SCALE_Y}">[P]P/N:${escapeXml(pnRaw)}</text>
    <text x="${pxX(layout.vd.x)}" y="${pxY(layout.vd.y)}" fill="#231815" font-family="Arial" font-size="${10.5 * SCALE_Y}">VD:${escapeXml(vdText)}</text>

    <image href="${barcodes.qtyBarcode}" x="${pxX(layout.barcodeLow.x)}" y="${pxY(layout.barcodeLow.y)}" width="${pxW(layout.barcodeLow.w)}" height="${pxH(layout.barcodeLow.h)}" preserveAspectRatio="none" />
    <text x="${pxX(layout.qtyText.x)}" y="${pxY(layout.qtyText.y)}" fill="#231815" font-family="Arial" font-size="${12 * SCALE_Y}">[Q]QTY:${escapeXml(qtyRaw)}</text>

    <image href="${barcodes.mpnBarcode}" x="${pxX(layout.barcodeMpn.x)}" y="${pxY(layout.barcodeMpn.y)}" width="${pxW(layout.barcodeMpn.w)}" height="${pxH(layout.barcodeMpn.h)}" preserveAspectRatio="none" />
    <text x="${pxX(layout.mpnText.x)}" y="${pxY(layout.mpnText.y)}" fill="#231815" font-family="Arial" font-size="${12 * SCALE_Y}">[1P]MPN(QVL):${escapeXml(mpnRaw)}</text>

    <text x="${pxX(layout.maker.x)}" y="${pxY(layout.maker.y)}" fill="#231815" font-family="Arial" font-size="${10.5 * SCALE_Y}">MAKER NAME: ${escapeXml(makerName)}</text>
    <text x="${pxX(layout.coo.x)}" y="${pxY(layout.coo.y)}" fill="#231815" font-family="Arial" font-size="${10.5 * SCALE_Y}">(4L)CoO: ${escapeXml(cooText)}</text>

    <image href="${qrPng}" x="${pxX(layout.qr.x)}" y="${pxY(layout.qr.y)}" width="${qrSizePx}" height="${qrSizePx}" preserveAspectRatio="none" />
  </g>
</svg>`;
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
