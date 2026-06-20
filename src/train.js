// ─── train.js ─────────────────────────────────────────────────────────────────
// 高铁系统：固定纵向轨道（城堡南门旁 → 道路尽头）+ 自动往返列车 + 上/下车
//
//   轨道沿 Z 轴，固定 X=RAIL_X，从 Z=RAIL_Z0（城堡站）到 Z=RAIL_Z1（南站）。
//   轨道床（STONE）由 world.js genTerrain 的 _rail 条件永久烤入地图。
//   列车（车头 + 2 节车厢）自动在两端车站之间往返，到站停靠 TRAIN_DWELL 秒。
//   玩家靠近停靠的列车时出现「🚄 上车」按钮，乘坐时跟随列车移动。
//
//   模型：Quaternius Modular Train Pack（CC0），assets/models/train/
//   对外全局：_onTrain（game.js 移动段读取，乘车时跳过行走物理）

var RAIL_X      = 12;    // 轨道固定 X（道路 wx∈[-3,8] 右侧，与道路平行）
var RAIL_Z0     =  40;   // 北端起点（城堡南门外约 25 格，避免穿城堡）
var RAIL_Z1     = 196;   // 南端终点（道路尽头车站中心 Z）
var RAIL_TOP    = SEA + 3; // 轨面站立高度（轨道床顶面 y=SEA+2，+1 为地板上方）
var TRAIN_CRUISE = 20;   // 巡航速度 u/s
var TRAIN_ACCEL  =  6;   // 加速度 u/s²
var TRAIN_DECEL  =  8;   // 减速度 u/s²
var TRAIN_DWELL  =  5;   // 到站停靠秒数
var TRAIN_MARGIN = 10;   // 端点留白（站台范围内停车）

// ── 运行状态 ───────────────────────────────────────────────────────────────────
var _onTrain    = false;   // 玩家是否在车上（game.js 读取）
var _trainReady = false;   // 模型是否就绪
var _trainCars  = [];      // [{ group }]，index 0 = 车头
var _carSpacing = 7;       // 车厢中心间距（模型载入后按实际长度更新）
var _trainZ     = RAIL_Z0 + TRAIN_MARGIN;  // 车头当前 Z
var _trainV     = 0;       // 当前速度 u/s（正值=朝 +Z）
var _trainDir   = 1;       // +1 朝南（+Z），-1 朝北（-Z）
var _trainState = 'dwell'; // 'dwell' | 'run'
var _trainDwellT = TRAIN_DWELL;
var _trainBoardBtn = null;

// ── 初始化（game.js boot step 9 调用）────────────────────────────────────────
function initTrain() {
  if (typeof gltfLoader === 'undefined') return;
  _buildBoardBtn();
  _buildStations();

  // 沿 Z 轴铺轨道瓦片
  gltfLoader.load('assets/models/train/rail_straight.glb', function (g) {
    var proto = g.scene;
    proto.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(proto);
    var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
    // 轨道需要长轴沿 Z；若模型长轴是 X 则旋转 90°
    var rotY = (dx > dz) ? Math.PI / 2 : 0;
    var segLen = Math.max(dx, dz);
    if (!(segLen > 0.3)) segLen = 2;
    var yOff = RAIL_TOP - bb.min.y;
    var n = Math.ceil((RAIL_Z1 - RAIL_Z0) / segLen) + 2;
    for (var i = 0; i < n; i++) {
      var tile = proto.clone(true);
      tile.rotation.y = rotY;
      tile.position.set(RAIL_X + 0.5, yOff, RAIL_Z0 + i * segLen + segLen / 2);
      scene.add(tile);
    }
  }, undefined, function () {});

  // 车头 + 2 节车厢
  gltfLoader.load('assets/models/train/highspeed_front.glb', function (gf) {
    _addCar(gf.scene, true);
    gltfLoader.load('assets/models/train/highspeed_wagon.glb', function (gw) {
      _addCar(gw.scene.clone(true), false);
      _addCar(gw.scene.clone(true), false);
      _trainReady = true;
    }, undefined, function () { _trainReady = true; });
  }, undefined, function () {});
}

