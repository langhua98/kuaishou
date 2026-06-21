// ─── vehicles.js ──────────────────────────────────────────────────────────────
// 载具系统：放置/驾驶汽车（轿车/越野车/皮卡）
// GLB 文件放在 assets/models/vehicles/（可选，无文件时退化为彩色方块）

var VEH_CAR    = 301;  // 🚗轿车   → KayKit car_sedan
var VEH_TAXI   = 302;  // 🚕出租车 → KayKit car_taxi
var VEH_POLICE = 303;  // 🚓警车   → KayKit car_police
var VEH_BMW    = 304;  // 🏎️宝马330i → bmw_330i.glb（赛道跑车）

BNAMES[VEH_CAR]    = '🚗轿车';
BNAMES[VEH_TAXI]   = '🚕出租车';
BNAMES[VEH_POLICE] = '🚓警车';
BNAMES[VEH_BMW]    = '🏎️宝马330i';
BCOL[VEH_CAR]    = [0.20,0.40,0.90, 0.20,0.40,0.90, 0.20,0.40,0.90];
BCOL[VEH_TAXI]   = [0.95,0.80,0.10, 0.95,0.80,0.10, 0.95,0.80,0.10];
BCOL[VEH_POLICE] = [0.20,0.25,0.55, 0.20,0.25,0.55, 0.20,0.25,0.55];
BCOL[VEH_BMW]    = [0.11,0.43,0.95, 0.11,0.43,0.95, 0.11,0.43,0.95];

// gltf = assets/models/vehicles/ 下的 KayKit City Builder Bits 模型（CC0）
// w/h/d = 占位方块半尺寸（格），仅在模型未加载时使用。
var _VEHICLE_DEFS = {};
_VEHICLE_DEFS[VEH_CAR]    = { name:'🚗轿车',   gltf:'car_sedan.gltf',  speed:16, turnSpd:2.0, color:0x3366cc, w:0.45, h:0.30, d:0.85, scaleW:2.0 };
_VEHICLE_DEFS[VEH_TAXI]   = { name:'🚕出租车', gltf:'car_taxi.gltf',   speed:15, turnSpd:1.9, color:0xf2cc1a, w:0.45, h:0.32, d:0.85, scaleW:2.0 };
_VEHICLE_DEFS[VEH_POLICE] = { name:'🚓警车',   gltf:'car_police.gltf', speed:17, turnSpd:2.0, color:0x33408c, w:0.45, h:0.31, d:0.85, scaleW:2.0 };
_VEHICLE_DEFS[VEH_BMW]    = { name:'🏎️宝马330i', gltf:'bmw_330i.glb',  speed:24, turnSpd:2.1, color:0x1c6ef2, w:0.45, h:0.30, d:0.90, scaleW:2.2 };

// placed vehicles: key → { typeId, key, cx, cy, cz, yaw, group }
// cx/cy/cz = world-space center (float), updated every frame while mounted
var _vehiclePlaced = {};
var _mountedVehicle = null;  // entry object from _vehiclePlaced, or null

// 驾驶按钮状态（被 drive-ui 的 touchstart/touchend 更新）
var _driveSteer     = 0;      // 模拟量 -1.0~+1.0（转向摇杆）
var _driveGas       = 0;      // 1=踩油门 0=松开
var _driveBrake     = 0;      // 1=刹车/倒车 0=松开
var _driveHandbrake = 0;      // 1=手刹按下（漂移）
var _driveAuto      = false;  // 自动驾驶（持续油门，无需按油门键）
var _driveCamYaw    = 0;      // 相机朝向（平滑跟随车头，制造"车在转"的观感）
var _driveUIBound   = false;
var _camIntro = { d: 6.0, h: 3.2 };  // 追车相机距离/高度（上车时 GSAP 缓动入场）
var _spObj = { v: 0 }, _spQuick = null;  // 速度表数字滚动（gsap.quickTo）
// _hasGsap 在 init.js 定义（全局共享）

