// ─── textures.js ──────────────────────────────────────────────────────────────
// 方块贴图集：Minecraft 原版贴图（assets/textures/block/，爬取自
// InventivetalentDev/minecraft-assets 1.20.1 镜像，个人测试用）。
//
// 原版贴图的"生物群系染色"机制：
//   grass_block_top / water_still 存储为灰度图，游戏运行时按群系乘颜色；
//   oak_leaves 是近灰度+透明孔隙。
//   → 组装贴图集时在离屏 canvas 上做 multiply 染色：
//     草顶 ×#91BD59（平原绿）、树叶 ×#77AB2F（橡树绿）、水 ×#3F76E4（水蓝）
//   树叶/水有透明像素 → 先铺不透明底色再叠加，避免方块接缝透视。
//
// 贴图格布局（ATLAS_COLS=4, ATLAS_ROWS=5）：
//   行0: [0] grass_top  [1] grass_side  [2] dirt       [3] stone
//   行1: [4] sand       [5] wood_top    [6] wood_side   [7] leaves
//   行2: [8] water      [9] red_wall   [10] gold_roof  [11] white_stone
//   行3: [12] gray_brick [13] gray_roof [14] red_pillar [15] planks
//   行4: [16] cobble    [17] mud_brick  （余留空位）
//
// BTEX[blockId] = [top格, side格, bot格]
// loadTextures(callback) — 异步加载完成后设置 atlasTexture 并回调

var ATLAS_COLS = 4, ATLAS_ROWS = 5, TILE = 16;

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

// 贴图格定义：file = assets/textures/block/ 下的文件名
//   tint     — multiply 染色（CSS 颜色），用于原版灰度贴图
//   backdrop — 先铺的不透明底色（处理透明像素）
var _TILES = [
  { file: 'grass_block_top',  tint: '#91bd59' },                       // 0  草顶
  { file: 'grass_block_side' },                                        // 1  草侧
  { file: 'dirt' },                                                    // 2  泥土
  { file: 'stone' },                                                   // 3  石头
  { file: 'sand' },                                                    // 4  沙子
  { file: 'oak_log_top' },                                             // 5  木顶
  { file: 'oak_log' },                                                 // 6  木侧
  { file: 'oak_leaves',       tint: '#77ab2f', backdrop: '#1a3008' },  // 7  树叶
  { file: 'water_still',      tint: '#3f76e4', backdrop: '#1a3f8f' },  // 8  水
  { file: 'bricks',           tint: '#c73a2d' },                       // 9  朱红宫墙
  { file: 'sandstone',        tint: '#c8a418' },                       // 10 黄色琉璃瓦
  { file: 'stone_bricks',     tint: '#e0ddd0' },                       // 11 汉白玉台基
  { file: 'stone_bricks' },                                            // 12 青砖铺地
  { file: 'stone',            tint: '#7a8a99' },                       // 13 灰瓦屋顶
  { file: 'terracotta',       tint: '#c04830' },                       // 14 朱红立柱
  { file: 'oak_planks' },                                              // 15 木板
  { file: 'cobblestone' },                                             // 16 卵石
  { file: 'sandstone',        tint: '#c2a06a' },                       // 17 土砖
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
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
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
