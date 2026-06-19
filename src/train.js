// ─── train.js ─────────────────────────────────────────────────────────────────
// 高铁系统：固定直线轨道 + 自动往返列车 + 上车乘坐
//   轨道沿 X 轴，Z=RAIL_Z 一线；平整轨道床在 world.js genTerrain（_rail）里烤入地图。
//   列车（车头 + 2 车厢）自动在两端车站之间往返，到站停靠 TRAIN_DWELL 秒。
//   玩家靠近停靠的列车时出现「上车」按钮，乘坐时跟随列车移动。
//
//   模型来源：Quaternius Modular Train Pack（CC0），assets/models/train/
//   依赖：gltfLoader（models.js）、scene/camera（renderer.js）、player（game.js）
//   对外全局：_onTrain（game.js 主循环读取，乘车时跳过行走物理）

var RAIL_Z       = 30;          // 轨道中心 Z（与 world.js _rail 带一致）
var RAIL_X0      = -100;        // 轨道西端
var RAIL_X1      = 100;         // 轨道东端
var RAIL_TOP     = SEA + 3;     // 轨面/站台站立高度（床块 y=SEA+2，顶面 +1）
var TRAIN_CRUISE = 22;          // 巡航速度 u/s
var TRAIN_ACCEL  = 6;           // 加速度 u/s²
var TRAIN_DECEL  = 8;           // 减速度 u/s²
var TRAIN_DWELL  = 4;           // 到站停靠秒数
var TRAIN_MARGIN = 8;           // 端点留白（停在站台中心）

// ── 运行状态 ───────────────────────────────────────────────────────────────────
var _onTrain     = false;       // 玩家是否在车上（game.js 读取此全局）
var _trainReady  = false;       // 车头+车厢模型是否就绪
var _trainCars   = [];          // [{ group, model, isFront }]，index 0 = 车头
var _carSpacing  = 7;           // 相邻车厢中心间距（载入后按模型长度更新）
var _carH        = 2.5;         // 车厢高度（载入后更新）
var _trainX      = RAIL_X0 + TRAIN_MARGIN;  // 车头当前 X
var _trainV      = 0;           // 当前速度 u/s
var _trainDir    = 1;           // +1 朝 +X，-1 朝 -X
var _trainState  = 'dwell';     // 'dwell'（停靠）| 'run'（行驶）
var _trainDwellT = TRAIN_DWELL; // 停靠剩余秒数
var _trainBoardBtn = null;      // 上/下车 DOM 按钮

// ── 初始化（game.js boot 调用）─────────────────────────────────────────────────
function initTrain() {
  if (typeof gltfLoader === 'undefined') return;
  _buildTrainBoardBtn();
  _buildStations();

  // 1. 沿 X 平铺轨道 GLB
  gltfLoader.load('assets/models/train/rail_straight.glb', function (g) {
    var proto = g.scene;
    proto.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(proto);
    var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
    var rotY = (dz > dx) ? Math.PI / 2 : 0;     // 长轴是 Z 则转 90° 到 X
    var segLen = Math.max(dx, dz);
    if (!(segLen > 0.3)) segLen = 2;
    var yOff = RAIL_TOP - bb.min.y;
    var n = Math.ceil((RAIL_X1 - RAIL_X0) / segLen) + 1;
    for (var i = 0; i < n; i++) {
      var tile = proto.clone(true);
      tile.rotation.y = rotY;
      tile.position.set(RAIL_X0 + i * segLen + segLen / 2, yOff, RAIL_Z + 0.5);
      scene.add(tile);
    }
  }, undefined, function () { /* 无模型则只剩烤平床 */ });

  // 2. 列车：车头 + 2 节高速车厢
  gltfLoader.load('assets/models/train/highspeed_front.glb', function (gf) {
    _addCar(gf.scene, true);
    gltfLoader.load('assets/models/train/highspeed_wagon.glb', function (gw) {
      _addCar(gw.scene.clone(true), false);
      _addCar(gw.scene.clone(true), false);
      _trainReady = true;
    }, undefined, function () { _trainReady = true; });
  }, undefined, function () { /* 无模型 */ });
}