// 单节车厢：让长轴对齐 Z 轴，脚底落到轨面
function _addCar(model, isFront) {
  model.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(model);
  var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
  // 长轴若是 X 则旋转 90° 使长轴变 Z
  model.rotation.y = (dx > dz) ? Math.PI / 2 : 0;
  model.updateMatrixWorld(true);
  bb.setFromObject(model);
  // 横向/纵向居中到 group 原点，脚底归零
  model.position.x -= (bb.min.x + bb.max.x) / 2;
  model.position.z -= (bb.min.z + bb.max.z) / 2;
  model.position.y  = RAIL_TOP - bb.min.y;

  var carLen = Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x);
  var carW   = bb.max.x - bb.min.x;
  if (carLen + 0.8 > _carSpacing) _carSpacing = carLen + 0.8;

  // 白色高铁涂装；跳过透明材质（保留原模型玻璃/窗户）
  model.traverse(function(node) {
    if (!node.isMesh) return;
    var mat = Array.isArray(node.material) ? node.material[0] : node.material;
    if (mat && (mat.transparent || (mat.opacity !== undefined && mat.opacity < 0.9))) return;
    node.material = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  });

  var grp = new THREE.Group();
  grp.add(model);

  // 蓝色半透明车窗（DoubleSide：从外可见蓝色玻璃，从内可看窗外）
  var winMat = new THREE.MeshLambertMaterial({ color: 0x88bbdd, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  var nWin = Math.max(2, Math.floor(carLen / 2));
  var halfW = Math.max(carW / 2, 0.8);
  var wi, wz, wSide;
  for (wi = 0; wi < nWin; wi++) {
    wz = -carLen / 2 + 1.5 + wi * (carLen - 2.0) / nWin;
    for (wSide = -1; wSide <= 1; wSide += 2) {
      var winMesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 1.0), winMat);
      winMesh.position.set(wSide * halfW, RAIL_TOP + 1.1, wz);
      grp.add(winMesh);
    }
  }

  scene.add(grp);
  _trainCars.push({ group: grp });
}

// 两端车站（Three.js 几何体，不依赖区块）
function _buildStations() {
  var stations = [
    { z: RAIL_Z0 + TRAIN_MARGIN, label: '城堡站' },
    { z: RAIL_Z1 - TRAIN_MARGIN, label: '南端站' }
  ];
  for (var s = 0; s < stations.length; s++) {
    var sz = stations[s].z;
    // 月台板（靠道路一侧，X 偏左）
    var plat = new THREE.Mesh(
      new THREE.BoxGeometry(3, 0.2, 14),
      new THREE.MeshLambertMaterial({ color: 0xbfb39a })
    );
    plat.position.set(RAIL_X - 2.5, RAIL_TOP + 0.1, sz);
    scene.add(plat);
    // 遮棚立柱
    var postMat = new THREE.MeshLambertMaterial({ color: 0x6b4f33 });
    var posts = [
      [RAIL_X - 1.5, sz - 6], [RAIL_X - 3.5, sz - 6],
      [RAIL_X - 1.5, sz + 6], [RAIL_X - 3.5, sz + 6]
    ];
    for (var i = 0; i < posts.length; i++) {
      var p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), postMat);
      p.position.set(posts[i][0], RAIL_TOP + 1.5, posts[i][1]);
      scene.add(p);
    }
    // 顶棚
    var roof = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 0.3, 13.5),
      new THREE.MeshLambertMaterial({ color: 0x3b6ea5 })
    );
    roof.position.set(RAIL_X - 2.5, RAIL_TOP + 3.1, sz);
    scene.add(roof);
  }
}

