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
var _trainMixers  = [];   // AnimationMixer per car

// ── 初始化（game.js boot step 9 调用）────────────────────────────────────────
function initTrain() {
  if (typeof gltfLoader === 'undefined') return;
  _buildBoardBtn();
  _buildStations();
  _buildViaduct();

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

  // 高雄轻轨：两节独立 load 确保 animations 绑定正确
  gltfLoader.load('assets/models/train/kaohsiung_lightrail.glb', function (gf) {
    _addCar(gf.scene, true, gf.animations);
    gltfLoader.load('assets/models/train/kaohsiung_lightrail.glb', function (gw) {
      _addCar(gw.scene, false, gw.animations);
      _trainReady = true;
    }, undefined, function () { _trainReady = true; });
  }, undefined, function () { _trainReady = true; });
}

var _TARGET_CAR_LEN = 10; // 每节车厢缩放目标长度（game units）

// 单节车厢：长轴对齐 Z，缩放到目标长度，脚底落轨面，播放内置动画
function _addCar(model, isFront, clips) {
  model.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(model);
  var dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;

  // 长轴若是 X 则旋转 90° 使长轴变 Z
  model.rotation.y = (dx > dz) ? Math.PI / 2 : 0;
  model.updateMatrixWorld(true);
  bb.setFromObject(model);

  // 缩放到目标长度
  var rawLen = bb.max.z - bb.min.z;
  if (rawLen > 0.1) {
    var s = _TARGET_CAR_LEN / rawLen;
    model.scale.multiplyScalar(s);
    model.updateMatrixWorld(true);
    bb.setFromObject(model);
  }

  // 横向/纵向居中，脚底归零
  model.position.x -= (bb.min.x + bb.max.x) / 2;
  model.position.z -= (bb.min.z + bb.max.z) / 2;
  model.position.y  = RAIL_TOP - bb.min.y;

  var carLen = bb.max.z - bb.min.z;
  if (carLen + 1 > _carSpacing) _carSpacing = carLen + 1;

  // 播放所有内置动画（保留原速度循环）
  if (clips && clips.length > 0) {
    var mixer = new THREE.AnimationMixer(model);
    for (var ci = 0; ci < clips.length; ci++) {
      mixer.clipAction(clips[ci]).play();
    }
    _trainMixers.push(mixer);
  }

  var grp = new THREE.Group();
  grp.add(model);
  scene.add(grp);
  _trainCars.push({ group: grp });
}

// 两端车站（Three.js 几何体）
function _buildStations() {
  var stations = [
    { z: RAIL_Z0 + TRAIN_MARGIN },
    { z: RAIL_Z1 - TRAIN_MARGIN }
  ];
  for (var s = 0; s < stations.length; s++) {
    var sz = stations[s].z;
    var platMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
    var postMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    var roofMat = new THREE.MeshLambertMaterial({ color: 0x4a7ab5 });
    var lineMat = new THREE.MeshLambertMaterial({ color: 0xf0c020 });

    // 月台板（4宽 × 20长）
    var plat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 20), platMat);
    plat.position.set(RAIL_X - 2.5, RAIL_TOP + 0.125, sz);
    scene.add(plat);

    // 安全黄线（紧靠轨道边缘）
    var line = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 20), lineMat);
    line.position.set(RAIL_X - 0.6, RAIL_TOP + 0.28, sz);
    scene.add(line);

    // 遮棚立柱（6根：Z 方向每 8 格两根）
    var pz, px;
    for (pz = sz - 8; pz <= sz + 8; pz += 8) {
      for (px = 0; px < 2; px++) {
        var pc = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 0.25), postMat);
        pc.position.set(RAIL_X - 1.2 - px * 2.4, RAIL_TOP + 1.85, pz);
        scene.add(pc);
      }
    }

    // 顶棚
    var roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 19.5), roofMat);
    roof.position.set(RAIL_X - 2.5, RAIL_TOP + 3.375, sz);
    scene.add(roof);
  }
}

// ── 每帧主循环（game.js 每帧无条件调用）─────────────────────────────────────
function updateTrain(dt) {
  if (!_trainReady) { _updateBoardBtn(); return; }

  // 推进动画
  for (var mi = 0; mi < _trainMixers.length; mi++) _trainMixers[mi].update(dt);

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

// ── 高架桥（轨道侧边护墙 + 桥墩帽，跳过两端站台区域）────────────────────────
// RAIL_TOP=15 = 地面顶面高度（terrain block y=14 占 world y=14~15）
// 护墙从 y=RAIL_TOP 向上延伸，确保在地面以上可见
function _buildViaduct() {
  var wallMat = new THREE.MeshLambertMaterial({ color: 0xd4d0cc }); // 混凝土灰
  var capMat  = new THREE.MeshLambertMaterial({ color: 0xa8a4a0 }); // 深灰桥墩帽
  var northZ  = RAIL_Z0 + TRAIN_MARGIN + 16;  // 跳过北端站台
  var southZ  = RAIL_Z1 - TRAIN_MARGIN - 16;  // 跳过南端站台
  var midZ    = (northZ + southZ) / 2;
  var segLen  = southZ - northZ;

  // 左侧护墙（x = RAIL_X - 0.6，轨道左侧紧贴）
  var bL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, segLen), wallMat);
  bL.position.set(RAIL_X - 0.6, RAIL_TOP + 0.7, midZ);
  scene.add(bL);

  // 右侧护墙（x = RAIL_X + 1.6，轨道右侧紧贴）
  var bR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, segLen), wallMat);
  bR.position.set(RAIL_X + 1.6, RAIL_TOP + 0.7, midZ);
  scene.add(bR);

  // 桥墩帽块：每 12 格一组，突出于护墙顶部
  for (var vz = northZ + 6; vz < southZ; vz += 12) {
    var cL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 1.6), capMat);
    cL.position.set(RAIL_X - 0.65, RAIL_TOP + 1.625, vz);
    scene.add(cL);
    var cR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 1.6), capMat);
    cR.position.set(RAIL_X + 1.65, RAIL_TOP + 1.625, vz);
    scene.add(cR);
  }
}
