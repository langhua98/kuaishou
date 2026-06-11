// ─── mesh.js ──────────────────────────────────────────────────────────────────
// 区块网格构建：方块数据 → Three.js BufferGeometry（带贴图 UV）。
//
// 材质策略：MeshBasicMaterial + vertexColors + map（贴图集）
//   顶点色为灰度亮度值（= FSHADE[面方向]），贴图为 atlasTexture（textures.js 生成）。
//   最终颜色 = 顶点灰度 × 贴图像素颜色，等同于"带方向明暗的有贴图方块"。
//
// UV 坐标规则（两种，按面朝向区分）：
//   侧面（±X/±Z）：底部顶点→ v_low，顶部顶点→ v_high，保证草地绿条在顶、木纹垂直
//   顶/底面（±Y）：标准矩形映射

var _mat = new THREE.MeshBasicMaterial({
  vertexColors: true,  // 灰度亮度遮罩
  map: atlasTexture    // 来自 textures.js
});

function buildMesh(cx, cz, data) {
  var pos = [], col = [], uv = [];
  var lx, y, lz, id, wx, wz, f, fd, nb, sh, ti, tc, tr, u0, u1, v0, v1, cn;

  for (lx = 0; lx < CHUNK_W; lx++) {
    for (y = 0; y < CHUNK_H; y++) {
      for (lz = 0; lz < CHUNK_D; lz++) {
        id = data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H];
        if (id === AIR) continue;

        wx = cx * CHUNK_W + lx;
        wz = cz * CHUNK_D + lz;

        for (f = 0; f < 6; f++) {
          fd = FACES[f];
          nb = getBlock(wx + fd[0], y + fd[1], wz + fd[2]);
          if (nb !== AIR && nb !== WATER) continue;
          if (id === WATER && f !== 2) continue;

          sh = FSHADE[f];  // 顶点灰度亮度

          // BTEX[id][0=顶, 1=侧, 2=底]，fd[4]: 0=顶面, 3=底面, 6=侧面
          ti = BTEX[id][fd[4] === 0 ? 0 : (fd[4] === 3 ? 2 : 1)];
          tc = ti % ATLAS_COLS;
          tr = (ti / ATLAS_COLS) | 0;
          u0 = tc / ATLAS_COLS;
          u1 = (tc + 1) / ATLAS_COLS;
          // Three.js UV v=0 在图片底部，v=1 在顶部（与 canvas y 轴相反）
          v1 = 1 - tr / ATLAS_ROWS;        // 贴图格顶边（小 canvas y）
          v0 = 1 - (tr + 1) / ATLAS_ROWS;  // 贴图格底边

          cn = fd[3];
          pos.push(
            wx+cn[0], y+cn[1],  wz+cn[2],
            wx+cn[3], y+cn[4],  wz+cn[5],
            wx+cn[6], y+cn[7],  wz+cn[8],
            wx+cn[0], y+cn[1],  wz+cn[2],
            wx+cn[6], y+cn[7],  wz+cn[8],
            wx+cn[9], y+cn[10], wz+cn[11]
          );
          col.push(sh,sh,sh, sh,sh,sh, sh,sh,sh, sh,sh,sh, sh,sh,sh, sh,sh,sh);

          // 侧面（fd[1]===0 即 ±X/±Z）：
          //   四个角点中 v0,v3 在 y=0（底），v1,v2 在 y=1（顶）
          //   → v_low 给底，v_high 给顶，确保草皮绿条显示在顶部
          // 顶/底面（fd[1]≠0）：标准矩形 UV
          if (fd[1] === 0) {
            uv.push(u0,v0, u0,v1, u1,v1,  u0,v0, u1,v1, u1,v0);
          } else {
            uv.push(u0,v1, u1,v1, u1,v0,  u0,v1, u1,v0, u0,v0);
          }
        }
      }
    }
  }

  if (pos.length === 0) return null;

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2));
  return new THREE.Mesh(geo, _mat);
}

function rebuildChunk(cx, cz) {
  var ch = gchunk(cx, cz);
  if (!ch) return;
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null; }
  ch.mesh = buildMesh(cx, cz, ch.data);
  if (ch.mesh) scene.add(ch.mesh);
}

function createChunk(cx, cz) {
  var k = ckey(cx, cz);
  if (chunks[k]) return;
  chunks[k] = { data: genTerrain(cx, cz), mesh: null };
}

function removeChunk(cx, cz) {
  var k = ckey(cx, cz);
  var ch = chunks[k];
  if (!ch) return;
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
  delete chunks[k];
}
