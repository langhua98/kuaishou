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

      // 石头路：城堡南门前 12 格宽，向南延伸 200 格
      var _road = (wx >= -3 && wx <= 8 && wz >= 14 && wz <= 200);
      if (_road) h = SEA + 2;

      // 高铁轨道床：沿 Z 轴，5 格宽，与道路平行
      var _rail = (wx >= 10 && wx <= 14 && wz >= 8 && wz <= 200);
      if (_rail) h = SEA + 2;

      // 公路/轨道两侧缓冲带（各 5 格），削平高出路面的地形
      var _shoulder = (wx >= -8 && wx <= 19 && wz >= 8 && wz <= 205);
      if (_shoulder && h > SEA + 2) h = SEA + 2;

      // 铃鹿赛道平坦区（z=205~3215，x=-900~900）
      var _circuit = (wz >= 205 && wz <= 3215 && wx >= -900 && wx <= 900);
      if (_circuit) h = SEA + 2;

      // 赛道围墙（外圈单格，比地面高 3 格；wx=8~16 处留缺口供轨道通过）
      var _cwall = (
        (wz >= 204 && wz <= 3216 && (wx === -902 || wx === 902)) ||
        (wx >= -902 && wx <= 902 && (wz === 204 || wz === 3216) && (wx < 8 || wx > 16))
      );
      if (_cwall) h = SEA + 5;

      for (y = 0; y <= h && y < CHUNK_H; y++) {
        id = (y === h)    ? ((_cwall || _road || _rail || _circuit) ? STONE : (h <= SEA + 1) ? SAND : GRASS)
           : (y >= h - 3) ? DIRT
           :                STONE;
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
      }
      for (y = h + 1; y <= SEA; y++) {
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = WATER;
      }
    }
  }

  // 树木生成（橡树/白桦/云杉；WorldR>40，草地，~3% 概率）
  // 内边距 3 确保半径 3 的树冠完全落在本区块内（不跨区块裁切）
  var tx, tz, twx, twz, twR, th, surfY, treeKind, trunkId, leafId, trunkH, topY, ty, tx2, tz2, rr, dxl, dzl;
  for (tx = 3; tx < CHUNK_W - 3; tx++) {
    for (tz = 3; tz < CHUNK_D - 3; tz++) {
      twx = cx * CHUNK_W + tx;
      twz = cz * CHUNK_D + tz;
      twR = Math.max(Math.abs(twx), Math.abs(twz));
      if (twR < 40) continue;
      if (twx >= -3 && twx <= 8 && twz >= 14 && twz <= 200) continue;  // 路区无树
      if (twx >= 9 && twx <= 15 && twz >= 8 && twz <= 200) continue;  // 轨道区无树
      if (twx >= -902 && twx <= 902 && twz >= 204 && twz <= 3217) continue; // 赛道区无树
      // 确定性伪随机（sin hash，每格唯一）
      th = Math.sin(twx * 127.1 + twz * 311.7) * 43758.5453;
      th = th - Math.floor(th);
      if (th > 0.03) continue;
      // 找草地表面
      surfY = -1;
      for (y = CHUNK_H - 1; y > SEA + 1; y--) {
        if (data[tx + y * CHUNK_W + tz * CHUNK_W * CHUNK_H] === GRASS) { surfY = y; break; }
      }
      if (surfY < 0) continue;
      // 树种：0=橡树 1=白桦 2=云杉
      treeKind = Math.floor(th * 300) % 3;
      trunkId  = (treeKind === 0) ? WOOD         : (treeKind === 1) ? BIRCH_LOG    : SPRUCE_LOG;
      leafId   = (treeKind === 0) ? LEAVES       : (treeKind === 1) ? BIRCH_LEAVES : SPRUCE_LEAVES;
      trunkH   = (treeKind === 0) ? 5 : (treeKind === 1) ? 6 : 7;
      // 树干
      for (ty = surfY + 1; ty <= surfY + trunkH && ty < CHUNK_H; ty++) {
        data[tx + ty * CHUNK_W + tz * CHUNK_W * CHUNK_H] = trunkId;
      }
      topY = surfY + trunkH;

      if (treeKind === 2) {
        // ── 云杉：圆锥形树冠（底宽顶尖，含尖顶）──
        var spruceLayers = [[topY - 3, 2], [topY - 2, 2], [topY - 1, 1], [topY, 1], [topY + 1, 0]];
        for (var sl = 0; sl < spruceLayers.length; sl++) {
          ty = spruceLayers[sl][0]; rr = spruceLayers[sl][1];
          if (ty < 0 || ty >= CHUNK_H) continue;
          for (tx2 = tx - rr; tx2 <= tx + rr; tx2++) {
            for (tz2 = tz - rr; tz2 <= tz + rr; tz2++) {
              dxl = Math.abs(tx2 - tx); dzl = Math.abs(tz2 - tz);
              if (rr === 2 && dxl === 2 && dzl === 2) continue;  // 削去最外四角
              if (data[tx2 + ty * CHUNK_W + tz2 * CHUNK_W * CHUNK_H] === AIR)
                data[tx2 + ty * CHUNK_W + tz2 * CHUNK_W * CHUNK_H] = leafId;
            }
          }
        }
      } else {
        // ── 橡树/白桦：圆球形树冠 ──
        //   下两层 5×5（去四角）、第三层 3×3、顶层十字
        for (ty = topY - 2; ty <= topY + 2 && ty < CHUNK_H; ty++) {
          if (ty < 0) continue;
          rr = (ty <= topY) ? 2 : (ty === topY + 1) ? 1 : 1;
          for (tx2 = tx - rr; tx2 <= tx + rr; tx2++) {
            for (tz2 = tz - rr; tz2 <= tz + rr; tz2++) {
              dxl = Math.abs(tx2 - tx); dzl = Math.abs(tz2 - tz);
              // 5×5 层削四角、顶层只留十字（防止方块感）
              if (rr === 2 && dxl === 2 && dzl === 2) continue;
              if (ty === topY + 2 && dxl + dzl > 1) continue;
              if (data[tx2 + ty * CHUNK_W + tz2 * CHUNK_W * CHUNK_H] === AIR)
                data[tx2 + ty * CHUNK_W + tz2 * CHUNK_W * CHUNK_H] = leafId;
            }
          }
        }
      }
    }
  }

  return data;
}
