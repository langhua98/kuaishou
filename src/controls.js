// ─── controls.js ──────────────────────────────────────────────────────────────
// 移动端触屏控制：虚拟摇杆 + 视角滑动 + 动作按钮。
//
// 屏幕分区：
//   左侧 40%（#joy-zone）：虚拟摇杆，单点追踪，最大偏移 40px
//   右侧 60%（#look-zone）：自由视角，拖动增量更新 yaw/pitch
//
// 虚拟摇杆（joy）：
//   joy.dx/dy  — 摇杆偏移像素（-40 到 +40），由 game.js 每帧读取
//   偏移换算为移动速度：joy.dx/40 ∈ [-1, 1]
//
// 视角控制：
//   水平拖动 → player.yaw   -= delta * 0.004（向右拖 = yaw 减小 = 向右看）
//   垂直拖动 → player.pitch -= delta * 0.004（向下拖 = pitch 减小 = 向下看）
//   pitch 限制在 [-1.5, 1.5] rad（约 ±86°，避免翻转）
//
// 按钮（#b-jump/brk/plc/fly）：touchstart 触发，设置 player.*Q 标志，
//   由 game.js 在下一帧处理后清除。

var joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
var lookAct = false, lookId = -1, lookLx = 0, lookLy = 0;

var joyZone  = document.getElementById('joy-zone');
var joyThumb = document.getElementById('joy-thumb');
var joyBase  = document.getElementById('joy-base');
var lookZone = document.getElementById('look-zone');

// ── 摇杆 ──────────────────────────────────────────────────────────────────────
joyZone.addEventListener('touchstart', function (e) {
  e.preventDefault();
  var i, t, r;
  for (i = 0; i < e.changedTouches.length; i++) {
    t = e.changedTouches[i];
    if (joy.active) continue;
    joy.active = true; joy.id = t.identifier;
    r = joyBase.getBoundingClientRect();
    joy.cx = r.left + r.width / 2;
    joy.cy = r.top  + r.height / 2;
    joy.dx = 0; joy.dy = 0;
  }
}, { passive: false });

joyZone.addEventListener('touchmove', function (e) {
  e.preventDefault();
  var i, t;
  for (i = 0; i < e.changedTouches.length; i++) {
    t = e.changedTouches[i];
    if (t.identifier !== joy.id) continue;
    joy.dx = Math.max(-40, Math.min(40, t.clientX - joy.cx));
    joy.dy = Math.max(-40, Math.min(40, t.clientY - joy.cy));
    joyThumb.style.transform = 'translate(calc(-50% + ' + joy.dx + 'px),calc(-50% + ' + joy.dy + 'px))';
  }
}, { passive: false });

function jEnd(e) {
  e.preventDefault();
  var i;
  for (i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joy.id) {
      joy.active = false; joy.dx = 0; joy.dy = 0;
      joyThumb.style.transform = 'translate(-50%,-50%)';
    }
  }
}
joyZone.addEventListener('touchend',   jEnd, { passive: false });
joyZone.addEventListener('touchcancel', jEnd, { passive: false });

// ── 视角滑动 ──────────────────────────────────────────────────────────────────
lookZone.addEventListener('touchstart', function (e) {
  e.preventDefault();
  var i, t;
  for (i = 0; i < e.changedTouches.length; i++) {
    t = e.changedTouches[i];
    if (lookAct) continue;
    lookAct = true; lookId = t.identifier;
    lookLx = t.clientX; lookLy = t.clientY;
  }
}, { passive: false });

lookZone.addEventListener('touchmove', function (e) {
  e.preventDefault();
  var i, t;
  for (i = 0; i < e.changedTouches.length; i++) {
    t = e.changedTouches[i];
    if (t.identifier !== lookId) continue;
    player.yaw   -= (t.clientX - lookLx) * 0.004;
    player.pitch -= (t.clientY - lookLy) * 0.004;
    player.pitch  = Math.max(-1.5, Math.min(1.5, player.pitch));
    lookLx = t.clientX; lookLy = t.clientY;
  }
}, { passive: false });

function lEnd(e) {
  e.preventDefault();
  var i;
  for (i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === lookId) lookAct = false;
  }
}
lookZone.addEventListener('touchend',   lEnd, { passive: false });
lookZone.addEventListener('touchcancel', lEnd, { passive: false });

// ── 动作按钮 ──────────────────────────────────────────────────────────────────
function tapBtn(id, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
}

tapBtn('b-jump', function () { player.jumpQ  = true; });
tapBtn('b-brk',  function () { player.breakQ = true; });
tapBtn('b-plc',  function () { player.placeQ = true; });
tapBtn('b-fly',  function () {
  player.flying = !player.flying;
  player.vy = 0;
  var el = document.getElementById('b-fly');
  if (el) el.classList.toggle('on', player.flying);
});