// 单节车：定向（长轴沿 X）、居中到 group 原点、轮子落到轨面
function _addCar(model, isFront) {
  model.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(model);
  var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
  model.rotation.y = (dz > dx) ? Math.PI / 2 : 0;
  model.updateMatrixWorld(true);
  bb.setFromObject(model);
  var cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  model.position.x -= cx;                 // X 中心归零
  model.position.z -= cz;                 // Z 中心归零
  model.position.y = RAIL_TOP - bb.min.y; // 轮子落到轨面

  var carLen = Math.max(dx, dz);
  if (carLen + 0.6 > _carSpacing) _carSpacing = carLen + 0.6;
  _carH = bb.max.y - bb.min.y;

  var grp = new THREE.Group();
  grp.add(model);
  scene.add(grp);
  _trainCars.push({ group: grp, model: model, isFront: isFront });
}

// 两端车站：用简单盒子网格搭遮棚（不依赖区块/setBlock）
function _buildStations() {
  var ends = [RAIL_X0 + TRAIN_MARGIN, RAIL_X1 - TRAIN_MARGIN];
  for (var e = 0; e < ends.length; e++) {
    var ex = ends[e];
    var st = new THREE.Group();
    // 站台板（+Z 侧月台，紧贴轨道床）
    var plat = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.2, 3),
      new THREE.MeshLambertMaterial({ color: 0xbfb39a })
    );
    plat.position.set(ex, RAIL_TOP + 0.1, RAIL_Z + 2.5);
    st.add(plat);
    // 4 根立柱
    var postMat = new THREE.MeshLambertMaterial({ color: 0x6b4f33 });
    var px, pz, p;
    var posts = [[ex - 6, RAIL_Z + 1.5], [ex + 6, RAIL_Z + 1.5],
                 [ex - 6, RAIL_Z + 3.5], [ex + 6, RAIL_Z + 3.5]];
    for (var i = 0; i < posts.length; i++) {
      p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), postMat);
      p.position.set(posts[i][0], RAIL_TOP + 1.5, posts[i][1]);
      st.add(p);
    }
    // 顶棚
    var roof = new THREE.Mesh(
      new THREE.BoxGeometry(13.5, 0.3, 3.2),
      new THREE.MeshLambertMaterial({ color: 0x3b6ea5 })
    );
    roof.position.set(ex, RAIL_TOP + 3.1, RAIL_Z + 2.5);
    st.add(roof);
    scene.add(st);
  }
}

// ── 每帧更新（game.js 主循环每帧调用，无论是否乘车）────────────────────────────
function updateTrain(dt) {
  if (!_trainReady) { _updateBoardBtn(); return; }

  // 自动驾驶状态机
  if (_trainState === 'dwell') {
    _trainV = 0;
    _trainDwellT -= dt;
    if (_trainDwellT <= 0) _trainState = 'run';
  } else {
    var endX   = (_trainDir > 0) ? (RAIL_X1 - TRAIN_MARGIN) : (RAIL_X0 + TRAIN_MARGIN);
    var remain = (endX - _trainX) * _trainDir;             // 前方剩余距离（≥0）
    var stopD  = (_trainV * _trainV) / (2 * TRAIN_DECEL);  // 当前速度刹停距离
    if (remain <= stopD) {
      _trainV -= TRAIN_DECEL * dt;
      if (_trainV < 0) _trainV = 0;
    } else {
      _trainV += TRAIN_ACCEL * dt;
      if (_trainV > TRAIN_CRUISE) _trainV = TRAIN_CRUISE;
    }
    _trainX += _trainDir * _trainV * dt;
    if (remain <= 0.4 && _trainV < 0.6) {                  // 到站
      _trainX = endX;
      _trainV = 0;
      _trainDir = -_trainDir;
      _trainState = 'dwell';
      _trainDwellT = TRAIN_DWELL;
    }
  }

  // 同步各节车位置（车头在 _trainX，车厢依次拖在后方）
  for (var i = 0; i < _trainCars.length; i++) {
    var carX = _trainX - _trainDir * i * _carSpacing;
    var c = _trainCars[i];
    c.group.position.set(carX, 0, RAIL_Z + 0.5);
    c.group.rotation.y = (_trainDir > 0) ? 0 : Math.PI;    // 整车翻转朝向行进方向
  }

  // 乘车：把玩家锁在车头座位（玩家模型由 game.js 隐藏）
  if (_onTrain) {
    player.x = _trainX;
    player.z = RAIL_Z + 0.5;
    player.y = RAIL_TOP + 0.5;
    player.yaw = (_trainDir > 0) ? -Math.PI / 2 : Math.PI / 2;
    player.vx = 0; player.vy = 0; player.vz = 0;
    _setSpeedo(_trainV);
  }

  _updateBoardBtn();
}

