// ─── gugong.js ────────────────────────────────────────────────────────────────
// 紫禁城（故宫）建筑生成器
// buildForbiddenCity() — 在世界原点北方约 70 格开始，向北生成写实故宫建筑群
//
// 坐标体系（Three.js，负 z = 向北 = 背离玩家）：
//   外城墙：南 WS=-52  北 WN=-212（160 深）  西 WW=-50  东 WE=+50（100 宽）
//   地面目标高度：BY = SEA+2 = 14
//
// z 布局（从南 WS=-52 到北 WN=-212，z 越小越北）：
//   -52          南外城墙（午门）
//   -63 ~ -52   午门主楼 + 翼楼（U 形五楼）
//   -76          内金水河弓形水渠（中心线）
//   -92 ~ -84   太和门
//   -106 ~ -98  三台踏步前广场
//   -162 ~ -98  三台（三层汉白玉台基）
//   -138 ~ -108 太和殿（最大正殿，11 开间）
//   -154 ~ -142 中和殿（方形亭式）
//   -172 ~ -158 保和殿（后殿）
//   -177         内外朝隔断墙
//   -188 ~ -182 乾清门
//   -200 ~ -190 乾清宫（内廷第一宫）  ← 北面 z=-200 紧邻神武门南面
//   -212 ~ -200 神武门（北大门楼，骑跨北外城墙）
//   -212         北外城墙（WN）
//
// 性能策略：直接写 ch.data 跳过 setBlock 逐次 rebuildChunk，最后批量重建。