// 按钮按下/抬起的 GSAP 缩放反馈
function _pressFX(el, down) {
  if (!_hasGsap) return;
  gsap.to(el, { scale: down ? 0.88 : 1, duration: down ? 0.08 : 0.32,
                ease: down ? 'power2.out' : 'back.out(2.2)', overwrite: true });
}

function _initDriveUI() {
  if (_driveUIBound) return;
  _driveUIBound = true;

  // ── 长按辅助（油门/刹车/手刹）──
  function hold(el, onStart, onEnd) {
    if (!el) return;
    el.addEventListener('touchstart',  function(e){ e.preventDefault(); onStart(); _pressFX(el, true);  }, { passive:false });
    el.addEventListener('touchend',    function(e){ e.preventDefault(); onEnd();   _pressFX(el, false); }, { passive:false });
    el.addEventListener('touchcancel', function(e){ e.preventDefault(); onEnd();   _pressFX(el, false); }, { passive:false });
  }
  hold(document.getElementById('d-gas'),   function(){ _driveGas       = 1; }, function(){ _driveGas       = 0; });
  hold(document.getElementById('d-brake'), function(){ _driveBrake     = 1; }, function(){ _driveBrake     = 0; });
  hold(document.getElementById('d-hb'),    function(){ _driveHandbrake = 1; }, function(){ _driveHandbrake = 0; });

  // ── 模拟转向摇杆（X 轴 = 转向，-1.0 ~ +1.0）──
  var _djRing = document.getElementById('d-steer-ring');
  var _djKnob = document.getElementById('d-steer-knob');
  var _djId = -1, _djOx = 0, _djOy = 0, _DJ_R = 36;
  function _djUpdate(cx, cy) {
    var dx = cx - _djOx, dy = cy - _djOy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var s = dist > _DJ_R ? _DJ_R / dist : 1;
    var nx = dx * s, ny = dy * s;
    _driveSteer = nx / _DJ_R;
    if (_djKnob) {
      if (_hasGsap) gsap.to(_djKnob, { x: nx, y: ny, duration: 0.04, overwrite: true });
      else _djKnob.style.transform = 'translate(calc(-50% + ' + nx + 'px),calc(-50% + ' + ny + 'px))';
    }
  }
  function _djReset() {
    _driveSteer = 0; _djId = -1;
    if (_djKnob) {
      if (_hasGsap) gsap.to(_djKnob, { x: 0, y: 0, duration: 0.25, ease: 'elastic.out(1,0.5)', overwrite: true });
      else _djKnob.style.transform = 'translate(-50%,-50%)';
    }
  }
  if (_djRing) {
    _djRing.addEventListener('touchstart', function(e) {
      e.preventDefault();
      var t = e.changedTouches[0]; _djId = t.identifier;
      var r = _djRing.getBoundingClientRect();
      _djOx = r.left + r.width / 2; _djOy = r.top + r.height / 2;
      _djUpdate(t.clientX, t.clientY);
    }, { passive: false });
    _djRing.addEventListener('touchmove', function(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === _djId)
          _djUpdate(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
      }
    }, { passive: false });
    _djRing.addEventListener('touchend',    function(e) { e.preventDefault(); _djReset(); }, { passive: false });
    _djRing.addEventListener('touchcancel', function(e) { e.preventDefault(); _djReset(); }, { passive: false });
  }

  // ── 自动驾驶切换（点击切换，持续油门）──
  var autoBtn = document.getElementById('d-auto');
  if (autoBtn) {
    autoBtn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      _driveAuto = !_driveAuto;
      autoBtn.classList.toggle('active', _driveAuto);
      _pressFX(autoBtn, true);
    }, { passive: false });
    autoBtn.addEventListener('touchend', function(e) { e.preventDefault(); _pressFX(autoBtn, false); }, { passive: false });
  }

  // ── 下车按钮 ──
  var ex = document.getElementById('d-exit');
  if (ex) {
    ex.addEventListener('touchstart', function(e){ e.preventDefault(); _pressFX(ex, true); }, { passive:false });
    ex.addEventListener('touchend',   function(e){ e.preventDefault(); _pressFX(ex, false); dismountVehicle(); }, { passive:false });
  }
}

