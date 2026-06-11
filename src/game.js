// ─── game.js ──────────────────────────────────────────────────────────────────
// 核心游戏逻辑：玩家状态、3D 角色模型、第三人称摄像机、区块流、主循环、启动序列。
//
// 第三人称摄像机：
//   位置 = 玩家背后 CAM_DIST 单位 + 上方 CAM_H 单位（随 pitch 倾斜）
//   带指数平滑，避免镜头抖动；lookAt 目标为玩家眼部位置。
//
// 玩家模型（MeshLambertMaterial，响应场景灯光）：
//   头 / 躯干 / 左右臂 / 左右腿（带旋转枢纽组，实现行走摆腿动画）
//
// 长按交互：
//   breakHeld/placeHeld 由 controls.js 维护，
//   game.js 用冷却计时器（BREAK_CD/PLACE_CD 秒）节流，实现持续挖/放。

window._step = 3;
setProgress(10, '初始化世界...');

// ── 玩家状态 ───────────────────────────────────────────────────────────────────
var player = {
  x: 8, y: SEA + AMP + 4, z: 8,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  onGround: false, flying: false,
  jumpQ: false, breakQ: false, placeQ: false,
  slot: 0,
  inv: [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, WATER]
};

window._step = 4;

// ── 玩家 3D 模型 ───────────────────────────────────────────────────────────────
var _mSkin = new THREE.MeshLambertMaterial({ color: 0xf5c592 }); // 肤色
var _mBody = new THREE.MeshLambertMaterial({ color: 0x3a6adc }); // 蓝色上衣
var _mPant = new THREE.MeshLambertMaterial({ color: 0x2b3a54 }); // 深蓝裤子

var playerGroup = new THREE.Group();

// 头部
var _head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), _mSkin);
_head.position.set(0, 1.45, 0);
playerGroup.add(_head);

// 躯干
var _torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.3), _mBody);
_torso.position.set(0, 0.95, 0);
playerGroup.add(_torso);

// 左臂（自然悬垂，随行走轻微摆动）
var _armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.65, 0.25), _mSkin);
_armL.position.set(-0.42, 0.975, 0);
playerGroup.add(_armL);

// 右臂
var _armR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.65, 0.25), _mSkin);
_armR.position.set(0.42, 0.975, 0);
playerGroup.add(_armR);

// 左腿（带枢纽组，枢纽在臀部，子 Mesh 向下偏移）
var _legLG = new THREE.Group();
_legLG.position.set(-0.18, 0.575, 0);
var _legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), _mPant);
_legL.position.set(0, -0.375, 0);
_legLG.add(_legL);
playerGroup.add(_legLG);

// 右腿
var _legRG = new THREE.Group();
_legRG.position.set(0.18, 0.575, 0);
var _legR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), _mPant);
_legR.position.set(0, -0.375, 0);
_legRG.add(_legR);
playerGroup.add(_legRG);

scene.add(playerGroup);

// ── 第三人称摄像机状态 ─────────────────────────────────────────────────────────
var CAM_DIST = 4.5;   // 摄像机到玩家的水平距离
var CAM_H    = 2.0;   // 摄像机基础高度（玩家脚底以上）
var _camX = player.x, _camY = player.y + CAM_H, _camZ = player.z + CAM_DIST;

// ── 长按交互冷却 ───────────────────────────────────────────────────────────────
var BREAK_CD = 0.22;  // 秒，连续破坏间隔
var PLACE_CD = 0.30;  // 秒，连续放置间隔
var _lastBreak = 0, _lastPlace = 0;

// ── 区块流加载 ─────────────────────────────────────────────────────────────────
var lastCX = null, lastCZ = null, RDIST = 3;

