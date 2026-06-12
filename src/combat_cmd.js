// ─── combat_cmd.js ────────────────────────────────────────────────────────────
// 指挥层：两个折叠面板（招兵 + 军令）+ 胜负判定。
//
// 左侧两个图标按钮：⚔️ 招兵、📋 军令，点击展开/收起对应面板。
// 招兵面板：7 个兵种按钮（我方4红色+敌方3蓝色），不设上限，点一下刷一个。
// 军令面板：跟随/冲锋/驻守/撤退，当前命令高亮。

var _cmdWrap = null;
var _recruitPanel = null, _orderPanel = null;
var _recruitOpen = false, _orderOpen = false;
var _hadEnemies = false;
var _castleCourtyard = null;  // 城堡广场中心，placeSimpleCastle 设定后生效

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

  // 两个折叠触发按钮（左侧纵列）
  _cmdWrap = document.createElement('div');
  _cmdWrap.style.cssText = 'position:absolute;left:8px;top:60px;display:flex;' +
    'flex-direction:column;gap:8px;z-index:112';
  ui.appendChild(_cmdWrap);

  var recToggle = _mkIconBtn('⚔️', '招兵', function () {
    _recruitOpen = !_recruitOpen;
    _recruitPanel.style.display = _recruitOpen ? 'flex' : 'none';
    if (_recruitOpen) { _orderOpen = false; _orderPanel.style.display = 'none'; }
  });
  var ordToggle = _mkIconBtn('📋', '军令', function () {
    _orderOpen = !_orderOpen;
    _orderPanel.style.display = _orderOpen ? 'flex' : 'none';
    if (_orderOpen) { _recruitOpen = false; _recruitPanel.style.display = 'none'; }
  });
  _cmdWrap.appendChild(recToggle);
  _cmdWrap.appendChild(ordToggle);

  // 招兵面板（触发按钮右侧弹出）
  _recruitPanel = document.createElement('div');
  _recruitPanel.style.cssText = 'position:absolute;left:74px;top:60px;display:none;' +
    'flex-direction:column;gap:6px;z-index:112;' +
    'background:rgba(0,0,0,.55);padding:6px 8px;border-radius:10px';
  ui.appendChild(_recruitPanel);
  var i;
  for (i = 0; i < _RECRUIT.length; i++) {
    (function (r) {
      var ally = r[1].indexOf('skel_') !== 0;
      var b = _mkSmallBtn(r[0], UNIT_TYPES[r[1]].name, function () {
        spawnKind(r[1]);
        // 点完自动关闭面板（快速操作后收起）
        _recruitOpen = false; _recruitPanel.style.display = 'none';
      });
      b.style.borderColor = ally ? 'rgba(74,222,128,.5)' : 'rgba(239,68,68,.5)';
      _recruitPanel.appendChild(b);
    }(_RECRUIT[i]));
  }

  // 军令面板（触发按钮右侧弹出，触发按钮在 recToggle 下方）
  _orderPanel = document.createElement('div');
  _orderPanel.style.cssText = 'position:absolute;left:74px;top:128px;display:none;' +
    'flex-direction:column;gap:6px;z-index:112;' +
    'background:rgba(0,0,0,.55);padding:6px 8px;border-radius:10px';
  ui.appendChild(_orderPanel);
  var orders = [
    ['🏃', '跟随', 'follow'],
    ['🗡️', '冲锋', 'charge'],
    ['🛡️', '驻守', 'hold'],
    ['🚩', '撤退', 'retreat'],
  ];
  for (i = 0; i < orders.length; i++) {
    (function (o) {
      var b = _mkSmallBtn(o[0], o[1], function () {
        playerOrder = o[2]; _hiliteOrder();
        battleToast('命令：' + o[1]);
        _orderOpen = false; _orderPanel.style.display = 'none';
      });
      b.id = 'cmd-' + o[2];
      _orderPanel.appendChild(b);
    }(orders[i]));
  }
  _hiliteOrder();
}

function _mkIconBtn(ic, label, onTap) {
  var b = document.createElement('button');
  b.className = 'btn';
  b.style.cssText = 'width:58px;height:58px;font-size:9px';
  b.innerHTML = '<span style="font-size:22px;display:block">' + ic + '</span>' + label;
  b.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
  b.addEventListener('click', function () { onTap(); });
  return b;
}

function _mkSmallBtn(ic, label, onTap) {
  var b = document.createElement('button');
  b.className = 'btn';
  b.style.cssText = 'width:54px;height:54px;font-size:9px;border-radius:8px;' +
    'background:rgba(0,0,0,.6);border:1.5px solid rgba(255,255,255,.25)';
  b.innerHTML = '<span style="font-size:20px;display:block">' + ic + '</span>' + label;
  b.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
  b.addEventListener('click', function () { onTap(); });
  return b;
}

function _hiliteOrder() {
  var ids = ['follow', 'charge', 'hold', 'retreat'], i, el;
  for (i = 0; i < ids.length; i++) {
    el = document.getElementById('cmd-' + ids[i]);
    if (el) el.style.borderColor = playerOrder === ids[i] ? 'rgba(250,204,21,.9)' : 'rgba(255,255,255,.25)';
  }
}

// ── 刷兵（无数量上限）──────────────────────────────────────────────────────────
function spawnKind(kind) {
  if (!_armyLoaded) {
    var tog = _cmdWrap ? _cmdWrap.firstChild : null;
    if (tog) { tog.disabled = true; tog.lastChild.textContent = '…'; }
    loadArmyModels(function () {
      if (tog) { tog.disabled = false; tog.lastChild.textContent = '招兵'; }
      spawnKind(kind);
    }, function (done, total) {
      if (tog) tog.lastChild.textContent = done + '/' + total;
    });
    return;
  }

  var t = UNIT_TYPES[kind];
  var side = kind.indexOf('skel_') === 0 ? 1 : 0;

  if (!_respawn) _respawn = [player.x, player.y, player.z];
  updatePlayerHud();

  var a, r, x, z;
  if (side === 0) {
    // 在领地内且有城堡广场 → 刷在广场附近
    if (_castleCourtyard && _inTerritory(player.x, player.z)) {
      a = Math.random() * Math.PI * 2;
      r = 1.5 + Math.random() * 3;
      x = _castleCourtyard.x + Math.sin(a) * r;
      z = _castleCourtyard.z + Math.cos(a) * r;
    } else {
      a = Math.random() * Math.PI * 2;
      r = 2.5 + Math.random() * 1.5;
      x = player.x + Math.sin(a) * r;
      z = player.z + Math.cos(a) * r;
    }
  } else {
    a = player.yaw + (Math.random() - 0.5) * 0.9;
    r = 9 + Math.random() * 5;
    x = player.x - Math.sin(a) * r;
    z = player.z - Math.cos(a) * r;
  }

  var u = spawnUnit(kind, side, x, z);
  if (u) battleToast((side === 0 ? '我方 ' : '敌方 ') + t.name + ' 入场');
}

// 每帧胜负检查（combat_ai.js combatUpdate 调用）
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
