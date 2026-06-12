// ─── world.js ─────────────────────────────────────────────────────────────────
// 世界数据层：区块存储、方块读写、地形生成。
//
// 坐标约定：
//   世界坐标 (wx, wy, wz)：整数，绝对方块位置
//   区块坐标 (cx, cz)：整数，cx = floor(wx / CHUNK_W)
//   局部坐标 (lx, lz)：区块内偏移，[0, CHUNK_W)
//
// 区块数据布局：Uint8Array，索引 = lx + wy*CHUNK_W + lz*CHUNK_W*CHUNK_H
//
// 出生平地：原点附近 32 格内保持平坦（SEA+2），平滑混合到 64 格处恢复正常丘陵。
// 区块按需生成（走到哪生成到哪），不在此处预加载。

var chunks = {};  // 已加载区块，键 = "cx,cz"

function ckey(cx, cz) { return cx + ',' + cz; }
function gchunk(cx, cz) { return chunks[ckey(cx, cz)]; }

// 读取世界坐标方块 ID（区块未加载时返回 AIR，不触发加载）
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

// 写入方块并重建受影响的区块网格（含跨边界的相邻区块）
function setBlock(wx, wy, wz, id) {
  if (wy < 0 || wy >= CHUNK_H) return;
  var cx = Math.floor(wx / CHUNK_W);
  var cz = Math.floor(wz / CHUNK_D);
  var ch = gchunk(cx, cz);
  if (!ch) return;
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
  ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
  rebuildChunk(cx, cz);
  if (lx === 0)          rebuildChunk(cx - 1, cz);
  if (lx === CHUNK_W-1)  rebuildChunk(cx + 1, cz);
  if (lz === 0)          rebuildChunk(cx, cz - 1);
  if (lz === CHUNK_D-1)  rebuildChunk(cx, cz + 1);
}

// 地形生成
// 出生区（|wx|<=32 且 |wz|<=32）强制平坦高度 SEA+2，
// 32~64 格平滑混合至正常 Perlin 丘陵，64 格外完全正常。
var _FLAT_H   = SEA + 2;  // 平坦区地表高度
var _FLAT_IN  = 32;       // 纯平坦半径（格）
var _FLAT_OUT = 64;       // 混合结束半径（格）

function genTerrain(cx, cz) {
  var data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D);
  var lx, lz, wx, wz, h, y, id, worldR, blend, noiseH;
  for (lx = 0; lx < CHUNK_W; lx++) {
    for (lz = 0; lz < CHUNK_D; lz++) {
      wx = cx * CHUNK_W + lx;
      wz = cz * CHUNK_D + lz;

      // 切比雪夫距离（方形平地，视觉上更自然）
      worldR = Math.max(Math.abs(wx), Math.abs(wz));
      blend  = Math.max(0, Math.min(1, (worldR - _FLAT_IN) / (_FLAT_OUT - _FLAT_IN)));
      noiseH = Math.floor(SEA + noise2D(wx * SCALE, wz * SCALE) * AMP);
      h      = Math.round(_FLAT_H * (1 - blend) + noiseH * blend);

      for (y = 0; y <= h && y < CHUNK_H; y++) {
        id = (y === h)    ? ((h <= SEA + 1) ? SAND : GRASS)
           : (y >= h - 3) ? DIRT
           :                STONE;
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
      }
      for (y = h + 1; y <= SEA; y++) {
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = WATER;
      }
    }
  }
  return data;
}
