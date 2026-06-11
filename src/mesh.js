// ─── mesh.js ──────────────────────────────────────────────────────────────────
// 区块网格构建：将方块数据转换为 Three.js BufferGeometry。
//
// 核心策略：面剔除
//   仅生成邻居为 AIR 或 WATER 的外露面，内部面完全跳过。
//   水方块特殊处理：只生成顶面（水面效果），其余面不渲染。
//
// 着色策略：烘焙顶点色（MeshBasicMaterial）
//   不依赖场景灯光，每个面的颜色 = BCOL[方块][面方向] × FSHADE[面方向]
//   顶面 ×1.00，侧面 ×0.80–0.85，底面 ×0.50 → 产生 Minecraft 风格方向明暗。
//
// 每个可见面输出 6 个顶点（2 个三角形，非索引几何体），职责简单，便于后期扩展纹理。

// 所有区块共用同一个材质实例（节省 GPU 状态切换）
var _mat = new THREE.MeshBasicMaterial({ vertexColors: true });

// 将区块数据构建为 Three.js Mesh，若全为空气则返回 null
function buildMesh(cx, cz, data) {
  var pos = [], col = [];
  var lx, y, lz, id, wx, wz, f, fd, nb, ci, sh, cr, cg, cb, cn;

  for (lx = 0; lx < CHUNK_W; lx++) {
    for (y = 0; y < CHUNK_H; y++) {
      for (lz = 0; lz < CHUNK_D; lz++) {
        id = data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H];
        if (id === AIR) continue;

        wx = cx * CHUNK_W + lx;
        wz = cz * CHUNK_D + lz;

        for (f = 0; f < 6; f++) {
          fd = FACES[f];

          // 邻居可见性检查
          nb = getBlock(wx + fd[0], y + fd[1], wz + fd[2]);
          if (nb !== AIR && nb !== WATER) continue;  // 邻居实心 → 跳过
          if (id === WATER && f !== 2) continue;      // 水只显示顶面（f=2 是 +Y）

          // 颜色 = 方块基色 × 面亮度
          ci = fd[4]; sh = FSHADE[f];
          cr = BCOL[id][ci] * sh;
          cg = BCOL[id][ci + 1] * sh;
          cb = BCOL[id][ci + 2] * sh;

          // 4 个顶点偏移 → 2 个三角形（顺序：0,1,2 和 0,2,3）
          cn = fd[3];
          pos.push(
            wx+cn[0], y+cn[1],  wz+cn[2],
            wx+cn[3], y+cn[4],  wz+cn[5],
            wx+cn[6], y+cn[7],  wz+cn[8],
            wx+cn[0], y+cn[1],  wz+cn[2],
            wx+cn[6], y+cn[7],  wz+cn[8],
            wx+cn[9], y+cn[10], wz+cn[11]
          );
          col.push(
            cr,cg,cb, cr,cg,cb, cr,cg,cb,
            cr,cg,cb, cr,cg,cb, cr,cg,cb
          );
        }
      }
    }
  }

  if (pos.length === 0) return null;

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(geo, _mat);
}

// 重建区块网格：销毁旧网格 → 构建新网格 → 加入场景
function rebuildChunk(cx, cz) {
  var ch = gchunk(cx, cz);
  if (!ch) return;
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
  ch.mesh = buildMesh(cx, cz, ch.data);
  if (ch.mesh) scene.add(ch.mesh);
}

// 首次生成区块数据（不建网格，网格由 rebuildChunk 单独触发）
function createChunk(cx, cz) {
  var k = ckey(cx, cz);
  if (chunks[k]) return;
  chunks[k] = { data: genTerrain(cx, cz), mesh: null };
}

// 卸载区块：从场景移除网格，释放 GPU 几何体内存，删除数据
function removeChunk(cx, cz) {
  var k = ckey(cx, cz);
  var ch = chunks[k];
  if (!ch) return;
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
  delete chunks[k];
}