function buildForbiddenCity() {
  var OX = 0;
  var BY = SEA + 2;   // = 14

  // ── 批量写入系统 ──────────────────────────────────────────────────────────
  var _dirty = {};

  function _ec(cx, cz) {
    var k = ckey(cx, cz);
    if (!chunks[k]) chunks[k] = { data: genTerrain(cx, cz), mesh: null };
  }

  function _raw(wx, wy, wz, id) {
    if (wy < 0 || wy >= CHUNK_H) return;
    var cx = Math.floor(wx / CHUNK_W);
    var cz = Math.floor(wz / CHUNK_D);
    _ec(cx, cz);
    var ch = chunks[ckey(cx, cz)];
    var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
    var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
    ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
    _dirty[ckey(cx, cz)] = [cx, cz];
    if (lx === 0)         { _ec(cx-1,cz); _dirty[ckey(cx-1,cz)] = [cx-1,cz]; }
    if (lx === CHUNK_W-1) { _ec(cx+1,cz); _dirty[ckey(cx+1,cz)] = [cx+1,cz]; }
    if (lz === 0)         { _ec(cx,cz-1); _dirty[ckey(cx,cz-1)] = [cx,cz-1]; }
    if (lz === CHUNK_D-1) { _ec(cx,cz+1); _dirty[ckey(cx,cz+1)] = [cx,cz+1]; }
  }

  function _fill(x1, y1, z1, x2, y2, z2, id) {
    var x, y, z;
    for (x = x1; x <= x2; x++)
      for (y = y1; y <= y2; y++)
        for (z = z1; z <= z2; z++)
          _raw(x, y, z, id);
  }

  // 空心四壁（无顶底），z1 < z2
  function _box(x1, y1, z1, x2, y2, z2, id) {
    var x, y, z;
    for (x = x1; x <= x2; x++)
      for (y = y1; y <= y2; y++)
        for (z = z1; z <= z2; z++)
          if (x === x1 || x === x2 || z === z1 || z === z2)
            _raw(x, y, z, id);
  }

  // 庑殿顶（hip roof），从 y0 逐层收缩，z1 < z2
  function _hip(x1, y0, z1, x2, z2, id) {
    var s, rx1, rx2, rz1, rz2;
    for (s = 0; ; s++) {
      rx1 = x1+s; rx2 = x2-s; rz1 = z1+s; rz2 = z2-s;
      if (rx1 > rx2 || rz1 > rz2) break;
      _fill(rx1, y0+s, rz1, rx2, y0+s, rz2, id);
    }
  }

  // 宫殿单体：台基 + 空心红墙 + 金瓦庑殿顶  (z1 < z2，z2=南面)
  function _hall(x1, z1, x2, z2, fy, wh) {
    _fill(x1, fy,      z1, x2, fy,      z2, WHITE_STONE);
    _box (x1, fy+1,    z1, x2, fy+wh,   z2, RED_WALL);
    _fill(x1, fy+wh+1, z1, x2, fy+wh+1, z2, GOLD_ROOF);
    _hip (x1, fy+wh+2, z1, x2, z2, GOLD_ROOF);
  }

  // 实心城楼塔楼 + 金瓦庑殿顶  (z1 < z2)
  function _tower(x1, z1, x2, z2, fy, h) {
    _fill(x1, fy,   z1, x2, fy+h,   z2, RED_WALL);
    _fill(x1, fy+h+1, z1, x2, fy+h+1, z2, GOLD_ROOF);
    _hip (x1, fy+h+2, z1, x2, z2, GOLD_ROOF);
  }

  // 在南面（z=zs）开门洞：高 dh 格，半宽 hw
  function _door(xc, hw, zs, fy, dh) {
    _fill(xc-hw, fy, zs-1, xc+hw, fy+dh, zs+1, AIR);
  }

  // ── 城墙边界（绝对坐标）──────────────────────────────────────────────────
  var WS = -52;   // 南墙 z
  var WN = -212;  // 北墙 z
  var WW = -50;   // 西墙 x
  var WE =  50;   // 东墙 x
  var WH =  9;    // 外墙高度
  var x, y, z, bx, k, cd, di, bi, t, wp, bt, bwp;

  // ── 1. 场地整平 ──────────────────────────────────────────────────────────
  for (x = WW-3; x <= WE+3; x++) {
    for (z = WN-3; z <= WS+3; z++) {
      for (y = 1; y < BY; y++)       _raw(x, y, z, STONE);
      for (y = BY; y < BY+55; y++)   _raw(x, y, z, AIR);
      _raw(x, BY, z, GRAY_BRICK);
    }
  }

  // ── 2. 外城墙四面 ─────────────────────────────────────────────────────────
  _fill(WW, BY, WS, WE, BY+WH, WS, RED_WALL);
  _fill(WW, BY, WN, WE, BY+WH, WN, RED_WALL);
  _fill(WW, BY, WN, WW, BY+WH, WS, RED_WALL);
  _fill(WE, BY, WN, WE, BY+WH, WS, RED_WALL);
  // 城垛金瓦压顶
  _fill(WW, BY+WH+1, WS, WE, BY+WH+1, WS, GOLD_ROOF);
  _fill(WW, BY+WH+1, WN, WE, BY+WH+1, WN, GOLD_ROOF);
  _fill(WW, BY+WH+1, WN, WW, BY+WH+1, WS, GOLD_ROOF);
  _fill(WE, BY+WH+1, WN, WE, BY+WH+1, WS, GOLD_ROOF);

  // ── 3. 四座角楼 ───────────────────────────────────────────────────────────
  var CTH = WH + 8;
  _tower(WW,     WS-7, WW+6, WS,     BY, CTH);  // 西南角楼
  _tower(WE-6,   WS-7, WE,   WS,     BY, CTH);  // 东南角楼
  _tower(WW,     WN,   WW+6, WN+7,   BY, CTH);  // 西北角楼
  _tower(WE-6,   WN,   WE,   WN+7,   BY, CTH);  // 东北角楼

  // ── 4. 午门（U 形五楼格局）──────────────────────────────────────────────
  // 主楼（正中最高，9 开间）
  _tower(OX-11, WS-11, OX+11, WS, BY, WH+15);
  // 东西翼楼（各 13 格宽，向南延伸 9 格形成两翼）
  _tower(WW+9,  WS-9, WW+22, WS, BY, WH+6);
  _tower(WE-22, WS-9, WE-9,  WS, BY, WH+6);
  // 廊墙（连接翼楼与角楼区段）
  _fill(WW+6,  BY, WS-1, WW+9,  BY+WH, WS, RED_WALL);
  _fill(WE-9,  BY, WS-1, WE-6,  BY+WH, WS, RED_WALL);
  // 午门三洞（中央 + 两侧）
  _fill(OX-3,  BY, WS-12, OX+3,  BY+4, WS+1, AIR);
  _fill(WW+9,  BY, WS-10, WW+16, BY+3, WS+1, AIR);
  _fill(WE-16, BY, WS-10, WE-9,  BY+3, WS+1, AIR);

  // ── 5. 内金水河（弓形渠道 + 五座汉白玉桥）──────────────────────────────
  var WCZ = -76;
  for (x = WW+6; x <= WE-6; x++) {
    var t  = (x - OX) / 42.0;
    var wp = Math.round(4 * Math.max(0, 1 - t*t));
    for (z = WCZ-3; z <= WCZ+1+wp; z++) {
      _raw(x, BY-2, z, AIR);
      _raw(x, BY-1, z, WATER);
      _raw(x, BY,   z, WATER);
    }
  }
  var bXs = [-32, -16, 0, 16, 32];
  for (bi = 0; bi < 5; bi++) {
    bx = bXs[bi];
    var bt = bx / 42.0, bwp = Math.round(4 * Math.max(0, 1 - bt*bt));
    _fill(bx-1, BY-1, WCZ-4, bx+1, BY, WCZ+2+bwp, WHITE_STONE);
  }

  // ── 6. 太和门（Gate of Supreme Harmony）──────────────────────────────────
  // z1=-92（北），z2=-84（南，面向广场）
  _hall(OX-20, -92, OX+20, -84, BY, 8);
  _door(OX, 4, -84, BY, 4);

  // ── 7. 三台（三层汉白玉台基）────────────────────────────────────────────
  _fill(OX-42, BY+1, -162, OX+42, BY+2,  -98, WHITE_STONE);  // 第一层
  _fill(OX-36, BY+3, -158, OX+36, BY+4, -102, WHITE_STONE);  // 第二层
  _fill(OX-30, BY+5, -154, OX+30, BY+6, -106, WHITE_STONE);  // 第三层
  // 正南三组踏步
  _fill(OX-6, BY+1, -97,  OX+6, BY+2,  -94, WHITE_STONE);
  _fill(OX-6, BY+3, -101, OX+6, BY+4,  -98, WHITE_STONE);
  _fill(OX-6, BY+5, -105, OX+6, BY+6, -102, WHITE_STONE);
  var TY = BY + 7;  // 台顶地板高度 = 21

  // ── 8. 太和殿（11 开间，最大正殿）──────────────────────────────────────
  // z1=-138（北），z2=-108（南）
  _hall(OX-26, -138, OX+26, -108, TY, 10);
  for (di = -2; di <= 2; di++) {
    _fill(OX+di*9-2, TY, -109, OX+di*9+2, TY+4, -107, AIR);
  }
  _fill(OX-27, TY+3, -128, OX-27, TY+6, -118, AIR);
  _fill(OX+27, TY+3, -128, OX+27, TY+6, -118, AIR);

  // ── 9. 中和殿（方形亭式，位于太和殿北侧）─────────────────────────────
  // z1=-154（北），z2=-142（南）
  _hall(OX-12, -154, OX+12, -142, TY, 8);
  _door(OX, 3, -142, TY, 3);

  // ──10. 保和殿（后殿，位于中和殿北侧）──────────────────────────────────
  // z1=-172（北），z2=-158（南）
  _hall(OX-24, -172, OX+24, -158, TY, 9);
  _door(OX, 3, -158, TY, 3);

  // ── 内外朝隔断墙（z=-177）─────────────────────────────────────────────
  _fill(WW+4, BY, -177, WE-4, BY+WH, -177, RED_WALL);
  _fill(OX-4, BY, -178, OX+4, BY+4,  -176, AIR);  // 中门洞

  // ──11. 乾清门（z1=-188，z2=-182）────────────────────────────────────
  _hall(OX-15, -188, OX+15, -182, BY, 7);
  _door(OX, 4, -182, BY, 4);

  // ──12. 乾清宫（z1=-200，z2=-190；北面 z=-200 紧贴神武门南面）─────────
  _hall(OX-19, -200, OX+19, -190, BY+1, 9);
  _door(OX, 4, -190, BY+1, 4);

  // ──13. 神武门（北大门楼）─────────────────────────────────────────────
  // 门楼骑跨北城墙（WN=-212），向内延伸到 z=-200（与乾清宫北墙紧邻）
  // 拱门贯穿：z=-213（墙外）→ z=-200（乾清宫北墙，一并凿通）
  _tower(OX-12, WN, OX+12, -200, BY, WH+12);
  _fill(OX-3, BY, WN-1, OX+3, BY+4, -199, AIR);

  // ──14. 批量重建所有受影响区块 ────────────────────────────────────────
  for (k in _dirty) {
    cd = _dirty[k];
    rebuildChunk(cd[0], cd[1]);
  }
}
