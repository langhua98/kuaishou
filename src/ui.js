// ─── ui.js ────────────────────────────────────────────────────────────────────
// 游戏 UI：热键栏渲染、槽位选择、仓库面板。
// 每个槽位用 canvas 绘制等轴测微型方块图标（三面：顶/左/右），逼真展示方块外观。

var HOTBAR_N = 8;
var _bagEl = null;

// 在 68×68 离屏 canvas 上绘制等轴测方块图标（2× 超采样，显示时缩到 34）
function _drawBlockIcon(cv, id) {
  var ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 68, 68);
  var cs = BCOL[id];
  if (!cs) return;

  var s = 22, cx = 34, cy = 14;
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
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx-s, cy+s*0.5); ctx.lineTo(cx, cy);
  ctx.lineTo(cx+s, cy+s*0.5); ctx.lineTo(cx, cy+s); ctx.lineTo(cx-s, cy+s*0.5);
  ctx.moveTo(cx, cy+s);  ctx.lineTo(cx, cy+s*2);
  ctx.moveTo(cx, cy+s);  ctx.lineTo(cx+s, cy+s*0.5);
  ctx.moveTo(cx, cy+s*2); ctx.lineTo(cx+s, cy+s*1.5);
  ctx.moveTo(cx, cy+s*2); ctx.lineTo(cx-s, cy+s*1.5);
  ctx.stroke();
}

// 返回固定尺寸 <img>（而非 <canvas>）：img 的 width/height 属性是硬约束，
// 任何移动端浏览器都不会让它溢出撑坏热键栏（canvas 的 CSS 尺寸在部分 WebView 里失效）。
function _makeSlotIcon(id) {
  var cv = document.createElement('canvas');
  cv.width = 68; cv.height = 68;     // 2× 离屏画布，仅用于绘制
  _drawBlockIcon(cv, id);
  var img = document.createElement('img');
  img.width = 34; img.height = 34;   // 硬属性约束，绝不溢出
  img.src = cv.toDataURL();
  img.style.cssText = 'display:block;width:34px;height:34px;max-width:34px;max-height:34px;' +
    'border-radius:4px;flex-shrink:0;pointer-events:none';
  return img;
}

function buildHotbar() {
  var hbar = document.getElementById('hotbar');
  if (!hbar) return;
  hbar.innerHTML = '';

  var i, id, slot;
  var n = Math.min(7, player.inv.length);
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

  // 第 8 位：仓库按钮
  var bagBtn = document.createElement('div');
  bagBtn.className = 'slot bag-btn';
  bagBtn.textContent = '📦';
  bagBtn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    _ensureBag();
    _renderBag();
    toggleBag();
  }, { passive: false });
  bagBtn.addEventListener('click', function () {
    _ensureBag();
    _renderBag();
    toggleBag();
  });
  hbar.appendChild(bagBtn);
}

function _ensureBag() {
  if (_bagEl) return;
  var ui = document.getElementById('ui') || document.body;
  _bagEl = document.createElement('div');
  _bagEl.id = 'bag';
  _bagEl.style.cssText = 'position:absolute;bottom:80px;left:50%;transform:translateX(-50%);' +
    'display:none;grid-template-columns:repeat(5,62px);gap:5px;padding:10px;' +
    'background:rgba(0,0,0,.80);border-radius:12px;z-index:105;' +
    'overflow-y:auto;max-height:55vh;-webkit-overflow-scrolling:touch';
  ui.appendChild(_bagEl);
}

function _renderBag() {
  if (!_bagEl) return;
  _bagEl.innerHTML = '';
  var i;
  for (i = 7; i < player.inv.length; i++) {
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
  _bagEl.style.display = _bagEl.style.display === 'none' ? 'grid' : 'none';
}