// ── 每帧主循环（game.js 每帧无条件调用）─────────────────────────────────────
function updateTrain(dt) {
  if (!_trainReady) { _updateBoardBtn(); return; }

  // 状态机：停靠倒计时 / 加速巡航减速进站
  if (_trainState === 'dwell') {
    _trainV = 0;
    _trainDwellT -= dt;
    if (_trainDwellT <= 0) _trainState = 'run';
  } else {
    var endZ   = (_trainDir > 0) ? (RAIL_Z1 - TRAIN_MARGIN) : (RAIL_Z0 + TRAIN_MARGIN);
    var remain = (endZ - _trainZ) * _trainDir;
    var stopD  = (_trainV * _trainV) / (2 * TRAIN_DECEL);
    if (remain <= stopD) {
      _trainV -= TRAIN_DECEL * dt;
      if (_trainV < 0) _trainV = 0;
    } else {
      _trainV += TRAIN_ACCEL * dt;
      if (_trainV > TRAIN_CRUISE) _trainV = TRAIN_CRUISE;
    }
    _trainZ += _trainDir * _trainV * dt;
    if (remain <= 0.4 && _trainV < 0.6) {
      _trainZ = endZ;
      _trainV = 0;
      _trainDir = -_trainDir;
      _trainState = 'dwell';
      _trainDwellT = TRAIN_DWELL;
    }
  }

  // 同步车身：车头在 _trainZ，车厢向后拖
  for (var i = 0; i < _trainCars.length; i++) {
    var carZ = _trainZ - _trainDir * i * _carSpacing;
    _trainCars[i].group.position.set(RAIL_X + 0.5, 0, carZ);
    // 朝向：+Z 行驶时车头面朝 +Z（yaw=0），-Z 行驶时翻转 180°
    _trainCars[i].group.rotation.y = (_trainDir > 0) ? Math.PI : 0;
  }

  // 乘车：把玩家锁定在车头位置
  if (_onTrain) {
    player.x = RAIL_X + 0.5;
    player.z = _trainZ;
    player.y = RAIL_TOP + 0.5;
    player.yaw = (_trainDir > 0) ? Math.PI : 0;  // 朝向行进方向
    player.vx = 0; player.vy = 0; player.vz = 0;
    // 速度表
    var spv = document.getElementById('speedo-val');
    if (spv) spv.textContent = Math.round(_trainV * 3.6);
  }

  _updateBoardBtn();
}

// ── 上/下车逻辑 ───────────────────────────────────────────────────────────────
function _canBoard() {
  if (!_trainReady || _trainState !== 'dwell') return false;
  var dx = player.x - (RAIL_X + 0.5);
  var dz = player.z - _trainZ;
  return Math.abs(dx) < 6 && Math.abs(dz) < 6;
}

function boardTrain() {
  if (_onTrain || !_canBoard()) return;
  _onTrain = true;
  if (typeof viewFP !== 'undefined' && viewFP && typeof toggleView === 'function') toggleView();
  if (typeof _setWalkUI === 'function') _setWalkUI(false);
  if (typeof _pivInit !== 'undefined') _pivInit = false;
  if (typeof _camDcur !== 'undefined') _camDcur = CAM_DIST;
  var sp = document.getElementById('speedo'); if (sp) sp.classList.add('on');
  _updateBoardBtn();
}

function exitTrain() {
  if (!_onTrain) return;
  _onTrain = false;
  // 下到月台（X 偏左，道路侧）
  player.x = RAIL_X - 3;
  player.z = _trainZ;
  player.y = RAIL_TOP;
  player.vx = 0; player.vy = 0; player.vz = 0;
  if (typeof _setWalkUI === 'function') _setWalkUI(true);
  if (typeof _pivInit !== 'undefined') _pivInit = false;
  if (typeof _camDcur !== 'undefined') _camDcur = CAM_DIST;
  var sp = document.getElementById('speedo'); if (sp) sp.classList.remove('on');
  _updateBoardBtn();
}

// ── 上/下车按钮（自管 DOM，内联样式）────────────────────────────────────────
function _buildBoardBtn() {
  if (_trainBoardBtn) return;
  var b = document.createElement('div');
  b.id = 'train-board';
  b.style.cssText = [
    'position:fixed;left:50%;bottom:170px;transform:translateX(-50%);z-index:60',
    'padding:10px 22px;border-radius:24px;background:rgba(20,120,200,0.92)',
    'color:#fff;font-size:18px;font-weight:bold',
    'box-shadow:0 3px 10px rgba(0,0,0,0.4);display:none',
    'border:2px solid #fff;touch-action:none;-webkit-user-select:none;user-select:none'
  ].join(';');
  function onTap(e) { e.preventDefault(); if (_onTrain) exitTrain(); else boardTrain(); }
  b.addEventListener('touchstart', onTap, { passive: false });
  b.addEventListener('click', onTap);
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
