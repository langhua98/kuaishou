// ─── ui.js ────────────────────────────────────────────────────────────────────
// 游戏 UI：热键栏渲染、槽位选择、仓库面板。
// 每个槽位用 canvas 绘制等轴测微型方块图标（三面：顶/左/右），逼真展示方块外观。

var HOTBAR_N = 8;
var _bagEl = null;

// 在 68×68 离屏 canvas 上绘制等轴测方块图标（2× 超采样，显示时缩到 34）
function _drawBlockIcon(cv, id) {
  var ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 68, 68);
  // 枪支道具：用 emoji 直接渲染
  if (typeof GUN !== 'undefined' && id === GUN) {
    ctx.font = '46px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔫', 34, 36);   // 🔫
    return;
  }
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
    lbl.textContent = (typeof GUN !== 'undefined' && id === GUN) ? '枪支' : BNAMES[id];
    slot.appendChild(lbl);

    (function (idx, slotEl) {
      slotEl.addEventListener('touchstart', function (e) {
        e.preventDefault();
        var prev = document.getElementById('slot-' + player.slot);
        if (prev) prev.classList.remove('on');
        player.slot = idx;
        slotEl.classList.add('on');
        if (_hasGsap) gsap.fromTo(slotEl, { scale: 0.82 },
          { scale: 1, duration: 0.36, ease: 'back.out(2.4)', overwrite: true });
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

// ── 仓库面板 ──────────────────────────────────────────────────────────────────
// 全屏半透明遮罩 + 分类标签 + 居中滚动网格
var _bagOverlay = null;   // 遮罩层（拦截所有触摸）
var _bagScroll  = null;   // 可滚动内容区
var _bagCategory = '方块'; // 当前显示分类

function _ensureBag() {
  if (_bagEl) return;
  var ui = document.getElementById('ui') || document.body;

  // 遮罩：覆盖整屏，拦截所有触摸防止穿透到摄像机
  _bagOverlay = document.createElement('div');
  _bagOverlay.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:none;' +
    'flex-direction:column;align-items:center;justify-content:center;touch-action:none';
  _bagOverlay.addEventListener('touchmove', function (e) {
    if (_bagScroll && _bagScroll.contains(e.target)) return;
    e.preventDefault();
  }, { passive: false });

  // 标题栏
  var title = document.createElement('div');
  title.style.cssText = 'color:#fff;font-size:15px;font-family:monospace;letter-spacing:2px;' +
    'margin-bottom:8px;display:flex;align-items:center;gap:12px;width:100%;max-width:340px;justify-content:space-between;padding:0 4px';
  title.innerHTML = '<span>📦 物品仓库</span>';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);' +
    'color:#fff;border-radius:8px;padding:4px 12px;font-size:14px;cursor:pointer;font-family:monospace';
  closeBtn.addEventListener('touchstart', function (e) { e.preventDefault(); toggleBag(); }, { passive: false });
  closeBtn.addEventListener('click', toggleBag);
  title.appendChild(closeBtn);
  _bagOverlay.appendChild(title);

  // 分类标签行（方块 / 植物 / 家具）
  var tabsEl = document.createElement('div');
  tabsEl.id = 'bag-tabs';
  tabsEl.style.cssText =
    'display:flex;gap:6px;margin-bottom:8px;width:100%;max-width:340px';
  var _tabLabels = [['方块','🧱'],['植物','🌿'],['家具','🪑']];
  _tabLabels.forEach(function(pair) {
    var cat = pair[0], icon = pair[1];
    var btn = document.createElement('button');
    btn.textContent = icon + ' ' + cat;
    btn.dataset.cat = cat;
    btn.style.cssText =
      'flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(255,255,255,.25);' +
      'color:#fff;font-size:13px;font-family:monospace;cursor:pointer;' +
      'background:' + (cat === _bagCategory ? 'rgba(255,200,80,.38)' : 'rgba(255,255,255,.10)');
    (function (c, b) {
      b.addEventListener('touchstart', function (e) {
        e.preventDefault();
        _setBagCategory(c);
      }, { passive: false });
      b.addEventListener('click', function () { _setBagCategory(c); });
    }(cat, btn));
    tabsEl.appendChild(btn);
  });
  _bagOverlay.appendChild(tabsEl);

  // 滚动容器
  _bagScroll = document.createElement('div');
  _bagScroll.style.cssText =
    'width:100%;max-width:340px;max-height:58vh;overflow-y:auto;' +
    'overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;';

  // 网格
  _bagEl = document.createElement('div');
  _bagEl.id = 'bag';
  _bagEl.style.cssText =
    'display:grid;grid-template-columns:repeat(5,62px);gap:5px;padding:10px;' +
    'background:rgba(0,0,0,.80);border-radius:12px;justify-content:center';

  _bagScroll.appendChild(_bagEl);
  _bagOverlay.appendChild(_bagScroll);
  ui.appendChild(_bagOverlay);
}

// 切换分类并刷新网格
function _setBagCategory(cat) {
  _bagCategory = cat;
  var tabsEl = document.getElementById('bag-tabs');
  if (tabsEl) {
    var btns = tabsEl.querySelectorAll('button');
    for (var bi = 0; bi < btns.length; bi++) {
      btns[bi].style.background = (btns[bi].dataset.cat === cat)
        ? 'rgba(255,200,80,.38)' : 'rgba(255,255,255,.10)';
    }
  }
  _renderBag();
}

function _renderBag() {
  if (!_bagEl) return;
  _bagEl.innerHTML = '';
  var i;
  for (i = 7; i < player.inv.length; i++) {
    (function (idx) {
      var id = player.inv[idx];
      // 按分类过滤
      var isFurni = isFurnitureId(id);
      var isPlant = !!_PLANT[id] || (typeof isCropSeed === 'function' && isCropSeed(id));
      if (_bagCategory === '家具' && !isFurni) return;
      if (_bagCategory === '植物' && !isPlant) return;
      if (_bagCategory === '方块' && (isFurni || isPlant)) return;

      var el = document.createElement('div');
      el.className = 'slot';
      el.appendChild(_makeSlotIcon(id));
      var lbl = document.createElement('div');
      lbl.className = 'slot-lbl';
      lbl.textContent = BNAMES[id];
      el.appendChild(lbl);
      function pick() {
        var tmp = player.inv[player.slot];
        player.inv[player.slot] = player.inv[idx];
        player.inv[idx] = tmp;
        buildHotbar();
        toggleBag();   // 选完自动关闭
        if (typeof _updateHeldItem === 'function') _updateHeldItem(player.slot);
      }
      // 用 touchstart/touchend 判断"点"而非"滑"，不阻止事件以保留滚动
      var _ty = 0;
      el.addEventListener('touchstart', function (e) { _ty = e.touches[0].clientY; }, { passive: true });
      el.addEventListener('touchend', function (e) {
        if (Math.abs(e.changedTouches[0].clientY - _ty) < 12) pick();
      }, { passive: true });
      el.addEventListener('click', pick);
      _bagEl.appendChild(el);
    }(i));
  }
}

function toggleBag() {
  if (!_bagOverlay) return;
  if (typeof bagToggleSound === 'function') bagToggleSound();
  var open = _bagOverlay.style.display !== 'flex';
  if (open) {
    _bagOverlay.style.display = 'flex';
    if (_hasGsap) {
      gsap.fromTo(_bagOverlay, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, overwrite: true });
      if (_bagScroll) gsap.from(_bagScroll.children, { y: 18, autoAlpha: 0, scale: 0.92,
        duration: 0.32, stagger: 0.025, ease: 'power2.out', overwrite: true });
    }
  } else if (_hasGsap) {
    gsap.to(_bagOverlay, { autoAlpha: 0, duration: 0.18, ease: 'power2.in', overwrite: true,
      onComplete: function () { _bagOverlay.style.display = 'none'; gsap.set(_bagOverlay, { clearProps: 'opacity,visibility' }); } });
  } else {
    _bagOverlay.style.display = 'none';
  }
}
