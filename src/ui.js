// ─── ui.js ────────────────────────────────────────────────────────────────────
// 游戏 UI：热键栏渲染、槽位选择、仓库面板。
//
// 热键栏：只显示 player.inv 前 HOTBAR_N 个，末尾附 📦 仓库开关。
//   每个槽位显示方块颜色（用 BCOL 顶面色生成内联背景色）和中文名。
//   点击/触摸切换 player.slot，更新 .on 样式类。
// 仓库：inv 其余方块收进面板（热键栏上方展开）；
//   点仓库方块 = 与当前选中的热键槽互换，双向刷新并同步手持模型。

var HOTBAR_N = 8;
var _bagEl = null;

function buildHotbar() {
  var hbar = document.getElementById('hotbar');
  if (!hbar) return;
  hbar.innerHTML = '';

  var i, id, slot, cs, r, g, b;
  var n = Math.min(HOTBAR_N, player.inv.length);
  for (i = 0; i < n; i++) {
    id   = player.inv[i];
    cs   = BCOL[id];
    r    = Math.round(cs[0] * 255);
    g    = Math.round(cs[1] * 255);
    b    = Math.round(cs[2] * 255);

    slot = document.createElement('div');
    slot.className = 'slot' + (i === player.slot ? ' on' : '');
    slot.id = 'slot-' + i;
    slot.innerHTML =
      '<div class="slot-ic" style="background:rgb(' + r + ',' + g + ',' + b + ')"></div>' +
      '<div class="slot-lbl">' + BNAMES[id] + '</div>';

    // 闭包捕获 i 和 slot 元素，避免循环变量陷阱
    (function (idx, slotEl) {
      slotEl.addEventListener('touchstart', function (e) {
        e.preventDefault();
        var prev = document.getElementById('slot-' + player.slot);
        if (prev) prev.classList.remove('on');
        player.slot = idx;
        slotEl.classList.add('on');
      }, { passive: false });
    }(i, slot));

    hbar.appendChild(slot);
  }

  // 仓库开关
  var bagBtn = document.createElement('div');
  bagBtn.className = 'slot';
  bagBtn.innerHTML =
    '<div class="slot-ic" style="background:transparent;font-size:26px;line-height:34px;text-align:center">📦</div>' +
    '<div class="slot-lbl">仓库</div>';
  bagBtn.addEventListener('touchstart', function (e) { e.preventDefault(); toggleBag(); }, { passive: false });
  bagBtn.addEventListener('click', function () { toggleBag(); });
  hbar.appendChild(bagBtn);

  _ensureBag();
  _renderBag();
}

function _ensureBag() {
  if (_bagEl) return;
  var ui = document.getElementById('ui') || document.body;
  _bagEl = document.createElement('div');
  _bagEl.id = 'bag';
  _bagEl.style.cssText = 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);' +
    'display:none;gap:5px;padding:8px;background:rgba(0,0,0,.5);border-radius:10px;z-index:105';
  ui.appendChild(_bagEl);
}

function _renderBag() {
  if (!_bagEl) return;
  _bagEl.innerHTML = '';
  var i;
  for (i = HOTBAR_N; i < player.inv.length; i++) {
    (function (idx) {
      var id = player.inv[idx], cs = BCOL[id];
      var el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML =
        '<div class="slot-ic" style="background:rgb(' +
        Math.round(cs[0] * 255) + ',' + Math.round(cs[1] * 255) + ',' + Math.round(cs[2] * 255) +
        ')"></div><div class="slot-lbl">' + BNAMES[id] + '</div>';
      function pick(e) {
        if (e && e.preventDefault) e.preventDefault();
        // 与当前选中的热键槽互换，热键栏与仓库都重渲染
        var tmp = player.inv[player.slot];
        player.inv[player.slot] = player.inv[idx];
        player.inv[idx] = tmp;
        buildHotbar();
        if (typeof _updateHeldItem === 'function') _updateHeldItem(player.slot);
      }
      el.addEventListener('touchstart', pick, { passive: false });
      el.addEventListener('click', function () { pick(); });
      _bagEl.appendChild(el);
    }(i));
  }
}

function toggleBag() {
  if (!_bagEl) return;
  _bagEl.style.display = _bagEl.style.display === 'none' ? 'flex' : 'none';
}
