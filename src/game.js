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
  inv: [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, RED_WALL, GOLD_ROOF, WHITE_STONE, GRAY_BRICK, GRAY_ROOF, RED_PILLAR, PLANKS, COBBLE, MUD_BRICK, TERRITORY_STONE, ICE, SNOW, IRON_ORE, GLASS, OBSIDIAN, GRAVEL, RED_SAND, TNT, PUMPKIN, COAL_ORE, TOWER_ITEM]
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

// ── 第一人称双手臂系统 ────────────────────────────────────────────────────────
// 右臂（armGroup）  持当前热键栏方块的迷你立方体，破坏时播前劈动画
// 左臂（armGroupL） 空手，走路时与右臂反相摆动
// 两组均挂在 camera 下（相机空间），仅第一人称可见
var armGroup  = new THREE.Group();   // 右臂
var armGroupL = new THREE.Group();   // 左臂
var ARM_BASE_RX = -0.25;
var _swingT = 0, SWING_DUR = 0.28;

// 手持物料（贴图就绪后填入 atlasTexture）
var _handItemMat  = new THREE.MeshBasicMaterial({ map: null });
var _handItemMesh = null;   // 当前手持方块网格
var _handSlotLast = -1;

// UV 工具：把 Steve 皮肤（64×64）上的像素矩形映射到 BoxGeometry 某面
function _setFaceUV(geo, face, px, py, pw, phh) {
  var uv = geo.attributes.uv;
  var u0 = px / 64, u1 = (px + pw) / 64;
  var v1 = 1 - py / 64, v0 = 1 - (py + phh) / 64;
  var o  = face * 4;
  uv.setXY(o,   u0, v1); uv.setXY(o+1, u1, v1);
  uv.setXY(o+2, u0, v0); uv.setXY(o+3, u1, v0);
  uv.needsUpdate = true;
}

// 手持方块迷你立方体（UV 取自贴图集，与地形共用 atlasTexture）
function _makeHandCube(blockId) {
  var tex = BTEX[blockId];
  if (!tex) return null;
  var geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  var uv  = geo.attributes.uv;
  // face 顺序：+X,-X,+Y,-Y,+Z,-Z → side,side,top,bot,side,side
  var fMap = [tex[1], tex[1], tex[0], tex[2], tex[1], tex[1]];
  for (var f = 0; f < 6; f++) {
    var ti = fMap[f];
    var tc = ti % ATLAS_COLS, tr = (ti / ATLAS_COLS) | 0;
    var u0 = tc / ATLAS_COLS + _UV_EPS_U, u1 = (tc+1) / ATLAS_COLS - _UV_EPS_U;
    var v0 = 1 - (tr+1) / ATLAS_ROWS + _UV_EPS_V, v1 = 1 - tr / ATLAS_ROWS - _UV_EPS_V;
    var o  = f * 4;
    uv.setXY(o, u0, v1); uv.setXY(o+1, u1, v1);
    uv.setXY(o+2, u0, v0); uv.setXY(o+3, u1, v0);
  }
  uv.needsUpdate = true;
  return new THREE.Mesh(geo, _handItemMat);
}

// 切换手持物（slot 变化或贴图加载完成时调用）
function _updateHeldItem(slot) {
  if (_handItemMesh) { armGroup.remove(_handItemMesh); _handItemMesh = null; }
  var cube = _makeHandCube(player.inv[slot]);
  if (cube) {
    // MC 经典握法：方块在手端前方，轻微旋转露出三个面
    cube.position.set(0.04, -0.14, -0.52);
    cube.rotation.set(0.35, 0.75, 0.18);
    armGroup.add(cube);
    _handItemMesh = cube;
  }
}

