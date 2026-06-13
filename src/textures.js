// ─── textures.js ──────────────────────────────────────────────────────────────
// 方块贴图集：Kenney Voxel Pack（CC0，128×128，专为方块游戏设计的风格化贴图）
//   https://kenney.nl/assets/voxel-pack
//
// 贴图格布局（ATLAS_COLS=4, ATLAS_ROWS=8, TILE=128）：
//   行0: [0] grass_top  [1] grass_side  [2] dirt       [3] stone
//   行1: [4] sand       [5] wood_top    [6] wood_side   [7] leaves
//   行2: [8] water      [9] red_wall   [10] gold_roof  [11] white_stone
//   行3: [12] gray_brick [13] gray_roof [14] red_pillar [15] planks
//   行4: [16] cobble    [17] mud_brick  [18] territory
//   行5: [19] ice       [20] snow       [21] iron_ore   [22] glass
//   行6: [23] obsidian  [24] gravel     [25] red_sand   [26] tnt_top
//   行7: [27] tnt_side  [28] tnt_bot    [29] pumpkin_top [30] pumpkin_side [31] coal_ore
//
// BTEX[blockId] = [top格, side格, bot格]
// loadTextures(callback) — 异步加载完成后设置 atlasTexture 并回调

var ATLAS_COLS = 4, ATLAS_ROWS = 16, TILE = 128;

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
  [18, 18, 18],   // TERRITORY_STONE 领地石
  [19, 19, 19],   // ICE         冰
  [20, 20, 20],   // SNOW        雪
  [21, 21, 21],   // IRON_ORE    铁矿
  [22, 22, 22],   // GLASS       玻璃
  [23, 23, 23],   // OBSIDIAN    黑曜石
  [24, 24, 24],   // GRAVEL      砾石
  [25, 25, 25],   // RED_SAND    红沙
  [26, 27, 28],   // TNT         顶/侧/底不同贴图
  [29, 30, 29],   // PUMPKIN     顶/侧/顶
  [31, 31, 31],   // COAL_ORE    煤矿
  [33, 33, 33],   // BIRCH_LOG       白桦木（侧面即全面）
  [34, 34, 34],   // BIRCH_LEAVES    白桦叶
  [35, 35, 35],   // SPRUCE_LOG      云杉木
  [36, 36, 36],   // SPRUCE_LEAVES   云杉叶
  [32, 32, 32],   // BEDROCK         基岩
  [37, 37, 37],   // BLUE_WOOL       蓝羊毛
  [38, 38, 38],   // GREEN_WOOL      绿羊毛
  [39, 39, 39],   // RED_WOOL        红羊毛
  [40, 40, 40],   // WHITE_WOOL      白羊毛
  [41, 41, 41],   // YELLOW_WOOL     黄羊毛
  [42, 42, 42],   // BOOKSHELF       书架
  [29, 43, 29],   // CARVED_PUMPKIN  雕刻南瓜（顶=南瓜顶，侧=雕刻面）
  [44, 45, 44],   // CRAFTING_TABLE  工作台
  [46, 46, 46],   // DIAMOND_ORE     钻石矿
  [47, 47, 47],   // EMERALD_ORE     绿宝石矿
  [48, 48, 48],   // GOLD_ORE        金矿
  [49, 49, 49],   // REDSTONE_ORE    红石矿
  [50, 51, 50],   // FURNACE         熔炉
  [52, 52, 52],   // LAVA            熔岩
  [53, 54, 53],   // MELON           西瓜
  [55, 55, 55],   // MOSSY_COBBLE    苔石
  [56, 56, 56],   // DANDELION       蒲公英
  [57, 57, 57],   // POPPY           虞美人
  [58, 58, 58],   // OAK_SAPLING     橡树苗
  [59, 59, 59],   // GRASS_PLANT     草丛
  [60, 60, 60],   // PACKED_ICE      浮冰
  [61, 61, 61],   // SANDSTONE       砂岩
];

var atlasTexture = null;

