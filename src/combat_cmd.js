// ─── combat_cmd.js ────────────────────────────────────────────────────────────
// 指挥层：开战按钮 + 四命令按钮（跟随/冲锋/驻守/撤退）+ 波次与胜负流程。
//
// 开战流程：首次点击 → 加载军队模型（按钮显示进度）→ 生成我方小队 + 第 1 波敌军。
// 胜利：敌方全灭 → 我方欢呼 → 按钮变「下一波」。
// 我方全灭且玩家阵亡不结束战斗（敌人会向玩家复活点推进，可再点撤退重整）。

var _btlWave = 0;          // 当前波次（0=未开战）
var _btlActive = false;
var _cmdWrap = null, _btlBtn = null;

function buildBattleUI() {
  var ui = document.getElementById('ui');
  if (!ui || _cmdWrap) return;

  _cmdWrap = document.createElement('div');
  _cmdWrap.style.cssText = 'position:absolute;left:12px;top:60px;display:flex;' +
    'flex-direction:column;gap:8px;z-index:110';
  ui.appendChild(_cmdWrap);

  _btlBtn = _mkBtn('⚔️', '开战', function () { startWave(); });
  _cmdWrap.appendChild(_btlBtn);

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
      b.style.display = 'none';            // 开战后才显示
      _cmdWrap.appendChild(b);
    }(orders[i]));
  }
  _hiliteOrder();
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

function _showOrderBtns() {
  var ids = ['follow', 'charge', 'hold', 'retreat'], i, el;
  for (i = 0; i < ids.length; i++) {
    el = document.getElementById('cmd-' + ids[i]);
    if (el) el.style.display = 'flex';
  }
}

// ── 开战 / 下一波 ─────────────────────────────────────────────────────────────
function startWave() {
  if (_btlActive) return;
  if (!_armyLoaded) {
    _btlBtn.disabled = true;
    _btlBtn.lastChild.textContent = '加载…';
    loadArmyModels(function () {
      _btlBtn.disabled = false;
      startWave();
    }, function (done, total) {
      _btlBtn.lastChild.textContent = done + '/' + total;
    });
    return;
  }

  _btlWave++;
  _btlActive = true;
  _respawn = [player.x, player.y, player.z];
  updatePlayerHud();

  // 我方小队（首战生成；后续波次补满阵亡空缺）
  var have = countAlive(0), i, a, r;
  if (have < SQUAD.length) {
    for (i = have; i < SQUAD.length; i++) {
      a = (i / SQUAD.length) * Math.PI * 2;
      spawnUnit(SQUAD[i], 0, player.x + Math.sin(a) * 4, player.z + Math.cos(a) * 4);
    }
  }
  // 我方解除欢呼
  for (i = 0; i < combatUnits.length; i++) combatUnits[i].cheering = false;

  // 敌军：玩家前方扇区 30~38m 散布
  var comp = waveComp(_btlWave);
  var baseA = player.yaw + (Math.random() - 0.5);
  for (i = 0; i < comp.length; i++) {
    a = baseA + (Math.random() - 0.5) * 1.2;
    r = 30 + Math.random() * 8;
    spawnUnit(comp[i], 1, player.x + Math.sin(a) * r, player.z + Math.cos(a) * r);
  }

  battleSfx('atk_draw');
  battleToast('第 ' + _btlWave + ' 波：骷髅军 ' + comp.length + ' 人来袭！');
  _btlBtn.style.display = 'none';
  _showOrderBtns();
}

// 每帧胜负检查（combat_ai.js 的 combatUpdate 末尾调用）
function battleProgress() {
  if (!_btlActive) return;
  if (countAlive(1) === 0) {
    _btlActive = false;
    var i, u;
    for (i = 0; i < combatUnits.length; i++) {
      u = combatUnits[i];
      if (u.side === 0 && u.state !== 'DEAD') { u.cheering = true; u.cheerT = 4; u.target = null; u.state = 'IDLE'; }
    }
    battleSfx('atk_clang');
    battleToast('🎉 第 ' + _btlWave + ' 波击退！');
    _btlBtn.style.display = 'flex';
    _btlBtn.lastChild.textContent = '下一波';
  }
}
