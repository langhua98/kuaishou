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

// ─── 存档码：跨设备同步（无后端）──────────────────────────────────────────
// 把整份存档编码成一段可复制文本；换设备时粘贴导入即可恢复进度。国内外通用。

// UTF-8 安全 base64（存档目前是纯 ASCII JSON，但保险起见处理多字节）
function _b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function _b64decode(b64) { return decodeURIComponent(escape(atob(b64))); }

// 生成存档码：先存一次确保最新，再读 localStorage 编码。无存档返回 ''。
function exportSaveCode() {
  if (typeof player !== 'undefined' && player) saveGame();
  var raw = '';
  try { raw = localStorage.getItem(SAVE_KEY) || ''; } catch (e) {}
  if (!raw) return '';
  try { return 'KS' + _b64encode(raw); } catch (e) { return ''; }
}

// 导入存档码：解码并校验是合法存档后写入 localStorage（需重载页面应用）。成功 true。
function importSaveCode(code) {
  if (!code) return false;
  code = ('' + code).replace(/\s+/g, '');
  if (code.slice(0, 2) === 'KS') code = code.slice(2);
  var raw;
  try { raw = _b64decode(code); } catch (e) { return false; }
  try {
    var d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || typeof d.v === 'undefined') return false;
  } catch (e) { return false; }
  try { localStorage.setItem(SAVE_KEY, raw); } catch (e) { return false; }
  return true;
}

// ─── 存档码弹窗 UI（按物品仓库的风格构建一次后复用）──────────────────────
var _scOverlay = null, _scText = null, _scMsg = null;

function _scSetMsg(text, ok) {
  if (!_scMsg) return;
  _scMsg.textContent = text || '';
  _scMsg.style.color = (ok === false) ? '#f88' : '#7fd';
}

function _ensureSaveCodeUI() {
  if (_scOverlay) return;
  _scOverlay = document.createElement('div');
  _scOverlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:300;display:none;' +
    'flex-direction:column;align-items:center;justify-content:center;touch-action:none;padding:16px';
  _scOverlay.addEventListener('touchmove', function (e) {
    if (_scText && e.target === _scText) return;
    e.preventDefault();
  }, { passive: false });

  var box = document.createElement('div');
  box.style.cssText =
    'width:100%;max-width:360px;background:#1a1f2b;border:1px solid rgba(255,255,255,.18);' +
    'border-radius:14px;padding:16px;box-sizing:border-box;font-family:monospace;color:#fff';

  var head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px';
  head.innerHTML = '<span style="font-size:16px;letter-spacing:1px">☁ 进度同步</span>';
  var close = document.createElement('button');
  close.textContent = '✕';
  close.style.cssText = 'background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);' +
    'color:#fff;border-radius:8px;padding:4px 12px;font-size:14px;cursor:pointer;font-family:monospace';
  close.addEventListener('click', closeSaveCodeDialog);
  head.appendChild(close);
  box.appendChild(head);

  var tip = document.createElement('div');
  tip.style.cssText = 'font-size:12px;color:#9fb0c6;line-height:1.6;margin-bottom:10px';
  tip.innerHTML = '点「导出」生成存档码并复制保存；' +
    '在新设备粘贴后点「导入」即可恢复进度。';
  box.appendChild(tip);

  _scText = document.createElement('textarea');
  _scText.style.cssText =
    'width:100%;height:120px;box-sizing:border-box;resize:none;border-radius:8px;' +
    'border:1px solid rgba(255,255,255,.2);background:#0d1017;color:#cfe;font-size:11px;' +
    'font-family:monospace;padding:8px;word-break:break-all';
  _scText.setAttribute('placeholder', '在此粘贴存档码后点「导入」');
  box.appendChild(_scText);

  _scMsg = document.createElement('div');
  _scMsg.style.cssText = 'font-size:12px;min-height:18px;margin:8px 0';
  box.appendChild(_scMsg);

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px';
  function mkBtn(label, bg, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'flex:1;padding:11px 0;border:none;border-radius:9px;font-size:14px;' +
      'font-family:monospace;font-weight:bold;cursor:pointer;color:#000;background:' + bg;
    b.addEventListener('click', fn);
    return b;
  }
  row.appendChild(mkBtn('📤 导出', 'linear-gradient(135deg,#38bdf8,#7dd3fc)', _scExport));
  row.appendChild(mkBtn('📥 导入', 'linear-gradient(135deg,#22c55e,#4ade80)', _scImport));
  box.appendChild(row);

  _scOverlay.appendChild(box);
  document.body.appendChild(_scOverlay);
}

// 导出：生成存档码填入文本框、自动全选并尝试复制
function _scExport() {
  var code = exportSaveCode();
  if (!code) { _scSetMsg('暂无存档（先玩一会儿再来导出）', false); return; }
  _scText.value = code;
  _scText.focus();
  _scText.select();
  var copied = false;
  try { copied = document.execCommand('copy'); } catch (e) {}
  if (!copied && navigator.clipboard) {
    navigator.clipboard.writeText(code).then(
      function () { _scSetMsg('已生成并复制到剪贴板 ✓'); },
      function () { _scSetMsg('已生成，请长按文本手动复制', false); }
    );
    return;
  }
  _scSetMsg(copied ? '已生成并复制到剪贴板 ✓'
                   : '已生成，请长按文本手动复制', copied);
}

// 导入：读文本框内容写入存档后重载页面
function _scImport() {
  var code = _scText.value;
  if (!code || !code.trim()) { _scSetMsg('请先粘贴存档码', false); return; }
  if (importSaveCode(code)) {
    _scSetMsg('导入成功，正在重载…');
    setTimeout(function () { location.reload(); }, 700);
  } else {
    _scSetMsg('存档码无效，请检查是否复制完整', false);
  }
}

function openSaveCodeDialog() {
  _ensureSaveCodeUI();
  _scText.value = '';
  _scSetMsg('');
  _scOverlay.style.display = 'flex';
}

function closeSaveCodeDialog() {
  if (_scOverlay) _scOverlay.style.display = 'none';
}
