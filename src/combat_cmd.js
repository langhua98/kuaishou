// ─── combat_cmd.js ────────────────────────────────────────────────────────────
// 指挥层：招兵面板（按兵种点击刷兵，无需开战）+ 四命令按钮（跟随/冲锋/驻守/撤退）。
//
// 招兵：点 ➕ 展开兵种面板 → 点兵种按钮刷 1 个该兵种。
//   我方刷在玩家身边 2~4m；敌方刷在玩家面前 9~14m。
//   首次点击触发模型加载（按钮显示进度），加载完自动补刷刚才点的兵种。
// 胜负：敌人从有到无 → 我方欢呼几秒。

var _cmdWrap = null, _recruitBtn = null, _recruitPanel = null;
var _pendingSpawn = null;     // 模型加载期间点的兵种（加载完自动刷出）
var _hadEnemies = false;
var ALLY_CAP = 12;            // 我方上限（与 BTL.maxEnemies 共同构成性能预算）

// 招兵面板兵种（顺序即按钮顺序；skel_ 前缀 = 敌方）
var _RECRUIT = [
  ['🛡️', 'knight'],
  ['🪓', 'barbarian'],
  ['🏹', 'ranger'],
  ['🐎', 'cavalry'],
  ['💀', 'skel_war'],
  ['☠️', 'skel_min'],
  ['🎯', 'skel_rog'],
];

function buildBattleUI() {
  var ui = document.getElementById('ui');
  if (!ui || _cmdWrap) return;

  _cmdWrap = document.createElement('div');
  _cmdWrap.style.cssText = 'position:absolute;left:12px;top:60px;display:flex;' +
    'flex-direction:column;gap:8px;z-index:110';
  ui.appendChild(_cmdWrap);

  _recruitBtn = _mkBtn('➕', '招兵', function () {
    _recruitPanel.style.display = _recruitPanel.style.display === 'none' ? 'flex' : 'none';
  });
  _cmdWrap.appendChild(_recruitBtn);

  var orders = [
    ['🏃', '跟随', 'follow'],
    ['🗡️', '冲锋', 'charge'],
    ['🛡️', '驻守', 'hold'],
    ['🚩', '撤退', 'retreat'],
  ];
  var i;
  for (i = 0; i < orders.length; i++) {
    (function (o) {
      var b = _mkBtn(o[0], o[1], function () {
        playerOrder = o[2];
        _hiliteOrder();
        battleToast('命令：' + o[1]);
      });
      b.id = 'cmd-' + o[2];
      _cmdWrap.appendChild(b);
    }(orders[i]));
  }
  _hiliteOrder();

  // 兵种面板（招兵按钮右侧展开）
  _recruitPanel = document.createElement('div');
  _recruitPanel.style.cssText = 'position:absolute;left:80px;top:60px;display:none;' +
    'flex-direction:column;gap:6px;z-index:110';
  ui.appendChild(_recruitPanel);
  for (i = 0; i < _RECRUIT.length; i++) {
    (function (r) {
      var enemy = r[1].indexOf('skel_') === 0;
      var b = _mkBtn(r[0], UNIT_TYPES[r[1]].name, function () { spawnKind(r[1]); });
      b.id = 'rec-' + r[1];
      if (enemy) b.style.borderColor = 'rgba(239,68,68,.6)';
      _recruitPanel.appendChild(b);
    }(_RECRUIT[i]));
  }
}

function _mkBtn(ic, label, onTap) {
  var b = document.createElement('button');
  b.className = 'btn';
  b.style.cssText = 'width:58px;height:58px;font-size:10px';
  b.innerHTML = '<span class="ic" style="font-size:22px">' + ic + '</span><span>' + label + '</span>';
  b.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
  b.addEventListener('click', function () { onTap(); });
  return b;
}

function _hiliteOrder() {
  var ids = ['follow', 'charge', 'hold', 'retreat'], i, el;
  for (i = 0; i < ids.length; i++) {
    el = document.getElementById('cmd-' + ids[i]);
    if (el) el.style.borderColor = playerOrder === ids[i] ? 'rgba(250,204,21,.9)' : 'rgba(255,255,255,.3)';
  }
}

// ── 刷兵 ──────────────────────────────────────────────────────────────────────
function spawnKind(kind) {
  if (!_armyLoaded) {
    _pendingSpawn = kind;
    if (_recruitBtn.disabled) return;       // 已在加载，更新待刷兵种即可
    _recruitBtn.disabled = true;
    loadArmyModels(function () {
      _recruitBtn.disabled = false;
      _recruitBtn.lastChild.textContent = '招兵';
      if (_pendingSpawn) { var k = _pendingSpawn; _pendingSpawn = null; spawnKind(k); }
    }, function (done, total) {
      _recruitBtn.lastChild.textContent = done + '/' + total;
    });
    return;
  }

  var t = UNIT_TYPES[kind];
  var side = kind.indexOf('skel_') === 0 ? 1 : 0;
  if (side === 0 && countAlive(0) >= ALLY_CAP)       { battleToast('我方已满编（' + ALLY_CAP + '）'); return; }
  if (side === 1 && countAlive(1) >= BTL.maxEnemies) { battleToast('敌人已达上限（' + BTL.maxEnemies + '）'); return; }

  if (!_respawn) _respawn = [player.x, player.y, player.z];
  updatePlayerHud();

  var a, r, x, z;
  if (side === 0) {
    a = Math.random() * Math.PI * 2;
    r = 2.5 + Math.random() * 1.5;
    x = player.x + Math.sin(a) * r;
    z = player.z + Math.cos(a) * r;
  } else {
    // 玩家面前扇区（前向 = -sin(yaw), -cos(yaw)，与 raycast.js 一致）
    a = player.yaw + (Math.random() - 0.5) * 0.9;
    r = 9 + Math.random() * 5;
    x = player.x - Math.sin(a) * r;
    z = player.z - Math.cos(a) * r;
  }
  var u = spawnUnit(kind, side, x, z);
  if (u) battleToast((side === 0 ? '我方 ' : '敌方 ') + t.name + ' 入场');
}

// 每帧胜负检查（combat_ai.js 的 combatUpdate 调用）：敌人从有到无 → 欢呼
function battleProgress() {
  var en = countAlive(1);
  if (en > 0) { _hadEnemies = true; return; }
  if (!_hadEnemies) return;
  _hadEnemies = false;
  var i, u;
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    if (u.side === 0 && u.state !== 'DEAD') {
      u.cheering = true; u.cheerT = 3; u.target = null; u.state = 'IDLE';
    }
  }
  battleSfx('atk_clang');
  battleToast('🎉 敌人已肃清！');
}
