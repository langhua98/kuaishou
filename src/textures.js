// ─── textures.js ──────────────────────────────────────────────────────────────
// 程序化生成方块贴图集（64×48 canvas，4×3 个 16×16 像素格）。
// 使用 TWO 的 CanvasTexture，NearestFilter 保持像素风格。
//
// 贴图格布局：
//   [0] grass_top  [1] grass_side  [2] dirt      [3] stone
//   [4] sand       [5] wood_top    [6] wood_side  [7] leaves
//   [8] water
//
// BTEX[blockId] = [top格, side格, bottom格]

var ATLAS_COLS = 4, ATLAS_ROWS = 3, TILE = 16;

var BTEX = [
  null,        // AIR
  [0, 1, 2],   // GRASS: 草顶 / 草侧 / 泥土
  [2, 2, 2],   // DIRT
  [3, 3, 3],   // STONE
  [4, 4, 4],   // SAND
  [5, 6, 5],   // WOOD: 年轮顶 / 竖纹侧 / 年轮底
  [7, 7, 7],   // LEAVES
  [8, 8, 8],   // WATER
];

var atlasTexture = (function () {
  var W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;  // 64 × 48
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');

  // 线性同余伪随机（可复现）
  function rng(seed) {
    var s = (seed + 1) >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  // 瓦片偏移
  function ox(i) { return (i % ATLAS_COLS) * TILE; }
  function oy(i) { return Math.floor(i / ATLAS_COLS) * TILE; }

  // 简单噪声底纹
  function noise(ti, r, g, b, dev) {
    var x = ox(ti), y = oy(ti), rd = rng(ti * 137);
    for (var py = 0; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var n = (rd() - 0.5) * dev;
        ctx.fillStyle = 'rgb(' + clamp(r+n) + ',' + clamp(g+n) + ',' + clamp(b+n) + ')';
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
  }

  // ── 0: 草地顶面 ────────────────────────────────────────────────────────────
  (function () {
    var x = ox(0), y = oy(0), rd = rng(0);
    for (var py = 0; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var n = (rd() - 0.5) * 32;
        ctx.fillStyle = 'rgb(' + clamp(85+n*0.4) + ',' + clamp(162+n) + ',' + clamp(44+n*0.3) + ')';
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
    // 细草叶点缀
    var rd2 = rng(500);
    for (var i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(60,130,20,0.55)';
      ctx.fillRect(x + (rd2()*14)|0, y + (rd2()*14)|0, 2, 2);
    }
  }());

  // ── 1: 草地侧面 ────────────────────────────────────────────────────────────
  (function () {
    var x = ox(1), y = oy(1), rd = rng(1);
    // 下方：泥土
    for (var py = 3; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var n = (rd() - 0.5) * 22;
        ctx.fillStyle = 'rgb(' + clamp(132+n*0.6) + ',' + clamp(94+n*0.5) + ',' + clamp(65+n*0.3) + ')';
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
    // 上方：草绿（3 行，营造草皮厚度感）
    var rd2 = rng(501);
    for (var py2 = 0; py2 < 3; py2++) {
      for (var px2 = 0; px2 < TILE; px2++) {
        var n2 = (rd2() - 0.5) * 28;
        ctx.fillStyle = 'rgb(' + clamp(78+n2*0.4) + ',' + clamp(155+n2) + ',' + clamp(38+n2*0.3) + ')';
        ctx.fillRect(x+px2, y+py2, 1, 1);
      }
    }
  }());

  // ── 2: 泥土 ────────────────────────────────────────────────────────────────
  noise(2, 132, 94, 65, 24);

  // ── 3: 石头 ────────────────────────────────────────────────────────────────
  (function () {
    noise(3, 128, 128, 128, 22);
    var x = ox(3), y = oy(3), rd = rng(333);
    // 裂纹
    ctx.strokeStyle = 'rgba(70,70,70,0.65)';
    ctx.lineWidth = 1;
    for (var i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + rd()*16, y + rd()*16);
      ctx.lineTo(x + rd()*16, y + rd()*16);
      ctx.stroke();
    }
    // 浅色矿点
    var rd2 = rng(334);
    for (var j = 0; j < 3; j++) {
      ctx.fillStyle = 'rgba(200,200,200,0.4)';
      ctx.fillRect(x + (rd2()*14)|0, y + (rd2()*14)|0, 2, 2);
    }
  }());

  // ── 4: 沙子 ────────────────────────────────────────────────────────────────
  noise(4, 216, 198, 128, 22);

  // ── 5: 木头顶面（年轮）──────────────────────────────────────────────────────
  (function () {
    noise(5, 178, 138, 76, 14);
    var x = ox(5) + 7.5, y = oy(5) + 7.5;
    ctx.strokeStyle = 'rgba(110,75,30,0.6)';
    for (var r = 2; r <= 7; r += 2.2) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }());

  // ── 6: 木头侧面（竖纹）──────────────────────────────────────────────────────
  (function () {
    var x = ox(6), y = oy(6), rd = rng(6);
    for (var px = 0; px < TILE; px++) {
      // 每列一个基准色调（浅褐 ↔ 深褐），形成竖纹
      var t = 130 + (rd() * 56) | 0;
      var rd2 = rng(600 + px);
      for (var py = 0; py < TILE; py++) {
        var n = (rd2() - 0.5) * 12;
        ctx.fillStyle = 'rgb(' + clamp(t+n) + ',' + clamp(t*0.73+n) + ',' + clamp(t*0.38+n) + ')';
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
  }());

  // ── 7: 树叶 ────────────────────────────────────────────────────────────────
  (function () {
    var x = ox(7), y = oy(7), rd = rng(7);
    for (var py = 0; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var v = rd();
        if (v < 0.10) {
          ctx.fillStyle = 'rgb(18,38,14)';  // 小孔隙（深色）
        } else {
          var br = (v * 55 + 55) | 0;
          ctx.fillStyle = 'rgb(' + clamp(24+br*0.3) + ',' + clamp(br*1.22) + ',' + clamp(18+br*0.22) + ')';
        }
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
  }());

  // ── 8: 水面 ────────────────────────────────────────────────────────────────
  (function () {
    var x = ox(8), y = oy(8), rd = rng(8);
    for (var py = 0; py < TILE; py++) {
      for (var px = 0; px < TILE; px++) {
        var n = (rd() - 0.5) * 28;
        ctx.fillStyle = 'rgb(' + clamp(38+n*0.3) + ',' + clamp(108+n*0.6) + ',' + clamp(210+n) + ')';
        ctx.fillRect(x+px, y+py, 1, 1);
      }
    }
  }());

  var tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;  // 像素风，禁止平滑插值
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}());