(function () {
  var skinTex = new THREE.TextureLoader().load('assets/textures/entity/steve.png');
  skinTex.magFilter = THREE.NearestFilter;
  skinTex.minFilter = THREE.NearestFilter;
  var skin = new THREE.MeshLambertMaterial({ map: skinTex });

  // ── 右臂 ── Steve 皮肤右臂区域（经典 64×64 布局）
  // 面序：+X外,−X内,+Y肩顶,−Y手底,+Z前,−Z后
  var rGeo = new THREE.BoxGeometry(0.125, 0.42, 0.125);
  _setFaceUV(rGeo, 0, 40, 20, 4, 12);
  _setFaceUV(rGeo, 1, 48, 20, 4, 12);
  _setFaceUV(rGeo, 2, 44, 16, 4,  4);
  _setFaceUV(rGeo, 3, 48, 16, 4,  4);
  _setFaceUV(rGeo, 4, 44, 20, 4, 12);
  _setFaceUV(rGeo, 5, 52, 20, 4, 12);
  var rArm = new THREE.Mesh(rGeo, skin);
  rArm.rotation.x = Math.PI / 2;
  rArm.position.set(0, 0, -0.16);
  armGroup.add(rArm);

  // ── 左臂 ── Steve 皮肤左臂区域（1.8+ 64×64 下半部分 32-48, 48-64）
  var lGeo = new THREE.BoxGeometry(0.125, 0.42, 0.125);
  _setFaceUV(lGeo, 0, 40, 52, 4, 12);  // +X 内
  _setFaceUV(lGeo, 1, 32, 52, 4, 12);  // −X 外
  _setFaceUV(lGeo, 2, 36, 48, 4,  4);  // +Y 肩顶
  _setFaceUV(lGeo, 3, 40, 48, 4,  4);  // −Y 手底
  _setFaceUV(lGeo, 4, 36, 52, 4, 12);  // +Z 前
  _setFaceUV(lGeo, 5, 44, 52, 4, 12);  // −Z 后
  var lArm = new THREE.Mesh(lGeo, skin);
  lArm.rotation.x = Math.PI / 2;
  lArm.position.set(0, 0, -0.16);
  armGroupL.add(lArm);
}());

// 右臂：右下方，前倾，内旋
armGroup.position.set( 0.30, -0.28, -0.45);
armGroup.rotation.set(ARM_BASE_RX,  0.08,  0.10);
armGroup.visible = false;
camera.add(armGroup);

// 左臂：左下方，前倾，内旋（镜像）
armGroupL.position.set(-0.30, -0.28, -0.45);
armGroupL.rotation.set(ARM_BASE_RX, -0.08, -0.10);
armGroupL.visible = false;
camera.add(armGroupL);

scene.add(camera);   // camera 有子节点时必须加入场景树

// 生成虚线边框 LineSegments（EdgesGeometry + LineDashedMaterial）
function _makeDashBox(color, size, dashSize, gapSize, opacity) {
  var geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  var mat = new THREE.LineDashedMaterial({
    color: color, dashSize: dashSize, gapSize: gapSize,
    transparent: true, opacity: opacity
  });
  var ls = new THREE.LineSegments(geo, mat);
  ls.computeLineDistances();
  ls.visible = false;
  scene.add(ls);
  return ls;
}

// ── 破坏目标框（selBox）：套在准星瞄准的实心方块上 ────────────────────────────
var selBox = _makeDashBox(0x00ff66, 1.004, 0.10, 0.06, 1.0);

// 放置预览框（placeBox）：有效放置位置，绿色虚线
var placeBox    = _makeDashBox(0x44ffaa, 1.007, 0.14, 0.07, 0.85);
// 非法放置框（invalidBox）：与玩家重叠不可放置，红色虚线
var invalidBox  = _makeDashBox(0xff3333, 1.007, 0.14, 0.07, 0.85);

var _place = {
  lastPos: null,   // 上一次放置的方块坐标
  lastDir: null,   // 由贴面法线学到的方向（单轴 ±1）
  idleT:   0,      // 自上次有效预览起累计的无准星时间（秒）
  pos:     null    // 当前帧预览坐标
};
var _lastPlaceSlot = -1;