function updateChunks() {
  var cx = Math.floor(player.x / CHUNK_W);
  var cz = Math.floor(player.z / CHUNK_D);
  if (cx === lastCX && cz === lastCZ) return;
  lastCX = cx; lastCZ = cz;

  var dx, dz, keys, k, p2, kcx, kcz;
  // 先创建缺失区块数据，再重建网格（两遍：确保邻居数据先就位再建面）
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) { createChunk(cx + dx, cz + dz); }
  }
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) { rebuildChunk(cx + dx, cz + dz); }
  }
  // 卸载超出范围的区块（RDIST+1 缓冲防止边界频繁抖动）
  keys = Object.keys(chunks);
  for (k = 0; k < keys.length; k++) {
    p2  = keys[k].split(',');
    kcx = +p2[0]; kcz = +p2[1];
    if (Math.abs(kcx - cx) > RDIST + 1 || Math.abs(kcz - cz) > RDIST + 1) {
      removeChunk(kcx, kcz);
    }
  }
}

// ── 主循环 ─────────────────────────────────────────────────────────────────────
var lastT = 0;

function tick(now) {
  requestAnimationFrame(tick);
  var dt = Math.min((now - lastT) * 0.001, 0.05);
  lastT = now;

  // ── 移动 ───────────────────────────────────────────────────────────────────
  var sy  = Math.sin(player.yaw), cy2 = Math.cos(player.yaw);
  var jx  = joy.dx / JOY_R, jy = joy.dy / JOY_R;
  var spd = player.flying ? FLY_SPD : MOVE_SPD;
  // 摇杆上（jy<0）→ 沿视线水平方向前进，右（jx>0）→ 向右侧移
  player.vx = (jy * sy  + jx *  cy2) * spd;
  player.vz = (jy * cy2 + jx * (-sy)) * spd;

  if (player.flying) {
    player.vy *= 0.85;
  } else {
    player.vy -= GRAVITY * dt;
    if (player.jumpQ && player.onGround) player.vy = JUMP_V;
  }
  player.jumpQ    = false;
  player.onGround = false;

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.z += player.vz * dt;
  resolveAABB();

  // ── 破坏（单次 + 长按节流）─────────────────────────────────────────────────
  var nowS = now * 0.001;
  if (player.breakQ || (breakHeld && nowS - _lastBreak > BREAK_CD)) {
    player.breakQ = false;
    var hitB = raycast(6);
    if (hitB) { setBlock(hitB.x, hitB.y, hitB.z, AIR); _lastBreak = nowS; }
  }

  // ── 放置（单次 + 长按节流）─────────────────────────────────────────────────
  if (player.placeQ || (placeHeld && nowS - _lastPlace > PLACE_CD)) {
    player.placeQ = false;
    var hitP = raycast(6);
    if (hitP && hitP.prev) {
      var pv  = hitP.prev;
      var ppx = Math.floor(player.x), ppy = Math.floor(player.y), ppz = Math.floor(player.z);
      // 防止放在玩家自身两格高度内卡死
      if (!(pv.x === ppx && (pv.y === ppy || pv.y === ppy + 1) && pv.z === ppz)) {
        setBlock(pv.x, pv.y, pv.z, player.inv[player.slot]);
        _lastPlace = nowS;
      }
    }
  }

  // ── 坐标显示 ───────────────────────────────────────────────────────────────
  if (coordEl) {
    coordEl.textContent =
      'X:' + Math.floor(player.x) + ' Y:' + Math.floor(player.y) + ' Z:' + Math.floor(player.z);
  }

  // ── 区块流 ─────────────────────────────────────────────────────────────────
  updateChunks();

  // ── 玩家模型 ───────────────────────────────────────────────────────────────
  playerGroup.position.set(player.x, player.y, player.z);
  playerGroup.rotation.y = player.yaw;

  // 行走摆腿动画（速度归一化后缩放摆幅）
  var moveMag = Math.min(1, Math.sqrt(player.vx * player.vx + player.vz * player.vz) / MOVE_SPD);
  var swing   = Math.sin(now * 0.005) * 0.65 * moveMag;
  _legLG.rotation.x =  swing;
  _legRG.rotation.x = -swing;
  _armL.position.z  =  Math.sin(now * 0.005) * 0.12 * moveMag;
  _armR.position.z  = -Math.sin(now * 0.005) * 0.12 * moveMag;

  // ── 第三人称摄像机 ─────────────────────────────────────────────────────────
  // 摄像机绕玩家旋转：水平角=yaw，俯仰角受 pitch 影响但做限幅
  var camP  = Math.max(-0.15, Math.min(0.65, player.pitch));
  var camTX = player.x + Math.sin(player.yaw) * Math.cos(camP) * CAM_DIST;
  var camTZ = player.z + Math.cos(player.yaw) * Math.cos(camP) * CAM_DIST;
  var camTY = Math.max(player.y + 0.4, player.y + CAM_H - Math.sin(camP) * CAM_DIST);

  // 指数平滑（15 Hz 半衰期），消除抖动
  var lf = Math.min(1, 15 * dt);
  _camX += (camTX - _camX) * lf;
  _camY += (camTY - _camY) * lf;
  _camZ += (camTZ - _camZ) * lf;

  camera.position.set(_camX, _camY, _camZ);
  camera.lookAt(player.x, player.y + PH * 0.6, player.z);

  renderer.render(scene, camera);
}

