// ─── world.js ─────────────────────────────────────────────────────────────────
// 世界数据层：区块存储、方块读写、地形生成。
//
// 坐标约定：
//   世界坐标 (wx, wy, wz)：整数，绝对方块位置
//   区块坐标 (cx, cz)：整数，cx = floor(wx / CHUNK_W)
//   局部坐标 (lx, lz)：区块内偏移，[0, CHUNK_W)
//
// 区块数据布局：Uint8Array，索引 = lx + wy*CHUNK_W + lz*CHUNK_W*CHUNK_H
// 每个元素是方块 ID（见 constants.js）。

var chunks = {};  // 已加载区块，键 = "cx,cz"

function ckey(cx, cz) { return cx + ',' + cz; }
function gchunk(cx, cz) { return chunks[ckey(cx, cz)]; }

// 读取世界坐标 (wx, wy, wz) 的方块 ID
// 超出高度范围：wy<0 返回 STONE，wy>=CHUNK_H 返回 AIR
// 区块未加载时返回 AIR（不触发加载）
function getBlock(wx, wy, wz) {
  if (wy < 0)        return STONE;
  if (wy >= CHUNK_H) return AIR;
  var cx = Math.floor(wx / CHUNK_W);
  var cz = Math.floor(wz / CHUNK_D);
  var ch = gchunk(cx, cz);
  if (!ch) return AIR;
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
  return ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H];
}

// 写入方块并重建受影响的区块网格（含跨区块边界时相邻区块）
function setBlock(wx, wy, wz, id) {
  if (wy < 0 || wy >= CHUNK_H) return;
  var cx = Math.floor(wx / CHUNK_W);
  var cz = Math.floor(wz / CHUNK_D);
  var ch = gchunk(cx, cz);
  if (!ch) return;
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
  ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
  // 总是重建本区块
  rebuildChunk(cx, cz);
  // 若改动在区块边界，相邻区块的外露面也需更新
  if (lx === 0)          rebuildChunk(cx - 1, cz);
  if (lx === CHUNK_W-1)  rebuildChunk(cx + 1, cz);
  if (lz === 0)          rebuildChunk(cx, cz - 1);
  if (lz === CHUNK_D-1)  rebuildChunk(cx, cz + 1);
}

// 程序化地形生成
// 高度 h = SEA + noise2D(wx*SCALE, wz*SCALE) * AMP
// 规则：h层=草地/沙（近水）, h-1到h-3层=泥土, 更深=石头, h+1到SEA=水
function genTerrain(cx, cz) {
  var data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D);
  var lx, lz, wx, wz, h, y, id;
  for (lx = 0; lx < CHUNK_W; lx++) {
    for (lz = 0; lz < CHUNK_D; lz++) {
      wx = cx * CHUNK_W + lx;
      wz = cz * CHUNK_D + lz;
      h  = Math.floor(SEA + noise2D(wx * SCALE, wz * SCALE) * AMP);
      // 实心柱从 y=0 到 y=h
      for (y = 0; y <= h && y < CHUNK_H; y++) {
        id = (y === h)    ? ((h <= SEA + 1) ? SAND : GRASS)
           : (y >= h - 3) ? DIRT
           :                STONE;
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
      }
      // 水面以下至海平面填水
      for (y = h + 1; y <= SEA; y++) {
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = WATER;
      }
    }
  }
  return data;
}
