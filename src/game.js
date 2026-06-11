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

// ── 第三人称摄像机 ─────────────────────────────────────────────────────────────
// 正版 MC 模型：相机在「眼睛沿视线反方向」CAM_DIST 处，朝向与玩家视线一致（刚性，
// 无平滑、无 lookAt 低点）→ 屏幕中心点恒等于挖掘射线落点。
// 相机碰撞：从眼睛向后步进检测，撞到实心方块就缩短距离（原版同款行为）。
var CAM_DIST = 4.0;   // 原版第三人称默认 4 格

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

  // ── 第三人称摄像机（正版 MC 模型）────────────────────────────────────────────
  // 视线方向 forward = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))
  // 相机位置 = 眼睛 - forward × dist（dist 经碰撞检测缩短）
  // 相机朝向 = 玩家视线朝向（YXZ 欧拉直接赋值）→ 与挖掘射线严格共线
  var cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  var fwx = -Math.sin(player.yaw) * cp;
  var fwy = sp;
  var fwz = -Math.cos(player.yaw) * cp;
  var eyeX = player.x, eyeY = player.y + PH * 0.85, eyeZ = player.z;

  // 相机碰撞：从眼睛向后 0.1 步进，撞到实心方块就停在前 0.3 处
  var camD = CAM_DIST, cd, cbx, cby, cbz, cid;
  for (cd = 0.1; cd <= CAM_DIST; cd += 0.1) {
    cbx = Math.floor(eyeX - fwx * cd);
    cby = Math.floor(eyeY - fwy * cd);
    cbz = Math.floor(eyeZ - fwz * cd);
    cid = getBlock(cbx, cby, cbz);
    if (cid !== AIR && cid !== WATER) { camD = Math.max(0.5, cd - 0.3); break; }
  }

  camera.position.set(eyeX - fwx * camD, eyeY - fwy * camD, eyeZ - fwz * camD);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;

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
