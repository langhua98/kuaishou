// ─── textures.js ──────────────────────────────────────────────────────────────
// 方块贴图集：CC0 写实贴图（ambientCG，256×256，assets/textures/block/）。
//
// 贴图格布局（ATLAS_COLS=4, ATLAS_ROWS=5, TILE=256）：
//   行0: [0] grass_top  [1] grass_side  [2] dirt       [3] stone
//   行1: [4] sand       [5] wood_top    [6] wood_side   [7] leaves
//   行2: [8] water      [9] red_wall   [10] gold_roof  [11] white_stone
//   行3: [12] gray_brick [13] gray_roof [14] red_pillar [15] planks
//   行4: [16] cobble    [17] mud_brick  （余留空位）
//
// BTEX[blockId] = [top格, side格, bot格]
// loadTextures(callback) — 异步加载完成后设置 atlasTexture 并回调

var ATLAS_COLS = 4, ATLAS_ROWS = 5, TILE = 256;

var BTEX = [
  null,           // AIR
  [0,  1,  2],    // GRASS
  [2,  2,  2],    // DIRT
  [3,  3,  3],    // STONE
  [4,  4,  4],    // SAND
  [5,  6,  5],    // WOOD
  [7,  7,  7],    // LEAVES
  [8,  8,  8],    // WATER
  [9,  9,  9],    // RED_WALL    朱红宫墙
  [10, 10, 10],   // GOLD_ROOF   黄色琉璃瓦
  [11, 11, 11],   // WHITE_STONE 汉白玉台基
  [12, 12, 12],   // GRAY_BRICK  青砖铺地
  [13, 13, 13],   // GRAY_ROOF   灰瓦屋顶
  [14, 14, 14],   // RED_PILLAR  朱红立柱
  [15, 15, 15],   // PLANKS      木板
  [16, 16, 16],   // COBBLE      卵石
  [17, 17, 17],   // MUD_BRICK   土砖
];

var atlasTexture = null;

// 贴图格定义：file = assets/textures/block/ 下的文件名（CC0 写实贴图，256×256）
//   tint     — multiply 染色（CSS 颜色）
//   backdrop — 先铺的不透明底色（处理透明/暗色底图）
var _TILES = [
  { file: 'grass_block_top',  tint: '#91bd59' },                       // 0  草顶   Ground054+绿染
  { file: 'grass_block_side' },                                        // 1  草侧   Ground054/Ground037合成
  { file: 'dirt' },                                                    // 2  泥土   Ground037
  { file: 'stone' },                                                   // 3  石头   Rock022
  { file: 'sand' },                                                    // 4  沙子   Ground025
  { file: 'oak_log_top' },                                             // 5  木顶   WoodFloor050
  { file: 'oak_log' },                                                 // 6  木侧   Bark008
  { file: 'oak_leaves',       tint: '#5a9e28', backdrop: '#1a3008' },  // 7  树叶   Moss001+绿染
  { file: 'stone',            tint: '#1855a0', backdrop: '#0c2d60' },  // 8  水     Rock022+蓝染
  { file: 'bricks' },                                                  // 9  朱红宫墙 Bricks051（自然红砖）
  { file: 'sandstone',        tint: '#c8a030' },                       // 10 黄色琉璃瓦 RoofingTiles002+金染
  { file: 'stone_bricks' },                                            // 11 汉白玉台基 Marble012（白大理石）
  { file: 'paving_stones' },                                           // 12 青砖铺地 PavingStones142（深灰）
  { file: 'sandstone' },                                               // 13 灰瓦屋顶 RoofingTiles002（原色）
  { file: 'terracotta' },                                              // 14 朱红立柱 GlazedTerracotta001
  { file: 'oak_planks' },                                              // 15 木板   Planks037A
  { file: 'cobblestone' },                                             // 16 卵石   PavingStones150
  { file: 'dirt',             tint: '#a08040' },                       // 17 土砖   Ground037+暖棕染
];

// 单格处理：染色（multiply 保留 alpha）后画入贴图集
function _drawTile(ctx, img, spec, dx, dy) {
  if (spec.backdrop) {
    ctx.fillStyle = spec.backdrop;
    ctx.fillRect(dx, dy, TILE, TILE);
  }

  if (!spec.tint) {
    // 直接绘制（取左上 16×16，动画贴图自动取首帧）
    ctx.drawImage(img, 0, 0, TILE, TILE, dx, dy, TILE, TILE);
    return;
  }

  // 离屏染色：画原图 → multiply 乘色 → destination-in 恢复原 alpha
  var oc = document.createElement('canvas');
  oc.width = oc.height = TILE;
  var octx = oc.getContext('2d');
  octx.drawImage(img, 0, 0, TILE, TILE, 0, 0, TILE, TILE);
  octx.globalCompositeOperation = 'multiply';
  octx.fillStyle = spec.tint;
  octx.fillRect(0, 0, TILE, TILE);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(img, 0, 0, TILE, TILE, 0, 0, TILE, TILE);
  ctx.drawImage(oc, dx, dy);
}

function loadTextures(onReady) {
  var W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');

  var imgs = [], total = _TILES.length, done = 0;

  function allLoaded() {
    var i, dx, dy;
    for (i = 0; i < total; i++) {
      dx = (i % ATLAS_COLS) * TILE;
      dy = ((i / ATLAS_COLS) | 0) * TILE;
      if (imgs[i]) {
        _drawTile(ctx, imgs[i], _TILES[i], dx, dy);
      } else {
        ctx.fillStyle = '#ff00ff';   // 加载失败：洋红占位
        ctx.fillRect(dx, dy, TILE, TILE);
      }
    }
    atlasTexture = new THREE.CanvasTexture(cv);
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTexture.generateMipmaps = true;
    atlasTexture.needsUpdate = true;
    onReady();
  }

  _TILES.forEach(function (spec, i) {
    var img = new Image();
    img.onload  = function () { imgs[i] = img;  if (++done === total) allLoaded(); };
    img.onerror = function () { imgs[i] = null; if (++done === total) allLoaded(); };
    img.src = 'assets/textures/block/' + spec.file + '.png';
  });
}