function isVehicleId(id) { return id >= 301 && id <= 304; }

// 用基本几何体拼一辆车：底盘 + 车厢 + 4 轮。返回 Group（脚部对齐 y=0）。
function _buildCarMesh(def) {
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshLambertMaterial({ color: def.color });
  var darkMat = new THREE.MeshLambertMaterial({ color: 0x222228 });
  var glassMat = new THREE.MeshLambertMaterial({ color: 0x88bbdd });

  var W = def.w * 2, H = def.h * 2, D = def.d * 2;
  var wheelR = def.h * 0.45;

  // 底盘（主车身）
  var chassis = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.6, D), bodyMat);
  chassis.position.y = wheelR + H * 0.3;
  g.add(chassis);

  // 车厢（驾驶室，略窄略短，靠后）
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, H * 0.55, D * 0.5), glassMat);
  cabin.position.set(0, wheelR + H * 0.6 + H * 0.275, -D * 0.05);
  g.add(cabin);

  // 4 个轮子（圆柱，横向放置）
  var wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, W * 0.18, 12);
  var wx2 = W * 0.5 + W * 0.02, wz2 = D * 0.32;
  var offs = [[wx2, wz2], [-wx2, wz2], [wx2, -wz2], [-wx2, -wz2]];
  for (var i = 0; i < offs.length; i++) {
    var wh = new THREE.Mesh(wheelGeo, darkMat);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(offs[i][0], wheelR, offs[i][1]);
    g.add(wh);
  }
  return g;
}

function nearestVehicle(px, py, pz, radius) {
  var best = null, bestD2 = radius * radius;
  for (var k in _vehiclePlaced) {
    var e = _vehiclePlaced[k];
    var dx = e.cx - px, dz = e.cz - pz;
    var d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = k; }
  }
  return best;
}

function placeVehicle(typeId, wx, wy, wz, yaw) {
  var def = _VEHICLE_DEFS[typeId];
  if (!def) return null;
  var key = wx + ',' + wy + ',' + wz;
  var grp = new THREE.Group();

  // Placeholder car shape (底盘+车厢+4轮) shown until / if GLB loads
  var body = _buildCarMesh(def);
  grp.add(body);

  grp.position.set(wx + 0.5, wy, wz + 0.5);
  grp.rotation.y = yaw || 0;
  scene.add(grp);

  var entry = { typeId: typeId, key: key, cx: wx + 0.5, cy: wy, cz: wz + 0.5,
                yaw: yaw || 0, group: grp };
  _vehiclePlaced[key] = entry;

  // Async load real KayKit model; keep textured material. Falls back to placeholder on error.
  if (typeof gltfLoader !== 'undefined' && def.gltf) {
    gltfLoader.load('assets/models/vehicles/' + def.gltf, function(gltf) {
      grp.remove(body);
      var model = gltf.scene;
      var bb = new THREE.Box3().setFromObject(model);
      var modelW = bb.max.x - bb.min.x;
      var s = (def.scaleW || 1.0) / (modelW > 0.01 ? modelW : 1);
      model.scale.setScalar(s);
      bb.setFromObject(model);
      model.position.y = -bb.min.y;          // 轮子落地
      model.rotation.y = Math.PI;            // KayKit 车头朝 +Z；游戏前进为 -Z，翻转 180°
      entry.model = model;
      grp.add(model);
    }, undefined, function() { /* asset not found – keep placeholder car shape */ });
  }
  return entry;
}

// 驾驶时需要隐藏的常规 UI（热键栏/按钮/摇杆；保留 look-zone 以支持驾驶自由视角）
function _setWalkUI(show) {
  var ids = ['btns', 'joy-zone', 'hotbar'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.style.display = show ? '' : 'none';
  }
}

