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

// ── 玩家模型容器 ───────────────────────────────────────────────────────────────
// 启动时放一个简单盒子占位（GLTF 模型异步加载完成后由 models.js 热替换）
var playerGroup = new THREE.Group();

(function () {
  var mat  = new THREE.MeshLambertMaterial({ color: 0x3a6adc });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.6, PH, 0.35), mat);
  body.position.y = PH / 2;
  playerGroup.add(body);
}());

scene.add(playerGroup);

// ── 第一人称手臂 + 镐子 ────────────────────────────────────────────────────────
// 挂在 camera 下（相机空间，跟随视线），仅第一人称可见。
// 破坏/放置时播放挥动动画（绕肩部 X 轴前劈）。
var armGroup = new THREE.Group();
var ARM_BASE_RX = -0.25;   // 手臂静止前倾角
var _swingT = 0;           // 挥动剩余时间（秒）
var SWING_DUR = 0.28;

(function () {
  var skin = new THREE.MeshLambertMaterial({ color: 0xc68863 });
  var wood = new THREE.MeshLambertMaterial({ color: 0x8a5a2b });
  var iron = new THREE.MeshLambertMaterial({ color: 0xc0c0c8 });

  // 手臂：从右下伸向前方
  var arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.46), skin);
  arm.position.set(0, 0, -0.18);
  armGroup.add(arm);

  // 镐柄：竖直握在手前端
  var handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), wood);
  handle.position.set(0, 0.12, -0.42);
  armGroup.add(handle);

  // 镐头：横在柄顶
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.32), iron);
  head.position.set(0, 0.29, -0.42);
  armGroup.add(head);
}());

armGroup.position.set(0.34, -0.32, -0.5);
armGroup.rotation.set(ARM_BASE_RX, -0.1, 0);
armGroup.visible = false;
camera.add(armGroup);
scene.add(camera);   // camera 有子节点时必须加入场景树

// ── 视角切换（第一/第三人称）──────────────────────────────────────────────────
var viewFP = false;

function toggleView() {
  viewFP = !viewFP;
  playerGroup.visible = !viewFP;
  armGroup.visible    = viewFP;
  var xh = document.getElementById('xhair');
  if (xh) xh.classList.toggle('fp', viewFP);
  var b = document.getElementById('b-view');
  if (b) b.classList.toggle('on', viewFP);
}

