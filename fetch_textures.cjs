// 下载 ambientCG CC0 写实贴图 → 解压 → 缩放 256×256 → 存 assets/textures/block/
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');
const sharp = require('sharp');

const OUT = path.join(__dirname, 'assets/textures/block');
const TMP = '/tmp/acg_zips';
fs.mkdirSync(TMP, { recursive: true });

// [目标文件名（去.png）, ambientCG asset id, ZIP内color文件名]
const TEXTURES = [
  // 地形基础
  ['grass_block_top',  'Ground054',         'Ground054_1K-PNG_Color.png'],
  ['grass_block_side', 'Ground054',         'Ground054_1K-PNG_Color.png'],  // 暂用同一张，后面单独处理
  ['dirt',             'Ground037',         'Ground037_1K-PNG_Color.png'],
  ['stone',            'Rock022',           'Rock022_1K-PNG_Color.png'],
  ['sand',             'Ground025',         'Ground025_1K-PNG_Color.png'],
  ['oak_log_top',      'WoodFloor050',      'WoodFloor050_1K-PNG_Color.png'],
  ['oak_log',          'Bark008',           'Bark008_1K-PNG_Color.png'],
  ['water_still',      'Water002',          'Water002_1K-PNG_Color.png'],
  // 建筑
  ['bricks',           'Bricks051',         'Bricks051_1K-PNG_Color.png'],
  ['sandstone',        'RoofingTiles002',   'RoofingTiles002_1K-PNG_Color.png'],
  ['stone_bricks',     'Marble012',         'Marble012_1K-PNG_Color.png'],
  ['cobblestone',      'PavingStones150',   'PavingStones150_1K-PNG_Color.png'],
  ['terracotta',       'GlazedTerracotta001','GlazedTerracotta001_1K-PNG_Color.png'],
  ['oak_planks',       'Planks037A',        'Planks037A_1K-PNG_Color.png'],
  ['oak_leaves',       'Ground079',         'Ground079_1K-PNG_Color.png'],
];

// 先用原 stone_bricks 作为 gray_brick（PavingStones142），单独一行
TEXTURES.push(['stone_bricks_gray', 'PavingStones142', 'PavingStones142_1K-PNG_Color.png']);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) { resolve(dest); return; }
    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    function get(u) {
      https.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location); return; }
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' ' + u)); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); fs.renameSync(tmp, dest); resolve(dest); });
      }).on('error', reject);
    }
    get(url);
  });
}

function extractPng(zipPath, entryName) {
  // 手动解析 ZIP（local file headers）找到目标 entry 并解压
  const buf = fs.readFileSync(zipPath);
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compMethod  = buf.readUInt16LE(offset + 8);
    const compSize    = buf.readUInt32LE(offset + 18);
    const nameLen     = buf.readUInt16LE(offset + 26);
    const extraLen    = buf.readUInt16LE(offset + 28);
    const name        = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart   = offset + 30 + nameLen + extraLen;
    if (name === entryName || name.endsWith('/' + entryName)) {
      const compData = buf.slice(dataStart, dataStart + compSize);
      if (compMethod === 0) return compData;          // stored
      if (compMethod === 8) return zlib.inflateRawSync(compData);  // deflate
      throw new Error('unsupported compression ' + compMethod);
    }
    offset = dataStart + compSize;
  }
  // 如果精确匹配失败，尝试模糊匹配（有时路径含子目录）
  offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) { offset++; continue; }
    const compMethod = buf.readUInt16LE(offset + 8);
    const compSize   = buf.readUInt32LE(offset + 18);
    const nameLen    = buf.readUInt16LE(offset + 26);
    const extraLen   = buf.readUInt16LE(offset + 28);
    const name       = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
    const dataStart  = offset + 30 + nameLen + extraLen;
    if (name.includes('_Color.png')) {
      const compData = buf.slice(dataStart, dataStart + compSize);
      console.log('  fuzzy match:', name);
      if (compMethod === 0) return compData;
      if (compMethod === 8) return zlib.inflateRawSync(compData);
    }
    offset = dataStart + compSize;
  }
  throw new Error('entry not found: ' + entryName);
}

async function processOne(outName, assetId, colorFile) {
  const url     = 'https://ambientcg.com/get?file=' + assetId + '_1K-PNG.zip';
  const zipPath = path.join(TMP, assetId + '.zip');
  const outPath = path.join(OUT, outName + '.png');

  process.stdout.write('  ' + assetId + ' → ' + outName + '.png ... ');
  try {
    await download(url, zipPath);
    const pngData = extractPng(zipPath, colorFile);
    await sharp(pngData).resize(256, 256).toFile(outPath);
    console.log('OK');
  } catch (e) {
    console.log('FAIL: ' + e.message);
  }
}

async function main() {
  // 去重下载（相同 assetId 只下一次）
  const done = new Set();
  for (const [out, id, color] of TEXTURES) {
    const key = id + '|' + out;
    if (done.has(key)) continue;
    done.add(key);
    await processOne(out, id, color);
  }
  console.log('\n完成。');
}

main().catch(console.error);