function mountVehicle(key) {
  var entry = _vehiclePlaced[key];
  if (!entry) return;
  _mountedVehicle = entry;
  entry.speed = 0;
  _driveSteer = 0; _driveGas = 0; _driveBrake = 0; _driveHandbrake = 0; _driveAuto = false;
  _driveCamYaw = entry.yaw;
  var autoBtn = document.getElementById('d-auto');
  if (autoBtn) autoBtn.classList.remove('active');
  // Force third-person so the driving chase-cam is used
  if (typeof viewFP !== 'undefined' && viewFP && typeof toggleView === 'function') toggleView();

  _initDriveUI();
  _setWalkUI(false);
  var du = document.getElementById('drive-ui');
  if (du) du.classList.add('on');
  var sp = document.getElementById('speedo');
  if (sp) sp.classList.add('on');

  // GSAP 入场：转向摇杆从左滑入、踏板从右滑入、下车/自驾从上落下、速度表淡入
  if (_hasGsap) {
    gsap.from('#d-steer-ring', { x: -60, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.7)', overwrite: true });
    gsap.from('#drive-pedals .dbtn', { x: 60, autoAlpha: 0, duration: 0.4, stagger: 0.06, ease: 'back.out(1.7)', overwrite: true });
    gsap.from('#d-exit',  { y: -40, autoAlpha: 0, duration: 0.4, ease: 'back.out(1.7)', overwrite: true });
    gsap.from('#d-auto',  { y: -30, autoAlpha: 0, duration: 0.35, ease: 'back.out(1.7)', overwrite: true, delay: 0.08 });
    if (sp) gsap.from(sp, { autoAlpha: 0, y: 10, duration: 0.3, overwrite: true });
    gsap.fromTo(_camIntro, { d: 9.5, h: 6.5 }, { d: 6.0, h: 3.2, duration: 0.7, ease: 'power3.out', overwrite: true });
  }
}

function dismountVehicle() {
  var ent = _mountedVehicle;
  _mountedVehicle = null;
  _driveSteer = 0; _driveGas = 0; _driveBrake = 0; _driveHandbrake = 0;
  _driveAuto = false;
  var _autoEl = document.getElementById('d-auto');
  if (_autoEl) _autoEl.classList.remove('active');

  // 把玩家挪到车左侧并落到地面：否则玩家留在车体内，第三人称相机被不透明车体挡住 → 黑屏
  if (ent) {
    var lx = -Math.cos(ent.yaw), lz = Math.sin(ent.yaw);  // 车体左方（与车头垂直）
    player.x = ent.cx + lx * 2.4;
    player.z = ent.cz + lz * 2.4;
    for (var gy = CHUNK_H - 1; gy >= 0; gy--) {
      if (getBlock(Math.floor(player.x), gy, Math.floor(player.z)) !== AIR) { player.y = gy + 1; break; }
    }
    player.vx = 0; player.vy = 0; player.vz = 0;
    ent.speed = 0;
    // 重置第三人称相机平滑，避免镜头从车位猛拉
    if (typeof _camDcur !== 'undefined') _camDcur = CAM_DIST;
    if (typeof _pivInit !== 'undefined') _pivInit = false;
  }

  var du = document.getElementById('drive-ui');
  var sp = document.getElementById('speedo');

  function _finish() {
    if (du) du.classList.remove('on');
    if (sp) sp.classList.remove('on');
    _setWalkUI(true);   // 恢复行走 UI → 玩家模型重新出现（game.js 控制 playerGroup 可见性）
  }
  // GSAP 退场后再恢复常规 UI
  if (_hasGsap && du) {
    gsap.to('#drive-ui .dbtn, #d-exit, #d-auto, #d-steer-ring', { autoAlpha: 0, scale: 0.6, duration: 0.22, ease: 'power2.in', overwrite: true,
      onComplete: function(){ gsap.set('#drive-ui .dbtn, #d-exit, #d-auto, #d-steer-ring', { clearProps: 'all' }); _finish(); } });
  } else {
    _finish();
  }
}

function updateVehicles(dt) {
  if (!_mountedVehicle) return;
  var def = _VEHICLE_DEFS[_mountedVehicle.typeId];
  if (!def) return;

  // 转向摇杆优先；无摇杆时 fallback 到行走摇杆（jx）
  var jx = joy.dx / JOY_R, jy = joy.dy / JOY_R;
  var jLen = Math.sqrt(jx * jx + jy * jy);
  if (jLen > 1) { jx /= jLen; jy /= jLen; }

  // 自动驾驶时视同持续按油门（手刹/倒车仍可覆盖）
  var gas   = (_driveGas || _driveAuto) ? 1 : (jy < -0.1 ? -jy : 0);   // 0..1
  var brake = _driveBrake ? 1 : (jy > 0.1 ? jy : 0);                   // 0..1
  var steer = _driveSteer || jx;                                         // -1..1

  // ── 动量模型：手刹 / 油门 / 刹车 / 滑行 ──
  var maxFwd = def.speed, maxRev = def.speed * 0.4;
  var accel  = def.speed * 1.3;
  var bDecel = def.speed * 2.4;
  var fric   = def.speed * 0.9;
  var spd = _mountedVehicle.speed || 0;

  if (_driveHandbrake) {
    // 手刹：强制快速减速，不倒车；维持高转向比以模拟漂移甩尾
    var hbFric = def.speed * 3.5;
    if (spd > 0) spd = Math.max(0, spd - hbFric * dt);
    else if (spd < 0) spd = Math.min(0, spd + hbFric * dt);
  } else if (gas) {
    spd += accel * gas * dt;
  } else if (brake) {
    if (spd > 0.3) spd -= bDecel * dt;               // 前进中先刹停
    else           spd -= accel * 0.7 * brake * dt;  // 已停 → 倒车
  } else {
    if (spd > 0) spd = Math.max(0, spd - fric * dt);
    else if (spd < 0) spd = Math.min(0, spd + fric * dt);
  }
  if (spd >  maxFwd) spd = maxFwd;
  if (spd < -maxRev) spd = -maxRev;
  _mountedVehicle.speed = spd;

  // ── 转向：手刹时维持最低 0.6 转向系数，模拟甩尾仍能大幅打方向 ──
  var speedF = Math.min(1, Math.abs(spd) / 2.5);
  if (_driveHandbrake) speedF = Math.max(0.6, speedF);
  var dir = spd >= 0 ? 1 : -1;
  _mountedVehicle.yaw -= steer * def.turnSpd * dt * speedF * dir;
  player.yaw = _mountedVehicle.yaw;

  player.vx = -Math.sin(_mountedVehicle.yaw) * spd;
  player.vz = -Math.cos(_mountedVehicle.yaw) * spd;
}

// 在 resolveAABB 之后调用：把车模型同步到玩家的权威位置，平滑相机朝向，刷新速度表
function syncMountedVehicle(dt) {
  if (!_mountedVehicle) return;
  var grp = _mountedVehicle.group;
  if (grp) {
    grp.position.set(player.x, player.y, player.z);
    grp.rotation.y = _mountedVehicle.yaw;   // 车模型立即转向 → 看得到车在转
  }
  _mountedVehicle.cx = player.x;
  _mountedVehicle.cy = player.y;
  _mountedVehicle.cz = player.z;

  // 相机朝向以最短角差平滑跟随车头（滞后 → 转弯时车体相对镜头明显旋转）
  var d = _mountedVehicle.yaw - _driveCamYaw;
  while (d >  Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  _driveCamYaw += d * Math.min(1, (dt || 0.016) * 4);

  // 速度表：用 gsap.quickTo 平滑滚动数字（适合每帧高频更新的属性）
  var spv = document.getElementById('speedo-val');
  if (spv) {
    var target = Math.sqrt(player.vx * player.vx + player.vz * player.vz) * 6;
    if (_hasGsap) {
      if (!_spQuick) {
        _spQuick = gsap.quickTo(_spObj, 'v', { duration: 0.25, ease: 'power2.out',
          onUpdate: function () { spv.textContent = Math.round(_spObj.v); } });
      }
      _spQuick(target);
    } else {
      spv.textContent = Math.round(target);
    }
  }
}
