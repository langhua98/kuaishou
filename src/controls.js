// ─── controls.js ──────────────────────────────────────────────────────────────
// 移动端触屏控制：虚拟摇杆 + 视角滑动 + 动作按钮。
//
// 屏幕分区：
//   左侧 42%（#joy-zone）：虚拟摇杆，单点追踪，最大偏移 48px
//   右侧 58%（#look-zone）：自由视角，拖动增量更新 yaw/pitch
//
// 虚拟摇杆（joy）：
//   joy.dx/dy  — 摇杆偏移像素（-48 到 +48），由 game.js 每帧读取
//   偏移换算为移动速度：joy.dx/48 ∈ [-1, 1]
//
// 视角控制：
//   水平拖动 → player.yaw   -= delta × 0.005
//   垂直拖动 → player.pitch -= delta × 0.005
//   pitch 限制在 [-1.2, 1.2] rad（避免极端视角）
//
// 破坏/放置按钮支持长按：
//   touchstart → 设置 player.breakQ/placeQ=true 并标记 breakHeld/placeHeld
//   touchend   → 清除 breakHeld/placeHeld（单次触发由 game.js 消费，持续由 held 驱动）

var joy     = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 };
var lookAct = false, lookId = -1, lookLx = 0, lookLy = 0;

// 长按标志：game.js 在 tick 中读取
// breakHeld/placeHeld 配合冷却计时实现持续挖/放
// jumpHeld/downHeld 在飞行模式下作为升/降油门
var breakHeld = false, placeHeld = false;
var jumpHeld  = false, downHeld  = false;

var JOY_R = 48;  // 摇杆最大偏移半径（像素）

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
    joy.dx = Math.max(-JOY_R, Math.min(JOY_R, t.clientX - joy.cx));
    joy.dy = Math.max(-JOY_R, Math.min(JOY_R, t.clientY - joy.cy));
    joyThumb.style.transform =
      'translate(calc(-50% + ' + joy.dx + 'px),calc(-50% + ' + joy.dy + 'px))';
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
joyZone.addEventListener('touchend',    jEnd, { passive: false });
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
    var dyaw = (t.clientX - lookLx) * 0.005;
    // 驾驶时：滑动只转相机，不转车头
    if (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) {
      _driveCamYaw -= dyaw;
    } else {
      player.yaw -= dyaw;
    }
    player.pitch -= (t.clientY - lookLy) * 0.005;
    // ±89°（原版 ±90°；留 1° 余量避免万向锁奇点）
    player.pitch  = Math.max(-1.55, Math.min(1.55, player.pitch));
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
lookZone.addEventListener('touchend',    lEnd, { passive: false });
lookZone.addEventListener('touchcancel', lEnd, { passive: false });

// ── 动作按钮 ──────────────────────────────────────────────────────────────────
// 跳跃/飞行：单次触发
function tapBtn(id, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('touchstart', function (e) { e.preventDefault(); fn(); }, { passive: false });
}

// 破坏：长按持续破坏，touchstart 触发首次
(function () {
  var el = document.getElementById('b-brk');
  if (!el) return;
  el.addEventListener('touchstart', function (e) {
    e.preventDefault();
    player.breakQ = true;  // 立即触发第一次
    breakHeld = true;
  }, { passive: false });
  el.addEventListener('touchend',    function (e) { e.preventDefault(); breakHeld = false; }, { passive: false });
  el.addEventListener('touchcancel', function ()  { breakHeld = false; }, { passive: false });
}());

// 放置：长按持续放置
(function () {
  var el = document.getElementById('b-plc');
  if (!el) return;
  el.addEventListener('touchstart', function (e) {
    e.preventDefault();
    player.placeQ = true;  // 立即触发第一次
    placeHeld = true;
  }, { passive: false });
  el.addEventListener('touchend',    function (e) { e.preventDefault(); placeHeld = false; }, { passive: false });
  el.addEventListener('touchcancel', function ()  { placeHeld = false; }, { passive: false });
}());

// 跳跃：单击触发跳跃（地面），按住时在飞行模式下持续上升
(function () {
  var el = document.getElementById('b-jump');
  if (!el) return;
  el.addEventListener('touchstart', function (e) {
    e.preventDefault();
    player.jumpQ = true;
    jumpHeld = true;
  }, { passive: false });
  el.addEventListener('touchend',    function (e) { e.preventDefault(); jumpHeld = false; }, { passive: false });
  el.addEventListener('touchcancel', function ()  { jumpHeld = false; }, { passive: false });
}());

// 下降：仅飞行模式可见（#btns.flying 控制），按住持续下降
(function () {
  var el = document.getElementById('b-down');
  if (!el) return;
  el.addEventListener('touchstart', function (e) {
    e.preventDefault();
    downHeld = true;
  }, { passive: false });
  el.addEventListener('touchend',    function (e) { e.preventDefault(); downHeld = false; }, { passive: false });
  el.addEventListener('touchcancel', function ()  { downHeld = false; }, { passive: false });
}());

// 视角切换：第一/第三人称（toggleView 定义在 game.js）
tapBtn('b-view', function () { toggleView(); });

// 旋转家具幽灵预览（rotateFurnitureGhost 定义在 furniture.js）
tapBtn('b-rot', function () { if (typeof rotateFurnitureGhost === 'function') rotateFurnitureGhost(); });

// 家具互动：开关灯/坐下/休息（doInteract 定义在 game.js）
tapBtn('b-act', function () { if (typeof doInteract === 'function') doInteract(); });

tapBtn('b-fly', function () {
  player.flying = !player.flying;
  player.vy = 0;
  var el = document.getElementById('b-fly');
  if (el) el.classList.toggle('on', player.flying);
  // 飞行时显示下降键
  var btns = document.getElementById('btns');
  if (btns) btns.classList.toggle('flying', player.flying);
});