// 贴图格定义：file = assets/textures/block/ 下的文件名（Kenney Voxel Pack，128×128）
//   tint     — multiply 染色（CSS 颜色），仅金瓦使用
//   backdrop — 先铺的不透明底色（处理透明像素，当前全部不透明无需使用）
var _TILES = [
  { file: 'grass_block_top' },                  // 0  草顶   grass_top
  { file: 'grass_block_side' },                 // 1  草侧   dirt_grass
  { file: 'dirt' },                             // 2  泥土   dirt
  { file: 'stone' },                            // 3  石头   stone
  { file: 'sand' },                             // 4  沙子   sand
  { file: 'oak_log_top' },                      // 5  木顶   trunk_top
  { file: 'oak_log' },                          // 6  木侧   trunk_side
  { file: 'oak_leaves' },                       // 7  树叶   leaves
  { file: 'water_still' },                      // 8  水     water
  { file: 'bricks' },                           // 9  朱红宫墙 brick_red
  { file: 'gold_roof', tint: '#e0b21f' },       // 10 黄色琉璃瓦 cotton_tan+金染
  { file: 'white_stone' },                      // 11 汉白玉台基 greysand
  { file: 'gray_brick' },                       // 12 青砖铺地 brick_grey
  { file: 'gray_roof' },                        // 13 灰瓦屋顶 greystone
  { file: 'red_pillar' },                       // 14 朱红立柱 wood_red
  { file: 'oak_planks' },                       // 15 木板   wood
  { file: 'cobblestone' },                      // 16 卵石   gravel_stone
  { file: 'mud_brick' },                        // 17 土砖   stone_sand
  { file: 'white_stone', tint: '#9333ea' },     // 18 领地石  紫色结界
  { file: 'ice' },                              // 19 冰
  { file: 'snow' },                             // 20 雪
  { file: 'iron_ore' },                         // 21 铁矿
  { file: 'glass' },                            // 22 玻璃
  { file: 'obsidian' },                         // 23 黑曜石
  { file: 'gravel' },                           // 24 砾石
  { file: 'red_sand' },                         // 25 红沙
  { file: 'tnt_top' },                          // 26 TNT顶
  { file: 'tnt_side' },                         // 27 TNT侧
  { file: 'tnt_bottom' },                       // 28 TNT底
  { file: 'pumpkin_top' },                      // 29 南瓜顶
  { file: 'pumpkin_side' },                     // 30 南瓜侧
  { file: 'coal_ore' },                         // 31 煤矿
  // 行8-15（扩展方块贴图格，索引 32-61）
  { file: 'bedrock' },                          // 32 基岩
  { file: 'birch_log' },                        // 33 白桦木侧
  { file: 'birch_leaves' },                     // 34 白桦叶
  { file: 'spruce_log' },                       // 35 云杉木侧
  { file: 'spruce_leaves' },                    // 36 云杉叶
  { file: 'blue_wool' },                        // 37 蓝羊毛
  { file: 'green_wool' },                       // 38 绿羊毛
  { file: 'red_wool' },                         // 39 红羊毛
  { file: 'white_wool' },                       // 40 白羊毛
  { file: 'yellow_wool' },                      // 41 黄羊毛
  { file: 'bookshelf' },                        // 42 书架
  { file: 'carved_pumpkin' },                   // 43 雕刻南瓜侧
  { file: 'crafting_table_top' },               // 44 工作台顶
  { file: 'crafting_table_side' },              // 45 工作台侧
  { file: 'diamond_ore' },                      // 46 钻石矿
  { file: 'emerald_ore' },                      // 47 绿宝石矿
  { file: 'gold_ore' },                         // 48 金矿
  { file: 'redstone_ore' },                     // 49 红石矿
  { file: 'furnace_top' },                      // 50 熔炉顶
  { file: 'furnace_side' },                     // 51 熔炉侧
  { file: 'lava_still' },                       // 52 熔岩
  { file: 'melon_top' },                        // 53 西瓜顶
  { file: 'melon_side' },                       // 54 西瓜侧
  { file: 'mossy_cobblestone' },                // 55 苔石
  { file: 'dandelion' },                        // 56 蒲公英
  { file: 'poppy' },                            // 57 虞美人
  { file: 'oak_sapling' },                      // 58 橡树苗
  { file: 'grass_plant' },                      // 59 草丛
  { file: 'packed_ice' },                       // 60 浮冰
  { file: 'sandstone_top' },                    // 61 砂岩
];

// 单格处理：染色（multiply 保留 alpha）后画入贴图集
function _drawTile(ctx, img, spec, dx, dy) {
  if (spec.backdrop) {
    ctx.fillStyle = spec.backdrop;
    ctx.fillRect(dx, dy, TILE, TILE);
  }

  if (!spec.tint) {
    // 按图片真实尺寸裁切后缩放填满 TILE×TILE（兼容 16×16 和 128×128 贴图）
    ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, TILE, TILE);
    return;
  }

  // 离屏染色：画原图 → multiply 乘色 → destination-in 恢复原 alpha
  var oc = document.createElement('canvas');
  oc.width = oc.height = TILE;
  var octx = oc.getContext('2d');
  octx.drawImage(img, 0, 0, img.width, img.height, 0, 0, TILE, TILE);
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
    // 贴图集禁用 mipmap：缩小级别会把相邻贴图格颜色混入（atlas bleeding），
    // 远景方块串色。Kenney 贴图为低频平滑风格，Linear 缩小的闪烁可忽略。
    atlasTexture = new THREE.CanvasTexture(cv);
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearFilter;
    atlasTexture.generateMipmaps = false;
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