// ── 第三人称摄像机（吃鸡架构）──────────────────────────────────────────────────
// 设计原则（PUBG 同款）：
//   1. 旋转 1:1 直出 — 朝向每帧由 yaw/pitch 直接生成，绝不平滑（手感根基）
//   2. 平滑的是「枢轴点」— 吸收走路/上台阶的位移噪声，不引入瞄准延迟
//   3. 支臂碰撞「瞬缩缓伸」— 撞墙立刻拉近（防穿模），离开障碍后缓慢恢复
//   4. 沉浸偏移全部加在相机位置上（肩偏/Bob/落地冲击），方向保持平行
//      → 屏幕中心射线 = 玩家眼睛射线右移肩偏量，raycast 同步右移即严格对齐
var CAM_DIST     = 4.0;    // 支臂全长
var CAM_SHOULDER = 0.55;   // 右肩偏移（米）
var _pivX = 0, _pivY = 0, _pivZ = 0, _pivInit = false;  // 平滑枢轴
var _camDcur = CAM_DIST;   // 当前支臂长度（瞬缩缓伸）
var _bobT = 0, _fovCur = 70, _rollCur = 0;              // Bob 计时 / FOV / 侧倾
var _dipY = 0, _dipV = 0;  // 落地冲击弹簧（位移/速度）
var _wasGround = false;

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
  // 斜向限速：摇杆向量长度截断到 1（否则对角线快 41%）
  var jLen = Math.sqrt(jx * jx + jy * jy);
  if (jLen > 1) { jx /= jLen; jy /= jLen; }
  var spd = player.flying ? FLY_SPD : MOVE_SPD;
  // 摇杆上（jy<0）→ 沿视线水平方向前进，右（jx>0）→ 向右侧移
  player.vx = (jy * sy  + jx *  cy2) * spd;
  player.vz = (jy * cy2 + jx * (-sy)) * spd;

  if (player.flying) {
    // 飞行升降：按住跳跃=升，按住下降键=降，松开悬停
    if      (jumpHeld) player.vy = FLY_SPD * 0.75;
    else if (downHeld) player.vy = -FLY_SPD * 0.75;
    else               player.vy *= 0.8;
  } else {
    player.vy -= GRAVITY * dt;
    if (player.jumpQ && player.onGround) player.vy = JUMP_V;
  }
  player.jumpQ    = false;
  player.onGround = false;

  var preVy = player.vy;   // 碰撞前的垂直速度（落地冲击检测用）
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.z += player.vz * dt;
  resolveAABB();

  // 落地冲击：从 >2.5 格高度落地时给相机弹簧一个向下的冲量
  if (!_wasGround && player.onGround && preVy < -12) {
    _dipV = Math.max(-1.5, preVy * 0.05);
  }
  _wasGround = player.onGround;

  // ── 破坏（单次 + 长按节流）─────────────────────────────────────────────────
  var nowS = now * 0.001;
  if (player.breakQ || (breakHeld && nowS - _lastBreak > BREAK_CD)) {
    player.breakQ = false;
    if (_swingT <= 0) _swingT = SWING_DUR;   // 第一人称挥镐动画
    var hitB = raycast(6);
    if (hitB) { setBlock(hitB.x, hitB.y, hitB.z, AIR); _lastBreak = nowS; }
  }

  // ── 放置（单次 + 长按节流）─────────────────────────────────────────────────
  if (player.placeQ || (placeHeld && nowS - _lastPlace > PLACE_CD)) {
    player.placeQ = false;
    if (_swingT <= 0) _swingT = SWING_DUR;
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

  // GLTF 动画状态机：空中（上升=jump/下落=fall）> 移动速度 → run / walk / idle
  var moveMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
  if (playerMixer) {
    if      (!player.onGround && !player.flying && player.vy >  2) playerAnim('jump');
    else if (!player.onGround && !player.flying && player.vy < -4) playerAnim('fall');
    else if (moveMag > FLY_SPD * 0.8) playerAnim('run');
    else if (moveMag > 0.5)           playerAnim('walk');
    else                              playerAnim('idle');
    playerMixer.update(dt);
  }

  // ── NPC 更新 ───────────────────────────────────────────────────────────────
  updateNPCs(dt);

  // ── 第三人称摄像机（吃鸡架构，见 CAM_DIST 处注释）───────────────────────────
  // 视线向量：由 yaw/pitch 直出，与 raycast 公式完全一致（1:1 零延迟）
  var cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  var fwx = -Math.sin(player.yaw) * cp;
  var fwy = sp;
  var fwz = -Math.cos(player.yaw) * cp;
  var rwx = Math.cos(player.yaw), rwz = -Math.sin(player.yaw);  // 水平右向量

  // 枢轴点平滑：水平快（25/s）垂直慢（12/s），上台阶时镜头柔和抬升
  var tPx = player.x, tPy = player.y + PH * 0.8, tPz = player.z;
  if (!_pivInit) { _pivX = tPx; _pivY = tPy; _pivZ = tPz; _pivInit = true; }
  var kH = Math.min(1, 25 * dt), kV = Math.min(1, 12 * dt);
  _pivX += (tPx - _pivX) * kH;
  _pivZ += (tPz - _pivZ) * kH;
  _pivY += (tPy - _pivY) * kV;

  // 落地冲击弹簧（欠阻尼：下沉后带一次微小回弹）
  _dipV += (-_dipY * 90 - _dipV * 12) * dt;
  _dipY += _dipV * dt;

  // Camera Bob：行走时垂直双步频颠簸 + 横向单步频摇摆（纯位置偏移，不点头）
  var bobOn = (player.onGround && moveMag > 0.3) ? 1 : 0;
  if (bobOn) _bobT += dt * moveMag * 1.6;
  var bobY = Math.sin(_bobT * Math.PI * 2) * 0.04 * bobOn;
  var bobL = Math.sin(_bobT * Math.PI)     * 0.03 * bobOn;

  if (viewFP) {
    // ── 第一人称：相机即眼睛，Bob 减半（贴脸晃动更敏感）─────────────────────
    camera.position.set(
      player.x + rwx * bobL * 0.5,
      player.y + PH * 0.85 + bobY * 0.6 + _dipY,
      player.z + rwz * bobL * 0.5
    );
  } else {
    // ── 第三人称：支臂碰撞，从「肩偏后的枢轴」沿 -forward 步进找无遮挡长度 ──
    var shX = _pivX + rwx * CAM_SHOULDER;
    var shY = _pivY;
    var shZ = _pivZ + rwz * CAM_SHOULDER;
    var hitD = CAM_DIST, cd, cid;
    for (cd = 0.2; cd <= CAM_DIST; cd += 0.1) {
      cid = getBlock(
        Math.floor(shX - fwx * cd),
        Math.floor(shY - fwy * cd),
        Math.floor(shZ - fwz * cd)
      );
      if (cid !== AIR && cid !== WATER) { hitD = Math.max(0.4, cd - 0.3); break; }
    }
    // 瞬缩缓伸：撞墙立刻拉近，离开后以 4/s 缓慢恢复全长
    if (hitD < _camDcur) _camDcur = hitD;
    else                 _camDcur += (hitD - _camDcur) * Math.min(1, 4 * dt);

    camera.position.set(
      shX - fwx * _camDcur + rwx * bobL,
      shY - fwy * _camDcur + bobY + _dipY,
      shZ - fwz * _camDcur + rwz * bobL
    );
  }

  // 侧移倾斜：横向移动时镜头反向微滚 ~0.8°，增加动态感
  var tgtRoll = -jx * 0.014;
  _rollCur += (tgtRoll - _rollCur) * Math.min(1, 8 * dt);
  // YXZ 欧拉直接赋值（renderer.js 已设 rotation.order）→ 朝向严格平行视线
  camera.rotation.set(player.pitch, player.yaw, _rollCur);

  // ── 第一人称手臂动画：挥动（前劈）+ 行走微晃 ─────────────────────────────
  if (_swingT > 0) _swingT -= dt;
  if (viewFP) {
    var swP = _swingT > 0 ? Math.sin((1 - _swingT / SWING_DUR) * Math.PI) : 0;
    armGroup.rotation.x = ARM_BASE_RX - swP * 1.0;
    armGroup.position.y = -0.32 + Math.sin(_bobT * Math.PI * 2) * 0.015 * bobOn;
  }

  // FOV 冲刺扩张：地面跑动时 70° → 76°
  var tgFov = (!player.flying && player.onGround && moveMag > MOVE_SPD * 0.8) ? 76 : 70;
  _fovCur += (tgFov - _fovCur) * Math.min(1, 6 * dt);
  if (Math.abs(_fovCur - camera.fov) > 0.05) {
    camera.fov = _fovCur;
    camera.updateProjectionMatrix();
  }

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
      // 步骤 0：异步加载贴图集，完成后进入步骤 1
      setProgress(8, '加载贴图...');
      loadTextures(function () {
        _mat.map = atlasTexture;
        _mat.needsUpdate = true;
        bootStep = 1;
        requestAnimationFrame(bootNext);
      });
      return;  // 等待回调，不推进 rAF

    } else if (bootStep === 1) {
      setProgress(15, '测试渲染器...');
      renderer.render(scene, camera);
      bootSX = Math.floor(player.x / CHUNK_W);
      bootSZ = Math.floor(player.z / CHUNK_D);
      bootStep = 2; requestAnimationFrame(bootNext);

    } else if (bootStep === 2) {
      setProgress(30, '生成地形...');
      var dx1, dz1;
      for (dx1 = -2; dx1 <= 2; dx1++) {
        for (dz1 = -2; dz1 <= 2; dz1++) { createChunk(bootSX + dx1, bootSZ + dz1); }
      }
      bootStep = 3; requestAnimationFrame(bootNext);

    } else if (bootStep >= 3 && bootStep <= 7) {
      // 每帧构建一列（5 个）区块的网格，共 5 帧
      var col = bootStep - 5, dz2;
      for (dz2 = -2; dz2 <= 2; dz2++) { rebuildChunk(bootSX + col, bootSZ + dz2); }
      setProgress(42 + (bootStep - 3) * 12, '构建地形 ' + (bootStep - 2) + '/5...');
      bootStep++; requestAnimationFrame(bootNext);

    } else if (bootStep === 8) {
      setProgress(94, '定位出生点...');
      var y;
      for (y = CHUNK_H - 1; y >= 0; y--) {
        if (getBlock(Math.floor(player.x), y, Math.floor(player.z)) !== AIR) {
          player.y = y + 1;
          break;
        }
      }
      bootStep = 9; requestAnimationFrame(bootNext);

    } else {
      setProgress(100, '完成!');
      if (loadEl) loadEl.style.display = 'none';
      if (menuEl) menuEl.style.display = 'flex';
      // 异步加载 GLTF 模型（不阻塞进入游戏；完成前玩家为盒子占位、无 NPC）
      loadPlayerModel();
      spawnNPCs();
    }
  } catch (e) {
    setProgress(0, '错误: ' + (e.message || String(e)));
    if (loadFill) { loadFill.style.width = '100%'; loadFill.style.background = '#f44'; }
  }
}

requestAnimationFrame(bootNext);