// ── 上车 / 下车 ────────────────────────────────────────────────────────────────
function _canBoard() {
  if (!_trainReady || _trainState !== 'dwell') return false;
  if (Math.abs(player.z - (RAIL_Z + 0.5)) > 7) return false;
  var frontX = _trainX;
  var backX  = _trainX - _trainDir * (_trainCars.length - 1) * _carSpacing;
  var lo = Math.min(frontX, backX) - 4, hi = Math.max(frontX, backX) + 4;
  return player.x >= lo && player.x <= hi;
}

function boardTrain() {
  if (_onTrain || !_canBoard()) return;
  _onTrain = true;
  if (typeof viewFP !== 'undefined' && viewFP && typeof toggleView === 'function') toggleView();
  if (typeof _setWalkUI === 'function') _setWalkUI(false);
  var sp = document.getElementById('speedo'); if (sp) sp.classList.add('on');
  // 玩家瞬移到座位（虽近，仍重置相机枢轴避免镜头滑移）
  if (typeof _pivInit !== 'undefined') _pivInit = false;
  if (typeof _camDcur !== 'undefined') _camDcur = CAM_DIST;
  _updateBoardBtn();
}

function exitTrain() {
  if (!_onTrain) return;
  _onTrain = false;
  player.x = _trainX;
  player.z = RAIL_Z + 4;        // 下到 +Z 侧月台
  player.y = RAIL_TOP;
  player.vx = 0; player.vy = 0; player.vz = 0;
  if (typeof _setWalkUI === 'function') _setWalkUI(true);
  var sp = document.getElementById('speedo'); if (sp) sp.classList.remove('on');
  if (typeof _camDcur !== 'undefined') _camDcur = CAM_DIST;
  if (typeof _pivInit !== 'undefined') _pivInit = false;
  _updateBoardBtn();
}

function _setSpeedo(v) {
  var el = document.getElementById('speedo-val');
  if (el) el.textContent = Math.round(v * 6);   // 与汽车速度表同一标度
}

// ── 上/下车按钮（自管 DOM，内联样式，避免改 template.html）────────────────────
function _buildTrainBoardBtn() {
  if (_trainBoardBtn) return;
  var b = document.createElement('div');
  b.id = 'train-board';
  b.style.cssText = 'position:fixed;left:50%;bottom:170px;transform:translateX(-50%);z-index:60;'
    + 'padding:10px 22px;border-radius:24px;background:rgba(20,120,200,0.92);color:#fff;'
    + 'font-size:18px;font-weight:bold;box-shadow:0 3px 10px rgba(0,0,0,0.4);display:none;'
    + 'border:2px solid #fff;touch-action:none;-webkit-user-select:none;user-select:none';
  function toggle(e) { e.preventDefault(); if (_onTrain) exitTrain(); else boardTrain(); }
  b.addEventListener('touchstart', toggle, { passive: false });
  b.addEventListener('click', toggle);
  document.body.appendChild(b);
  _trainBoardBtn = b;
}

function _updateBoardBtn() {
  if (!_trainBoardBtn) return;
  if (_onTrain) {
    _trainBoardBtn.textContent = '🚄 下车';
    _trainBoardBtn.style.display = 'block';
  } else if (_canBoard()) {
    _trainBoardBtn.textContent = '🚄 上车';
    _trainBoardBtn.style.display = 'block';
  } else {
    _trainBoardBtn.style.display = 'none';
  }
}