// ── 音频 ──────────────────────────────────────────────────────────────────────
initAudio();              // 预载音效（异步，不阻塞）；解锁在 startGame（用户手势）
var _stepPh  = 0;         // 脚步相位（_bobT 每半周期触发一步）
var _inWater = false;     // 入水检测（false→true 时播水花）

// ── 视角切换（第一/第三人称）──────────────────────────────────────────────────
var viewFP = false;

function toggleView() {
  viewFP = !viewFP;
  playerGroup.visible = !viewFP;
  armGroup.visible    = viewFP;
  armGroupL.visible   = viewFP;
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
  // 落地脚步声（任何下落着地都响一声）
  if (!_wasGround && player.onGround && preVy < -4) {
    stepSound(getBlock(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z)));
  }
  _wasGround = player.onGround;

  // 入水水花：脚部方块从非水变水
  var feetWater = getBlock(
    Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)
  ) === WATER;
  if (feetWater && !_inWater) splashSound();
  _inWater = feetWater;

  // ── 破坏（单次 + 长按节流）─────────────────────────────────────────────────
  var nowS = now * 0.001;
  if (player.breakQ || (breakHeld && nowS - _lastBreak > BREAK_CD)) {
    player.breakQ = false;
    if (_swingT <= 0) _swingT = SWING_DUR;   // 第一人称挥镐动画
    if (tryPlayerAttack()) {                 // 前方有敌人：挥剑，不挖方块
      _lastBreak = nowS;
    } else {
      var hitB = raycast(12);
      if (hitB) {
        var _brokenId = getBlock(hitB.x, hitB.y, hitB.z);
        removeSound(_brokenId);
        setBlock(hitB.x, hitB.y, hitB.z, AIR);
        if (typeof recordEdit === 'function') recordEdit(hitB.x, hitB.y, hitB.z, AIR);
        if (_brokenId === TERRITORY_STONE && typeof _removeTerritory === 'function') _removeTerritory(hitB.x, hitB.y, hitB.z);
        _lastBreak = nowS;
      }
    }
  }

  // ── 破坏目标框：每帧 raycast，套在准星瞄准的实心方块上 ──────────────────────
  var selHit = raycast(12);
  if (selHit) {
    selBox.visible = true;
    selBox.position.set(selHit.x + 0.5, selHit.y + 0.5, selHit.z + 0.5);
  } else {
    selBox.visible = false;
  }

  // ── 放置预览框 ──────────────────────────────────────────────────────────────
  // 热键栏换格 → 更新手持物 + 清除方向记忆
  if (player.slot !== _lastPlaceSlot) {
    _lastPlaceSlot = player.slot;
    _updateHeldItem(player.slot);
    _place.lastPos = null;
    _place.lastDir = null;
    _place.idleT   = 0;
  }

  // ── 放置预览坐标计算 ──────────────────────────────────────────────────────
  // 摄像机前向向量（与下方相机段公式一致，提前计算供 FOV 门控使用）
  var _cp = Math.cos(player.pitch), _sp = Math.sin(player.pitch);
  var _fwx = -Math.sin(player.yaw) * _cp;
  var _fwy = _sp;
  var _fwz = -Math.cos(player.yaw) * _cp;

  _place.pos = null;
  var _idleInc = true;  // 本帧是否累计 idleT

  if (_place.lastDir && _place.lastPos) {
    // ── 方向模式：已学到放置方向 ──────────────────────────────────────────
    var _nx = _place.lastPos.x + _place.lastDir.x;
    var _ny = _place.lastPos.y + _place.lastDir.y;
    var _nz = _place.lastPos.z + _place.lastDir.z;

    // 准星是否打在上一个放置的方块上（无论哪个面）
    var _onLast = selHit &&
      selHit.x === _place.lastPos.x &&
      selHit.y === _place.lastPos.y &&
      selHit.z === _place.lastPos.z;

    // 准星命中的方块是否在建造方向的"身后"（dot < 0）：
    // 竖向堆叠时准星俯视会打到柱身下方旧方块，若放任准星接管会把预览
    // 算到旧方块的侧面/底部，第三块及以后完全失去预览。
    // 身后旧块等价处理为 _onLast（忽略准星面信息，继续用方向预测）。
    var _isBehind = !_onLast && selHit && (
      (selHit.x - _place.lastPos.x) * _place.lastDir.x +
      (selHit.y - _place.lastPos.y) * _place.lastDir.y +
      (selHit.z - _place.lastPos.z) * _place.lastDir.z
    ) < 0;

    if (selHit && !_onLast && !_isBehind) {
      // 准星打到了前方其他方块 → 准星临时接管
      _place.pos = selHit.prev ? selHit.prev : null;
      // 只有命中方块距上次放置位置 ≤4 格才抑制超时计时；
      // 玩家走远后准星仍有 selHit，但超时照常累积直到清除方向记忆
      var _hd = Math.abs(selHit.x - _place.lastPos.x) +
                Math.abs(selHit.y - _place.lastPos.y) +
                Math.abs(selHit.z - _place.lastPos.z);
      if (_hd <= 4) _idleInc = false;
    } else if (_ny >= 0) {
      if (_onLast || _isBehind) {
        // 准星打在上一个方块上，或命中了建造方向身后的旧块
        // → 强制用方向预测（忽略面信息，防止竖向堆叠丢失预览）
        _place.pos = { x: _nx, y: _ny, z: _nz };
        _idleInc = false;
      } else {
        // 准星未命中 → FOV 门控回退
        var _eyeX = player.x + (viewFP ? 0 : Math.cos(player.yaw) * CAM_SHOULDER);
        var _eyeY = player.y + PH * 0.85;
        var _eyeZ = player.z + (viewFP ? 0 : -Math.sin(player.yaw) * CAM_SHOULDER);
        var _tx = _nx + 0.5 - _eyeX;
        var _ty = _ny + 0.5 - _eyeY;
        var _tz = _nz + 0.5 - _eyeZ;
        var _tlen = Math.sqrt(_tx * _tx + _ty * _ty + _tz * _tz);
        if (_tlen > 0 &&
            (_tx * _fwx + _ty * _fwy + _tz * _fwz) / _tlen > 0.707 &&
            _tlen <= 6) {
          _place.pos = { x: _nx, y: _ny, z: _nz };
          _idleInc = false;
        }
      }
    }
  } else if (selHit && selHit.prev) {
    // ── 无方向记忆 → 准星完全主导 ─────────────────────────────────────────
    _place.pos = selHit.prev;
    _idleInc = false;
  }

  // 超时清除方向记忆，立即交还准星控制权
  if (_idleInc) {
    _place.idleT += dt;
    if (_place.idleT > 3.5) {
      _place.lastPos = null;
      _place.lastDir = null;
      _place.idleT   = 0;
      // 同帧立即用准星重新定位，不等下一帧
      if (selHit && selHit.prev) _place.pos = selHit.prev;
    }
  } else {
    _place.idleT = 0;
  }

  if (_place.pos) {
    var _ppx0 = Math.floor(player.x - PR), _ppx1 = Math.floor(player.x + PR);
    var _ppz0 = Math.floor(player.z - PR), _ppz1 = Math.floor(player.z + PR);
    var _ppy0 = Math.floor(player.y),      _ppy1 = Math.floor(player.y + PH - 0.01);
    var _pp = _place.pos;
    var _placeBlocked = !(_pp.x < _ppx0 || _pp.x > _ppx1 ||
                          _pp.y < _ppy0 || _pp.y > _ppy1 ||
                          _pp.z < _ppz0 || _pp.z > _ppz1);
    if (_placeBlocked) {
      invalidBox.position.set(_pp.x + 0.5, _pp.y + 0.5, _pp.z + 0.5);
      invalidBox.visible = true;
      placeBox.visible   = false;
    } else {
      placeBox.position.set(_pp.x + 0.5, _pp.y + 0.5, _pp.z + 0.5);
      placeBox.visible   = true;
      invalidBox.visible = false;
    }
  } else {
    placeBox.visible   = false;
    invalidBox.visible = false;
  }

  // ── 放置（单次 + 长按节流）─────────────────────────────────────────────────
  if (player.placeQ || (placeHeld && nowS - _lastPlace > PLACE_CD)) {
    player.placeQ = false;
    if (_swingT <= 0) _swingT = SWING_DUR;
    var pv = _place.pos;
    if (pv) {
      // 碰撞体全范围防重叠：覆盖玩家 AABB 实际占据的所有体素
      var px0 = Math.floor(player.x - PR), px1 = Math.floor(player.x + PR);
      var pz0 = Math.floor(player.z - PR), pz1 = Math.floor(player.z + PR);
      var py0 = Math.floor(player.y),      py1 = Math.floor(player.y + PH - 0.01);
      if (pv.x < px0 || pv.x > px1 || pv.y < py0 || pv.y > py1 || pv.z < pz0 || pv.z > pz1) {
        var _placedId = player.inv[player.slot];
        // 魔法塔道具：放置一座防御塔（非方块，不写区块/不记改动——塔单独入档）
        if (_placedId === TOWER_ITEM) {
          if (typeof placeTower === 'function') placeTower(pv.x + 0.5, pv.z + 0.5);
          _lastPlace = nowS;
        } else {
          setBlock(pv.x, pv.y, pv.z, _placedId);
          placeSound();
          if (typeof recordEdit === 'function') recordEdit(pv.x, pv.y, pv.z, _placedId);
          if (_placedId === TERRITORY_STONE && typeof _addTerritory === 'function') _addTerritory(pv.x, pv.y, pv.z);
          _lastPlace = nowS;
          // 学习放置方向：从第2块起才学（第1块 lastPos 为 null，不触发）。
          // 用「本次放置格 − 上次放置格」的主轴增量 = 玩家实际连放的延伸方向。
          // （旧实现用面法线，会把"贴地面铺地"学成往上叠 → 方向乱跳；增量法贴合手感。）
          if (_place.lastPos) {
            var _dx = pv.x - _place.lastPos.x;
            var _dy = pv.y - _place.lastPos.y;
            var _dz = pv.z - _place.lastPos.z;
            if (_dx || _dy || _dz) {   // 取绝对值最大的轴作为单轴方向
              if (Math.abs(_dx) >= Math.abs(_dy) && Math.abs(_dx) >= Math.abs(_dz)) {
                _place.lastDir = { x: _dx > 0 ? 1 : -1, y: 0, z: 0 };
              } else if (Math.abs(_dy) >= Math.abs(_dz)) {
                _place.lastDir = { x: 0, y: _dy > 0 ? 1 : -1, z: 0 };
              } else {
                _place.lastDir = { x: 0, y: 0, z: _dz > 0 ? 1 : -1 };
              }
            }
          }
          _place.lastPos = { x: pv.x, y: pv.y, z: pv.z };
          _place.idleT   = 0;
        }
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
  if (bobOn) {
    _bobT += dt * moveMag * 1.6;
    // 脚步声：Bob 每半周期（一只脚落地）触发一次，材质取脚下方块
    var stepNow = Math.floor(_bobT * 2);
    if (stepNow !== _stepPh) {
      _stepPh = stepNow;
      stepSound(getBlock(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z)));
    }
  }
  // 幅度刻意压低（晃动过大容易晕 3D）
  var bobY = Math.sin(_bobT * Math.PI * 2) * 0.016 * bobOn;
  var bobL = Math.sin(_bobT * Math.PI)     * 0.012 * bobOn;

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
  var tgtRoll = -jx * 0.007;
  _rollCur += (tgtRoll - _rollCur) * Math.min(1, 8 * dt);
  // YXZ 欧拉直接赋值（renderer.js 已设 rotation.order）→ 朝向严格平行视线
  camera.rotation.set(player.pitch, player.yaw, _rollCur);

  // ── 第一人称手臂动画 ──────────────────────────────────────────────────────
  if (_swingT > 0) _swingT -= dt;
  if (viewFP) {
    var swP = _swingT > 0 ? Math.sin((1 - _swingT / SWING_DUR) * Math.PI) : 0;
    // 右臂：前劈挥动 + 走路上下摆
    armGroup.rotation.x  = ARM_BASE_RX - swP * 1.0;
    armGroup.position.y  = -0.28 + Math.sin(_bobT * Math.PI * 2)          * 0.018 * bobOn;
    armGroup.position.x  =  0.30 + jx * 0.02;
    // 左臂：与右臂反相摆动（一左一右的自然走路手感）
    armGroupL.rotation.x = ARM_BASE_RX + Math.sin(_bobT * Math.PI * 2)    * 0.08  * bobOn;
    armGroupL.position.y = -0.28 + Math.sin(_bobT * Math.PI * 2 + Math.PI) * 0.018 * bobOn;
    armGroupL.position.x = -0.30 + jx * 0.02;
  }

  // FOV 冲刺扩张：地面跑动时 70° → 76°
  var tgFov = (!player.flying && player.onGround && moveMag > MOVE_SPD * 0.8) ? 76 : 70;
  _fovCur += (tgFov - _fovCur) * Math.min(1, 6 * dt);
  if (Math.abs(_fovCur - camera.fov) > 0.05) {
    camera.fov = _fovCur;
    camera.updateProjectionMatrix();
  }

  updateSky(dt);             // 昼夜循环 + 天气（太阳/云/雨/光照/雾）
  combatUpdate(dt, nowS);    // 军队战斗（单位 AI/箭矢/胜负）

  renderer.render(scene, camera);
}

// ── 开始游戏 ───────────────────────────────────────────────────────────────────
window.startGame = function () {
  unlockAudio();   // 用户手势内：解锁 iOS 音频 + 启动背景音乐

  // iOS Safari 在地址栏显示/隐藏过程中 window.innerHeight 会变化，
  // 脚本初始化时可能用了错误的高度导致画面压瘪；在这里强制刷新一次。
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (menuEl) menuEl.style.display = 'none';
  if (uiEl)   uiEl.style.display   = 'block';
  buildHotbar();
  buildBattleUI();   // 开战 + 指挥按钮（combat_cmd.js）
  if (typeof initAutoSave === 'function') initAutoSave();   // 自动存档（save.js）
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
        // 贴图就绪后更新手持物材质并初始化手持方块
        _handItemMat.map = atlasTexture;
        _handItemMat.needsUpdate = true;
        _updateHeldItem(player.slot);
        _lastPlaceSlot = player.slot;
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
      setProgress(90, '定位出生点...');
      var y;
      for (y = CHUNK_H - 1; y >= 0; y--) {
        if (getBlock(Math.floor(player.x), y, Math.floor(player.z)) !== AIR) {
          player.y = y + 1;
          break;
        }
      }
      bootStep = 9; requestAnimationFrame(bootNext);

    } else if (bootStep === 9) {
      setProgress(94, '放置建筑...');
      placeStructures();
      placeSimpleCastle(-8, -8);   // 城堡置于出生平地中央（原点附近），玩家出生点(8,8)落在城堡庭院内
      if (typeof loadGame === 'function') loadGame();   // 读取本地存档（玩家改动/位置/塔）
      bootStep = 10; requestAnimationFrame(bootNext);

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
