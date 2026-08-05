#!/usr/bin/env node
/**
 * png-geometry.js — 零相依的 PNG 幾何檢查：整體尺寸 + 不透明內容的邊界框
 * Zero-dependency PNG geometry check: canvas size plus the bounding box of non-transparent pixels.
 *
 * Created: 2026-08-05
 *
 * 為什麼需要它：Chrome Web Store 的商店圖示規格是「128x128 畫布、圖形只佔中央 96x96、
 * 四周 16px 透明邊」。只驗 IHDR 的寬高擋不住這條 —— 忘了加留白參數的輸出**照樣是
 * 128x128**，卻會因留白不足被退件。要守住規格就得真的看像素的 alpha。
 *
 * 只用 node 內建的 zlib，不引入 sharp/pngjs：本 repo 的測試線一律零相依，
 * 而且這支同時要在 CI 的 ubuntu runner 上跑。
 *
 * 用法：
 *   node tools/png-geometry.js <file.png>
 *   node tools/png-geometry.js <file.png> --expect-size 128x128 --expect-content 16,16,96,96
 * 有 --expect-* 時不合規以 exit 1 結束，並印出 GitHub Actions 認得的 ::error:: 行。
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ALPHA_CHANNEL_INDEX = { 4: 1, 6: 3 }; // 灰階+alpha 的 alpha 在第 2 個 byte，RGBA 在第 4 個

/** 讀出所有 chunk。PNG 的結構是 [長度 4][型別 4][資料][CRC 4] 重複到 IEND。 */
function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('不是 PNG 檔（簽章不符）');
  const chunks = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: buf.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

function readHeader(ihdr) {
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    bitDepth: ihdr.readUInt8(8),
    colorType: ihdr.readUInt8(9),
    interlace: ihdr.readUInt8(12),
  };
}

/** Paeth predictor，PNG 規格 9.4 的定義。 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 逐條 scanline 還原 filter，回傳未過濾的像素位元組。 */
function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? cur[x - bytesPerPixel] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
      const v = line[x];
      switch (filter) {
        case 0: cur[x] = v; break;
        case 1: cur[x] = (v + a) & 0xff; break;
        case 2: cur[x] = (v + b) & 0xff; break;
        case 3: cur[x] = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[x] = (v + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`未知的 scanline filter：${filter}`);
      }
    }
  }
  return out;
}

/**
 * 量出 PNG 的畫布尺寸與不透明內容的邊界框。
 * 沒有 alpha 通道的圖一律視為整張都是內容。
 */
function measure(file) {
  const chunks = readChunks(fs.readFileSync(file));
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('缺少 IHDR chunk');
  const { width, height, bitDepth, colorType, interlace } = readHeader(ihdr.data);

  const alphaIndex = ALPHA_CHANNEL_INDEX[colorType];
  // 支援範圍刻意收窄：本 repo 的素材全部由 rsvg-convert 產生，一律 8-bit 非交錯。
  // 遇到範圍外的檔案就明講不支援，而不是安靜地量出一個錯的邊界框。
  if (alphaIndex === undefined || bitDepth !== 8 || interlace !== 0) {
    return { width, height, content: { x: 0, y: 0, width, height }, alphaMeasured: false };
  }

  const bytesPerPixel = CHANNELS_BY_COLOR_TYPE[colorType];
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unfilter(zlib.inflateSync(idat), width, height, bytesPerPixel);

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * bytesPerPixel + alphaIndex] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const content = maxX < 0
    ? { x: 0, y: 0, width: 0, height: 0 } // 整張全透明
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { width, height, content, alphaMeasured: true };
}

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const opts = { file, expectSize: null, expectContent: null };
  // 各參數的分隔符與應有的數字個數。解析失敗一律當場喊，不讓 NaN 流到比較式 ——
  // NaN !== NaN 會讓檢查變成「永遠失敗」，寫在 CI 裡更容易被誤判成素材壞掉而去改素材。
  const SPEC = {
    '--expect-size': { key: 'expectSize', separator: 'x', count: 2 },
    '--expect-content': { key: 'expectContent', separator: ',', count: 4 },
  };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    const spec = SPEC[flag];
    if (!spec) throw new Error(`未知的參數：${flag}`);
    if (value === undefined) throw new Error(`${flag} 少了值`);
    const nums = value.split(spec.separator).map(Number);
    if (nums.length !== spec.count || nums.some((n) => !Number.isFinite(n))) {
      throw new Error(`${flag} 的值格式不對：${value}`);
    }
    opts[spec.key] = nums;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('用法：node tools/png-geometry.js <file.png> [--expect-size WxH] [--expect-content x,y,w,h]');
    process.exit(2);
  }
  if (!fs.existsSync(opts.file)) {
    console.error(`::error::找不到檔案 ${opts.file}`);
    process.exit(1);
  }

  const { width, height, content, alphaMeasured } = measure(opts.file);
  const describe = `${opts.file} 畫布 ${width}x${height}`
    + (alphaMeasured ? `，內容 ${content.width}x${content.height} @ (${content.x},${content.y})` : '（無 alpha，未量內容）');

  const problems = [];
  if (opts.expectSize) {
    const [ew, eh] = opts.expectSize;
    if (width !== ew || height !== eh) problems.push(`畫布是 ${width}x${height}，要求 ${ew}x${eh}`);
  }
  if (opts.expectContent) {
    const [ex, ey, ew, eh] = opts.expectContent;
    if (!alphaMeasured) problems.push('這張圖沒有可量的 alpha 通道，無法驗證留白');
    else if (content.x !== ex || content.y !== ey || content.width !== ew || content.height !== eh) {
      problems.push(
        `內容是 ${content.width}x${content.height} @ (${content.x},${content.y})，`
        + `要求 ${ew}x${eh} @ (${ex},${ey})——留白不符商店規格`
      );
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`::error::${opts.file}：${p}`);
    process.exit(1);
  }
  console.log(`${describe} 正確`);
}

if (require.main === module) main();

module.exports = { measure };
