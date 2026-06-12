// ─── combat_cmd.js ────────────────────────────────────────────────────────────
// 指挥层：两个折叠面板（招兵 + 军令）+ 胜负判定。
//
// 左侧两个图标按钮：⚔️ 招兵、📋 军令，点击展开/收起对应面板。
// 招兵面板：8 个兵种按钮 + 1 个魔法塔，点一下招 6 个同类兵。
// 军令面板：8 条命令，当前命令高亮。

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
  ['🗼', 'tower'],   // 魔法塔（非战斗单位，调用 placeTower）
];

function buildBattleUI() {
  var ui = document.getElementById('ui');
  if (!ui || _cmdWrap) return;

  _cmdWrap = document.createElement('div');
  _cmdWrap.style.cssText = 'position:absolute;left:8px;top:60px;display:flex;' +
    'flex-direction:column;gap:6px;z-index:112';
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

  // 招兵面板（触发按钮右侧弹出，2列排布防止高度溢出）
  _recruitPanel = document.createElement('div');
  _recruitPanel.style.cssText = 'position:absolute;left:68px;top:60px;display:none;' +
    'flex-direction:row;flex-wrap:wrap;gap:4px;width:88px;z-index:112;' +
    'background:rgba(0,0,0,.6);padding:5px 6px;border-radius:10px';
  ui.appendChild(_recruitPanel);
  var i;
  for (i = 0; i < _RECRUIT.length; i++) {
    (function (r) {
      var isTower = r[1] === 'tower';
      var ally = r[1].indexOf('skel_') !== 0;
      var label = isTower ? '魔法塔' : UNIT_TYPES[r[1]].name;
      var b = _mkSmallBtn(r[0], label, function () {
        if (isTower) {
          spawnTower();
        } else {
          spawnKind(r[1], 6);
        }
        _recruitOpen = false; _recruitPanel.style.display = 'none';
      });
      b.style.borderColor = isTower ? 'rgba(168,85,247,.7)' :
        ally ? 'rgba(74,222,128,.5)' : 'rgba(239,68,68,.5)';
      _recruitPanel.appendChild(b);
    }(_RECRUIT[i]));
  }

  // 军令面板（2列，避免高度溢出）
  _orderPanel = document.createElement('div');
  _orderPanel.style.cssText = 'position:absolute;left:68px;top:116px;display:none;' +
    'flex-direction:row;flex-wrap:wrap;gap:4px;width:88px;z-index:112;' +
    'background:rgba(0,0,0,.6);padding:5px 6px;border-radius:10px';
  ui.appendChild(_orderPanel);
  var orders = [
    ['🏃', '跟随',   'follow'],
    ['🗡️', '冲锋',   'charge'],
    ['🛡️', '驻守',   'hold'],
    ['🚩', '撤退',   'retreat'],
    ['🎯', '集火',   'focus'],
    ['⭕', '包围',   'surround'],
    ['📣', '整队',   'rally'],
    ['🏹', '弓前',   'rangedFront'],
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
  b.style.cssText = 'width:52px;height:52px;font-size:8px';
  b.innerHTML = '<span style="font-size:20px;display:block">' + ic + '</span>' + label;
  b.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
  b.addEventListener('click', function () { onTap(); });
  return b;
}

function _mkSmallBtn(ic, label, onTap) {
  var b = document.createElement('button');
  b.className = 'btn';
  b.style.cssText = 'width:40px;height:40px;font-size:7px;border-radius:7px;' +
    'background:rgba(0,0,0,.65);border:1.5px solid rgba(255,255,255,.25)';
  b.innerHTML = '<span style="font-size:15px;display:block">' + ic + '</span>' + label;
  b.addEventListener('touchstart', function (e) { e.preventDefault(); onTap(); }, { passive: false });
  b.addEventListener('click', function () { onTap(); });
  return b;
}

function _hiliteOrder() {
  var ids = ['follow','charge','hold','retreat','focus','surround','rally','rangedFront'];
  var i, el;
  for (i = 0; i < ids.length; i++) {
    el = document.getElementById('cmd-' + ids[i]);
    if (el) el.style.borderColor = playerOrder === ids[i] ?
      'rgba(250,204,21,.9)' : 'rgba(255,255,255,.25)';
  }
}

// ── 招兵（每次召唤 count 个，默认 6）──────────────────────────────────────────
function spawnKind(kind, count) {
  count = count || 1;
  if (!_armyLoaded) {
    var tog = _cmdWrap ? _cmdWrap.firstChild : null;
    if (tog) { tog.disabled = true; tog.lastChild.textContent = '…'; }
    loadArmyModels(function () {
      if (tog) { tog.disabled = false; tog.lastChild.textContent = '招兵'; }
      spawnKind(kind, count);
    }, function (done, total) {
      if (tog) tog.lastChild.textContent = done + '/' + total;
    });
    return;
  }

  var t = UNIT_TYPES[kind];
  var side = kind.indexOf('skel_') === 0 ? 1 : 0;
  var spawned = 0, n, a, r, x, z, u;

  for (n = 0; n < count; n++) {
    if (side === 0) {
      if (_castleCourtyard && _inTerritory(player.x, player.z)) {
        a = Math.random() * Math.PI * 2;
        r = 1.5 + Math.random() * 4;
        x = _castleCourtyard.x + Math.sin(a) * r;
        z = _castleCourtyard.z + Math.cos(a) * r;
      } else {
        a = Math.random() * Math.PI * 2;
        r = 2 + Math.random() * 2.5;
        x = player.x + Math.sin(a) * r;
        z = player.z + Math.cos(a) * r;
      }
    } else {
      a = player.yaw + (Math.random() - 0.5) * 1.2;
      r = 9 + Math.random() * 6;
      x = player.x - Math.sin(a) * r;
      z = player.z - Math.cos(a) * r;
    }
    u = spawnUnit(kind, side, x, z);
    if (u) spawned++;
  }
  if (spawned > 0) battleToast((side === 0 ? '我方 ' : '敌方 ') +
    t.name + (spawned > 1 ? ' ×' + spawned : '') + ' 入场');
}

// ── 放置魔法塔（在玩家前方）──────────────────────────────────────────────────
function spawnTower() {
  var tx = player.x + Math.sin(player.yaw) * 4;
  var tz = player.z + Math.cos(player.yaw) * 4;
  if (typeof placeTower === 'function') {
    placeTower(tx, tz);
  } else {
    battleToast('⚠️ 塔防模块未就绪');
  }
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
