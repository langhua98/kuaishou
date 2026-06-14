// ─── save.js ──────────────────────────────────────────────────────────────────
// 本地存档：玩家方块改动 + 位置/朝向/物品栏 + 防御塔，存 localStorage。
//
// 只持久化"玩家改动"——地形、开源建筑、城堡都是确定性生成（每次启动重放），
// 无需入档；recordEdit 仅由 game.js 的破坏/放置路径调用。
// 读档在启动序列末尾（建筑放置后）执行，确保玩家改动覆盖默认建筑。

var SAVE_KEY = 'kuaishou_save_v1';
var _edits = {};            // "wx,wy,wz" -> blockId（玩家改动相对生成地形的差异）
var _autoSaveTimer = null;

// 记录一次玩家改动（破坏=AIR / 放置=方块 ID）
function recordEdit(wx, wy, wz, id) {
  _edits[wx + ',' + wy + ',' + wz] = id;
}

// 写存档（静默，失败返回 false——隐私模式/容量满时不抛错打断游戏）
function saveGame() {
  try {
    var towers = [];
    if (typeof _towers !== 'undefined') {
      for (var i = 0; i < _towers.length; i++) {
        if (!_towers[i].dead) towers.push([
          Math.round(_towers[i].x * 100) / 100,
          Math.round(_towers[i].z * 100) / 100,
        ]);
      }
    }
    var furniture = (typeof serializeFurniture === 'function') ? serializeFurniture() : [];
    var crops = (typeof serializeCrops === 'function') ? serializeCrops() : [];
    var data = {
      v: 2,
      p: { x: player.x, y: player.y, z: player.z,
           yaw: player.yaw, pitch: player.pitch, slot: player.slot },
      e: _edits,
      t: towers,
      f: furniture,
      c: crops,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

// 直接把一条改动写进区块数据（区块缺失则先生成），返回受影响区块键
function _applyEditToData(wx, wy, wz, id, dirty) {
  if (wy < 0 || wy >= CHUNK_H) return;
  var cx = Math.floor(wx / CHUNK_W), cz = Math.floor(wz / CHUNK_D);
  var k = ckey(cx, cz);
  if (!chunks[k]) chunks[k] = { data: genTerrain(cx, cz), mesh: null };
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W;
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D;
  chunks[k].data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id;
  dirty[k] = [cx, cz];
  if (lx === 0)         dirty[ckey(cx-1,cz)] = [cx-1,cz];
  if (lx === CHUNK_W-1) dirty[ckey(cx+1,cz)] = [cx+1,cz];
  if (lz === 0)         dirty[ckey(cx,cz-1)] = [cx,cz-1];
  if (lz === CHUNK_D-1) dirty[ckey(cx,cz+1)] = [cx,cz+1];
}

// 读存档并应用（启动末尾调用）。无存档则静默返回。
function loadGame() {
  var raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return; }
  if (!raw) return;
  var data;
  try { data = JSON.parse(raw); } catch (e) { return; }
  if (!data || data.v < 1) return;

  // 1) 重放方块改动 → 直接写数据，最后统一重建受影响区块
  var dirty = {}, key, parts, wx, wy, wz, id, terr = [];
  _edits = data.e || {};
  for (key in _edits) {
    if (!_edits.hasOwnProperty(key)) continue;
    parts = key.split(',');
    wx = +parts[0]; wy = +parts[1]; wz = +parts[2]; id = _edits[key];
    _applyEditToData(wx, wy, wz, id, dirty);
    // 结界：玩家放的领地石恢复结界；破坏(AIR)处移除可能存在的结界（覆盖城堡默认）
    if (typeof TERRITORY_STONE !== 'undefined') {
      if (id === TERRITORY_STONE) terr.push([wx, wy, wz, 1]);
      else if (id === AIR)        terr.push([wx, wy, wz, 0]);
    }
  }
  var k, cd;
  for (k in dirty) { cd = dirty[k]; if (chunks[ckey(cd[0], cd[1])]) rebuildChunk(cd[0], cd[1]); }

  // 2) 结界同步（在区块重建后，避免 _addTerritory 依赖的视觉无副作用问题）
  var ti;
  for (ti = 0; ti < terr.length; ti++) {
    if (terr[ti][3] === 1) { if (typeof _addTerritory === 'function') _addTerritory(terr[ti][0], terr[ti][1], terr[ti][2]); }
    else                   { if (typeof _removeTerritory === 'function') _removeTerritory(terr[ti][0], terr[ti][1], terr[ti][2]); }
  }

  // 3) 恢复玩家位置/朝向/物品栏
  if (data.p) {
    player.x = data.p.x; player.y = data.p.y; player.z = data.p.z;
    player.yaw = data.p.yaw; player.pitch = data.p.pitch;
    if (typeof data.p.slot === 'number') player.slot = data.p.slot;
    // 预生成落点周围区块数据：物理 resolveAABB 在 updateChunks 之前跑，
    // 缺数据会被判为 AIR 导致首帧坠落——这里先把 3×3 区块数据建好。
    var pcx = Math.floor(player.x / CHUNK_W), pcz = Math.floor(player.z / CHUNK_D), gx, gz;
    for (gx = -1; gx <= 1; gx++) {
      for (gz = -1; gz <= 1; gz++) {
        if (typeof createChunk === 'function') createChunk(pcx + gx, pcz + gz);
      }
    }
  }

  // 4) 恢复防御塔
  if (data.t && typeof placeTower === 'function') {
    for (ti = 0; ti < data.t.length; ti++) placeTower(data.t[ti][0], data.t[ti][1], true);
  }

  // 5) 恢复家具（需先加载模型，异步回调内执行）
  if (data.f && data.f.length && typeof loadFurnitureModels === 'function') {
    var _savedFurniture = data.f;
    loadFurnitureModels(function () { deserializeFurniture(_savedFurniture); });
  }

  // 6) 恢复农作物（GLB 按需加载，deserializeCrops 内部异步）
  if (data.c && data.c.length && typeof deserializeCrops === 'function') {
    deserializeCrops(data.c);
  }

  if (typeof battleToast === 'function') battleToast('💾 存档已读取');
}

// 自动存档：每 20s + 页面隐藏/关闭时（移动端切后台即触发）
function initAutoSave() {
  if (_autoSaveTimer) return;
  _autoSaveTimer = setInterval(saveGame, 20000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveGame();
  });
  window.addEventListener('beforeunload', saveGame);
  window.addEventListener('pagehide', saveGame);
}