// ── 开始游戏 ───────────────────────────────────────────────────────────────────
window.startGame = function () {
  if (menuEl) menuEl.style.display = 'none';
  if (uiEl)   uiEl.style.display   = 'block';
  buildHotbar();
  lastT = performance.now();
  requestAnimationFrame(tick);
};

// ── 启动序列（分帧生成初始地形，避免白屏卡顿）─────────────────────────────────
var bootSX, bootSZ, bootStep = 0;

function bootNext() {
  try {
    if (bootStep === 0) {
      setProgress(10, '测试渲染器...');
      renderer.render(scene, camera);
      bootSX = Math.floor(player.x / CHUNK_W);
      bootSZ = Math.floor(player.z / CHUNK_D);
      bootStep = 1; requestAnimationFrame(bootNext);

    } else if (bootStep === 1) {
      setProgress(25, '生成地形...');
      var dx1, dz1;
      for (dx1 = -2; dx1 <= 2; dx1++) {
        for (dz1 = -2; dz1 <= 2; dz1++) { createChunk(bootSX + dx1, bootSZ + dz1); }
      }
      bootStep = 2; requestAnimationFrame(bootNext);

    } else if (bootStep >= 2 && bootStep <= 6) {
      // 每帧构建一列（5 个）区块的网格，共 5 帧
      var col = bootStep - 4, dz2;
      for (dz2 = -2; dz2 <= 2; dz2++) { rebuildChunk(bootSX + col, bootSZ + dz2); }
      setProgress(40 + (bootStep - 2) * 12, '构建地形 ' + (bootStep - 1) + '/5...');
      bootStep++; requestAnimationFrame(bootNext);

    } else if (bootStep === 7) {
      setProgress(92, '定位出生点...');
      var y;
      for (y = CHUNK_H - 1; y >= 0; y--) {
        if (getBlock(Math.floor(player.x), y, Math.floor(player.z)) !== AIR) {
          player.y = y + 1;
          break;
        }
      }
      // 初始化摄像机平滑坐标到实际出生位置，防止首帧跳变
      _camX = player.x + Math.sin(player.yaw) * CAM_DIST;
      _camY = player.y + CAM_H;
      _camZ = player.z + Math.cos(player.yaw) * CAM_DIST;
      bootStep = 8; requestAnimationFrame(bootNext);

    } else {
      setProgress(100, '完成!');
      if (loadEl) loadEl.style.display = 'none';
      if (menuEl) menuEl.style.display = 'flex';
    }
  } catch (e) {
    setProgress(0, '错误: ' + (e.message || String(e)));
    if (loadFill) { loadFill.style.width = '100%'; loadFill.style.background = '#f44'; }
  }
}

requestAnimationFrame(bootNext);
