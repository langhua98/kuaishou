// ─── ui.js ────────────────────────────────────────────────────────────────────
// 游戏 UI：热键栏渲染、槽位选择、仓库面板。
// 每个槽位用 canvas 绘制等轴测微型方块图标（三面：顶/左/右），逼真展示方块外观。

var HOTBAR_N = 8;
var _bagEl = null;

// 在 34×34 canvas 上绘制等轴测方块图标
function _drawBlockIcon(cv, id) {
  var ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 34, 34);
  var cs = BCOL[id];
  if (!cs) return;

  var s = 11, cx = 17, cy = 7;
  // 三面颜色
  var tR = Math.round(cs[0]*255), tG = Math.round(cs[1]*255), tB = Math.round(cs[2]*255);
  var sR = Math.round(cs[6]*255), sG = Math.round(cs[7]*255), sB = Math.round(cs[8]*255);

  // 右面（最暗）
  ctx.beginPath();
  ctx.moveTo(cx,   cy+s);
  ctx.lineTo(cx+s, cy+s*0.5);
  ctx.lineTo(cx+s, cy+s*1.5);
  ctx.lineTo(cx,   cy+s*2);
  ctx.closePath();
  ctx.fillStyle = 'rgb('+Math.round(sR*0.52)+','+Math.round(sG*0.52)+','+Math.round(sB*0.52)+')';
  ctx.fill();

  // 左面（中等亮度）
  ctx.beginPath();
  ctx.moveTo(cx-s, cy+s*0.5);
  ctx.lineTo(cx,   cy+s);
  ctx.lineTo(cx,   cy+s*2);
  ctx.lineTo(cx-s, cy+s*1.5);
  ctx.closePath();
  ctx.fillStyle = 'rgb('+Math.round(sR*0.72)+','+Math.round(sG*0.72)+','+Math.round(sB*0.72)+')';
  ctx.fill();

  // 顶面（最亮）
  ctx.beginPath();
  ctx.moveTo(cx,   cy);
  ctx.lineTo(cx+s, cy+s*0.5);
  ctx.lineTo(cx,   cy+s);
  ctx.lineTo(cx-s, cy+s*0.5);
  ctx.closePath();
  ctx.fillStyle = 'rgb('+tR+','+tG+','+tB+')';
  ctx.fill();

  // 棱线描边
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx-s, cy+s*0.5); ctx.lineTo(cx, cy);
  ctx.lineTo(cx+s, cy+s*0.5); ctx.lineTo(cx, cy+s); ctx.lineTo(cx-s, cy+s*0.5);
  ctx.moveTo(cx, cy+s);  ctx.lineTo(cx, cy+s*2);
  ctx.moveTo(cx, cy+s);  ctx.lineTo(cx+s, cy+s*0.5);
  ctx.moveTo(cx, cy+s*2); ctx.lineTo(cx+s, cy+s*1.5);
  ctx.moveTo(cx, cy+s*2); ctx.lineTo(cx-s, cy+s*1.5);
  ctx.stroke();
}

function _makeSlotIcon(id) {
  var cv = document.createElement('canvas');
  cv.width = 34; cv.height = 34;
  // 必须用 inline style 强制尺寸，canvas 默认 300×150 会撑坏布局
  cv.style.cssText = 'display:block;width:34px;height:34px;border-radius:4px;flex-shrink:0';
  _drawBlockIcon(cv, id);
  return cv;
}

function buildHotbar() {
  var hbar = document.getElementById('hotbar');
  if (!hbar) return;
  hbar.innerHTML = '';

  var i, id, slot;
  var n = Math.min(HOTBAR_N, player.inv.length);
  for (i = 0; i < n; i++) {
    id   = player.inv[i];
    slot = document.createElement('div');
    slot.className = 'slot' + (i === player.slot ? ' on' : '');
    slot.id = 'slot-' + i;
    slot.appendChild(_makeSlotIcon(id));
    var lbl = document.createElement('div');
    lbl.className = 'slot-lbl';
    lbl.textContent = BNAMES[id];
    slot.appendChild(lbl);

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
  var bagIc = document.createElement('div');
  bagIc.className = 'slot-ic';
  bagIc.style.cssText = 'background:transparent;font-size:26px;line-height:34px;text-align:center';
  bagIc.textContent = '📦';
  var bagLbl = document.createElement('div');
  bagLbl.className = 'slot-lbl';
  bagLbl.textContent = '仓库';
  bagBtn.appendChild(bagIc);
  bagBtn.appendChild(bagLbl);
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
      var id = player.inv[idx];
      var el = document.createElement('div');
      el.className = 'slot';
      el.appendChild(_makeSlotIcon(id));
      var lbl = document.createElement('div');
      lbl.className = 'slot-lbl';
      lbl.textContent = BNAMES[id];
      el.appendChild(lbl);
      function pick(e) {
        if (e && e.preventDefault) e.preventDefault();
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
