// ─── game.js ──────────────────────────────────────────────────────────────────────────────
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

// ── 玩家状态 ─────────────────────────────────────────────────────────────────────────
var player = {
  x: 8, y: SEA + AMP + 4, z: 8,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  onGround: false, flying: false,
  jumpQ: false, breakQ: false, placeQ: false,
  slot: 0,
  inv: [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, RED_WALL, GOLD_ROOF, WHITE_STONE, GRAY_BRICK, GRAY_ROOF, RED_PILLAR, PLANKS, COBBLE, MUD_BRICK, TERRITORY_STONE, ICE, SNOW, IRON_ORE, GLASS, OBSIDIAN, GRAVEL, RED_SAND, TNT, COAL_ORE, TOWER_ITEM,
        BIRCH_LOG, BIRCH_LEAVES, SPRUCE_LOG, SPRUCE_LEAVES, BEDROCK, BLUE_WOOL, GREEN_WOOL, RED_WOOL, WHITE_WOOL, YELLOW_WOOL, BOOKSHELF, CARVED_PUMPKIN, CRAFTING_TABLE, DIAMOND_ORE, EMERALD_ORE, GOLD_ORE, REDSTONE_ORE, FURNACE, LAVA, MOSSY_COBBLE, DANDELION, POPPY, OAK_SAPLING, GRASS_PLANT, PACKED_ICE, SANDSTONE,
        FURNITURE_CHAIR, FURNITURE_TABLE, FURNITURE_BED, FURNITURE_COUCH, FURNITURE_SHELF, FURNITURE_CABINET, FURNITURE_LAMP, FURNITURE_RUG, FURNITURE_ARMCHAIR, FURNITURE_TABLE_LONG,
        FURNITURE_ARMCHAIR_P, FURNITURE_BED_DOUBLE, FURNITURE_BED_B, FURNITURE_CAB_SMALL,
        FURNITURE_CACTUS_M, FURNITURE_CACTUS_S, FURNITURE_CHAIR_B, FURNITURE_STOOL,
        FURNITURE_COUCH_P, FURNITURE_LAMP_TABLE, FURNITURE_RUG_OVAL, FURNITURE_RUG_B,
        FURNITURE_SHELF_SM, FURNITURE_SHELF_BL, FURNITURE_SHELF_BS, FURNITURE_TABLE_LOW, FURNITURE_TABLE_SM,
        FURNITURE_MELON, FURNITURE_PUMPKIN,
        CROP_WHEAT, CROP_CARROT,
        CROP_APPLE, CROP_BAMBOO, CROP_BEET, CROP_BUSHBERRIES, CROP_CACTUS,
        CROP_CORN, CROP_FLOWER, CROP_LETTUCE, CROP_MUSHROOM, CROP_ORANGE,
        CROP_PALMTREE, CROP_PUMPKIN_CROP, CROP_RICE, CROP_TOMATO, CROP_WATERMELON,
        VEH_CAR, VEH_TAXI, VEH_POLICE, VEH_BMW]
};

window._step = 4;

// ── 玩家模型容器 ───────────────────────────────────────────────────────────────────
// 启动时放一个简单盒子占位（GLTF 模型异步加载完成后由 models.js 热替换）
var playerGroup = new THREE.Group();

(function () {
  var mat  = new THREE.MeshLambertMaterial({ color: 0x3a6adc });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.6, PH, 0.35), mat);
  body.position.y = PH / 2;
  playerGroup.add(body);
}());

scene.add(playerGroup);

// ── 第一人称双手臂系统 ────────────────────────────────────────────
// 右臂（armGroup）  持当前热键标方块的迷你立方体，破坏时播前劌动画
// 左臂（armGroupL） 空手，走路时与右臂反相摆动
// 两组均挂在 camera 下（相机空间），仅第一人称可见
var armGroup  = new THREE.Group();   // 右臂
var armGroupL = new THREE.Group();   // 左臂
var ARM_BASE_RX = -0.25;
var _swingT = 0, SWING_DUR = 0.28;

// 手持物料（贴图就绪后填入 atlasTexture）
var _handItemMat  = new THREE.MeshBasicMaterial({ map: null, alphaTest: 0.5 });
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

// ── 破坏目标框（selBox）：套在准星矄准的实心方块上 ────────────────────
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
var _lastPlaceSlot  = -1;
var _lastHeldFurni  = 0;    // 上一帧持有的家具 id（0=非家具），用于逐帧检测换物

// ── 家具互动状态 ───────────────────────────────────────────────────────────────────
var _curInteract  = null;   // 本帧最近的可互动家具（或 null）
var _sitting      = null;   // 当前坐着的家具（或 null）
var _lastPromptId = -1;     // 互动提示去重（typeId+开关态变化才改 DOM）
var _restT        = 0;      // 休息提示剩余秒数

// ── 音频 ──────────────────────────────────────────────────────────────────────────
initAudio();              // 预载音效（异步，不阻塞）；解锁在 startGame（用户手势）
var _stepPh  = 0;         // 脚步相位（_bobT 每半周期触发一步）
var _inWater = false;     // 入水检测（false→true 时播水花）

// ── 覑角切换（第一/第三人称）────────────────────────────────────────────
var viewFP = false;

function toggleView() {
  viewFP = !viewFP;
  playerGroup.visible = !viewFP;
  if (_fpArmScene) {
    // GLB 手臂就绪：用 GLB 手臂，隐藏 Steve 盒子臂
    _fpArmScene.visible = viewFP;
    armGroup.visible  = false;
    armGroupL.visible = false;
  } else {
    armGroup.visible  = viewFP;
    armGroupL.visible = viewFP;
  }
  var xh = document.getElementById('xhair');
  if (xh) xh.classList.toggle('fp', viewFP);
  var b = document.getElementById('b-view');
  if (b) b.classList.toggle('on', viewFP);
}

// ── 农作物互动 ───────────────────────────────────────────────────────────────────
var _nearCropKey = null, _lastCropPrompt = null;
var _nearVehicleKey = null;

function _updateCropActPrompt() {
  var btns = document.getElementById('btns');
  if (!btns) return;
  if (_nearCropKey) {
    // 幂等操作：每帧都确保 canact 存在，防止 _updateInteractPrompt(null) 把它清掉
    btns.classList.add('canact');
    _lastPromptId = -99;
    var act = document.getElementById('b-act');
    if (act) {
      var ic = act.querySelector('.ic'), lbl = act.querySelector('.actl');
      if (ic && ic.textContent !== '🌾') ic.textContent = '🌾';
      if (lbl && lbl.textContent !== '收获') lbl.textContent = '收获';
    }
    _lastCropPrompt = _nearCropKey;
  } else if (_lastCropPrompt) {
    _lastCropPrompt = null;
    if (_lastPromptId === -99) { btns.classList.remove('canact'); _lastPromptId = 0; }
  }
}

function _updateVehicleActPrompt() {
  var btns = document.getElementById('btns');
  if (!btns) return;
  if (_nearVehicleKey || (typeof _mountedVehicle !== 'undefined' && _mountedVehicle)) {
    btns.classList.add('canact');
    _lastPromptId = -98;
    var act = document.getElementById('b-act');
    if (act) {
      var ic = act.querySelector('.ic'), lbl = act.querySelector('.actl');
      var mounted = typeof _mountedVehicle !== 'undefined' && _mountedVehicle;
      if (ic)  ic.textContent  = '🚗';
      if (lbl) lbl.textContent = mounted ? '下车' : '上车';
    }
  } else if (_lastPromptId === -98) {
    btns.classList.remove('canact');
    _lastPromptId = 0;
  }
}

// ── 家具互动 ───────────────────────────────────────────────────────────────────
// 互动按鈕（✋ b-act）调用：按家具类型分发开关灯/坐下/休息
function doInteract() {
  // 载具上/下车优先
  if (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) {
    if (typeof dismountVehicle === 'function') dismountVehicle();
    _nearVehicleKey = null;
    return;
  }
  if (_nearVehicleKey && typeof mountVehicle === 'function') {
    mountVehicle(_nearVehicleKey);
    return;
  }
  // 农作物收获优先
  if (_nearCropKey && typeof harvestCrop === 'function') {
    var _cparts = _nearCropKey.split(',');
    var _got = harvestCrop(+_cparts[0], +_cparts[1], +_cparts[2]);
    if (_got) {
      player.inv.push(_got);
      buildHotbar();
      if (typeof battleToast === 'function') battleToast('+1 ' + (BNAMES[_got] || '🌾'));
    }
    _nearCropKey = null; _lastCropPrompt = null; _lastPromptId = -1;
    return;
  }
  var e = _curInteract;
  if (!e) return;
  if (isFurnitureLamp(e.typeId)) {
    toggleLamp(e);
  } else if (isFurnitureBed(e.typeId)) {
    doRest(e);
  } else {
    doSit(e);
  }
  _lastPromptId = -1;   // 强制刷新提示文字（坐下↔起身）
}

function doSit(e) {
  if (_sitting) {
    if (typeof _markFurnitureSolid === 'function') _markFurnitureSolid(_sitting, true);
    _sitting = null;
    return;
  }
  player.x = e.x + 0.5; player.z = e.z + 0.5;
  player.yaw = e.yaw;
  player.vx = 0; player.vz = 0;
  if (typeof _markFurnitureSolid === 'function') _markFurnitureSolid(e, false);
  _sitting = e;
}

function doRest(e) {
  player.x = e.x + 0.5; player.z = e.z + 0.5;
  player.vx = 0; player.vz = 0;
  _restT = 1.5;   // 休息提示持续 1.5s（无昼夜系统，纯视觉反馈）
}

// 更新互动按鈕的显隐与图标/文字（仅在目标变化时改 DOM）
function _updateInteractPrompt(e) {
  var btns = document.getElementById('btns');
  if (!btns) return;
  if (!e) {
    if (_lastPromptId !== 0) { btns.classList.remove('canact'); _lastPromptId = 0; }
    return;
  }
  // 用 typeId*10 + (灯开关态/坐姿态) 作为去重键
  var sub = isFurnitureLamp(e.typeId) ? (e.on ? 1 : 2) : (_sitting === e ? 3 : 0);
  var key = e.typeId * 10 + sub;
  if (key === _lastPromptId) return;
  _lastPromptId = key;
  btns.classList.add('canact');
  var act = document.getElementById('b-act');
  if (!act) return;
  var ic = act.querySelector('.ic'), lbl = act.querySelector('.actl');
  var icon = '✋', text = '互动';
  if (isFurnitureLamp(e.typeId))     { icon = '💡'; text = e.on ? '关灯' : '开灯'; }
  else if (isFurnitureBed(e.typeId)) { icon = '🛏'; text = '休息'; }
  else                               { icon = '🪑'; text = (_sitting === e) ? '起身' : '坐下'; }
  if (ic)  ic.textContent  = icon;
  if (lbl) lbl.textContent = text;
}

// ── 第三人称摄像机（吃鸡架构）────────────────────────────────────────────
var CAM_DIST     = 4.0;
var CAM_SHOULDER = 0.55;
var _pivX = 0, _pivY = 0, _pivZ = 0, _pivInit = false;
var _camDcur = CAM_DIST;
var _bobT = 0, _fovCur = 70, _rollCur = 0;
var _dipY = 0, _dipV = 0;
var _wasGround = false;
var _playerRunning = false;   // 当前是否奔跑（摇杆推到底），驱动 run 动画与 FOV

// ── 长按交互冷却 ───────────────────────────────────────────────────────────────────
var BREAK_CD = 0.22;
var PLACE_CD = 0.30;
var _lastBreak = 0, _lastPlace = 0;

// ── 区块流加载 ───────────────────────────────────────────────────────────────────
var lastCX = null, lastCZ = null, RDIST = 3;

function updateChunks() {
  var cx = Math.floor(player.x / CHUNK_W);
  var cz = Math.floor(player.z / CHUNK_D);
  if (cx === lastCX && cz === lastCZ) return;
  lastCX = cx; lastCZ = cz;

  var dx, dz, keys, k, p2, kcx, kcz;
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) { createChunk(cx + dx, cz + dz); }
  }
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) { rebuildChunk(cx + dx, cz + dz); }
  }
  keys = Object.keys(chunks);
  for (k = 0; k < keys.length; k++) {
    p2  = keys[k].split(',');
    kcx = +p2[0]; kcz = +p2[1];
    if (Math.abs(kcx - cx) > RDIST + 1 || Math.abs(kcz - cz) > RDIST + 1) {
      removeChunk(kcx, kcz);
    }
  }
}

// ── 主循环 ──────────────────────────────────────────────────────────────────────────────
var lastT = 0;

function tick(now) {
  requestAnimationFrame(tick);
  var dt = Math.min((now - lastT) * 0.001, 0.05);
  lastT = now;

  // ── 移动 ──────────────────────────────────────────────────────────────────────
  // 坐下时动摇杆即起身（防止卡在家具上）
  if (_sitting && (joy.dx || joy.dy)) {
    if (typeof _markFurnitureSolid === 'function') _markFurnitureSolid(_sitting, true);
    _sitting = null;
  }
  if (typeof _onTrain !== 'undefined' && _onTrain) {
    // 乘坐高铁：按摇杆算车厢内行走速度（公式同正常行走），由 updateTrain 积分+夹紧
    var tsy = Math.sin(player.yaw), tcy = Math.cos(player.yaw);
    var tjx = joy.dx / JOY_R, tjy = joy.dy / JOY_R;
    var tjLen = Math.sqrt(tjx * tjx + tjy * tjy);
    if (tjLen > 1) { tjx /= tjLen; tjy /= tjLen; }
    var tspd = MOVE_SPD * 0.6;  // 车厢内行走稍慢
    player.vx = (tjy * tsy + tjx *  tcy) * tspd;
    player.vz = (tjy * tcy + tjx * (-tsy)) * tspd;
    player.vy = 0;
    player.jumpQ = false;
    player.onGround = true;
  } else if (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) {
    if (typeof updateVehicles === 'function') updateVehicles(dt);
    player.vy -= GRAVITY * dt;
    player.jumpQ = false;
    player.onGround = false;
  } else {
    var sy  = Math.sin(player.yaw), cy2 = Math.cos(player.yaw);
    var jx  = joy.dx / JOY_R, jy = joy.dy / JOY_R;
    // 摇杆推程（向量长度，0~1）决定走/跑；方向取单位向量
    var jLen = Math.sqrt(jx * jx + jy * jy);
    if (jLen > 1) jLen = 1;
    var ux = 0, uy = 0;
    if (jLen > 0.001) { ux = jx / jLen; uy = jy / jLen; }
    var spd;
    if (player.flying) {
      spd = FLY_SPD * jLen;          // 飞行保持模拟量
      _playerRunning = false;
    } else if (jLen < MOVE_DZ) {
      spd = 0; _playerRunning = false;          // 死区：不动
    } else if (jLen < RUN_T) {
      spd = MOVE_SPD; _playerRunning = false;   // 轻推：走
    } else {
      spd = RUN_SPD;  _playerRunning = true;    // 推到底：跑
    }
    // 摇杆上（uy<0）→ 沿视线水平方向前进，右（ux>0）→ 向右侧移
    player.vx = (uy * sy  + ux *  cy2) * spd;
    player.vz = (uy * cy2 + ux * (-sy)) * spd;

    if (player.flying) {
      // 飞行升降：按住跳跃=升，按住下降键=降，松开悬停
      if      (jumpHeld) player.vy = FLY_SPD * 0.75;
      else if (downHeld) player.vy = -FLY_SPD * 0.75;
      else               player.vy *= 0.8;
    } else {
      player.vy -= GRAVITY * dt;
      if (player.jumpQ && player.onGround) { player.vy = JUMP_V; jumpSound(); }
    }
    player.jumpQ    = false;
    player.onGround = false;
  }

  if (!(typeof _onTrain !== 'undefined' && _onTrain)) {
    var preVy = player.vy;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.z += player.vz * dt;
    resolveAABB();
    _resolveCircuitGround();
    if (typeof _resolveTrainCollision === 'function') _resolveTrainCollision();

    if (!_wasGround && player.onGround && preVy < -12) {
      _dipV = Math.max(-1.5, preVy * 0.05);
    }
    if (!_wasGround && player.onGround && preVy < -4) {
      landSound();
      stepSound(getBlock(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z)));
    }
    _wasGround = player.onGround;

    var feetWater = getBlock(
      Math.floor(player.x), Math.floor(player.y + 0.2), Math.floor(player.z)
    ) === WATER;
    if (feetWater && !_inWater) splashSound();
    _inWater = feetWater;
  }

  // 高铁每帧推进（无人时列车照常往返；乘车时锁定玩家位置）
  if (typeof updateTrain === 'function') updateTrain(dt);

  // ── 破坏（单次 + 长按节流）───────────────────────────────────────────────────
  var nowS = now * 0.001;
  if (player.breakQ || (breakHeld && nowS - _lastBreak > BREAK_CD)) {
    player.breakQ = false;
    if (!(typeof _onTrain !== 'undefined' && _onTrain)) {
      if (_swingT <= 0) _swingT = SWING_DUR;
      if (tryPlayerAttack()) {
        _lastBreak = nowS;
      } else {
        var hitB = raycast(12);
        if (hitB) {
          var _brokenId = getBlock(hitB.x, hitB.y, hitB.z);
          removeSound(_brokenId);
          if (typeof spawnBurst === 'function' && BCOL[_brokenId]) {
            var _bc = BCOL[_brokenId];
            spawnBurst(hitB.x + 0.5, hitB.y + 0.5, hitB.z + 0.5, {
              count: 16,
              color: (Math.round(_bc[0]*255) << 16) | (Math.round(_bc[1]*255) << 8) | Math.round(_bc[2]*255),
              speed: 3, size: 0.14, life: 0.45, gravity: 16
            });
          }
          setBlock(hitB.x, hitB.y, hitB.z, AIR);
          if (typeof recordEdit === 'function') recordEdit(hitB.x, hitB.y, hitB.z, AIR);
          if (_brokenId === TERRITORY_STONE && typeof _removeTerritory === 'function') _removeTerritory(hitB.x, hitB.y, hitB.z);
          if (_brokenId === OBSIDIAN && typeof _enemyStrongholdPos !== 'undefined' && _enemyStrongholdPos &&
              hitB.x === _enemyStrongholdPos.x && hitB.y === _enemyStrongholdPos.y && hitB.z === _enemyStrongholdPos.z) {
            for (var _si = 0; _si < combatUnits.length; _si++) {
              if (combatUnits[_si].side === 1 && combatUnits[_si].passive) combatUnits[_si].passive = false;
            }
            _enemyStrongholdPos = null;
          }
          _lastBreak = nowS;
        }
      }
    }
  }

  var selHit = raycast(12);
  if (selHit) {
    selBox.visible = true;
    selBox.position.set(selHit.x + 0.5, selHit.y + 0.5, selHit.z + 0.5);
  } else {
    selBox.visible = false;
  }

  if (player.slot !== _lastPlaceSlot) {
    _lastPlaceSlot = player.slot;
    _updateHeldItem(player.slot);
    _place.lastPos = null;
    _place.lastDir = null;
    _place.idleT   = 0;
    slotChangeSound();
  }

  var _cp = Math.cos(player.pitch), _sp = Math.sin(player.pitch);
  var _fwx = -Math.sin(player.yaw) * _cp;
  var _fwy = _sp;
  var _fwz = -Math.cos(player.yaw) * _cp;

  _place.pos = null;
  var _idleInc = true;

  if (_place.lastDir && _place.lastPos) {
    var _nx = _place.lastPos.x + _place.lastDir.x;
    var _ny = _place.lastPos.y + _place.lastDir.y;
    var _nz = _place.lastPos.z + _place.lastDir.z;

    var _onLast = selHit &&
      selHit.x === _place.lastPos.x &&
      selHit.y === _place.lastPos.y &&
      selHit.z === _place.lastPos.z;

    var _isBehind = !_onLast && selHit && (
      (selHit.x - _place.lastPos.x) * _place.lastDir.x +
      (selHit.y - _place.lastPos.y) * _place.lastDir.y +
      (selHit.z - _place.lastPos.z) * _place.lastDir.z
    ) < 0;

    if (selHit && !_onLast && !_isBehind) {
      _place.pos = selHit.prev ? selHit.prev : null;
      var _hd = Math.abs(selHit.x - _place.lastPos.x) +
                Math.abs(selHit.y - _place.lastPos.y) +
                Math.abs(selHit.z - _place.lastPos.z);
      if (_hd <= 4) _idleInc = false;
    } else if (_ny >= 0) {
      if (_onLast || _isBehind) {
        _place.pos = { x: _nx, y: _ny, z: _nz };
        if (_onLast) _idleInc = false;
      } else {
        var _eyeX = viewFP ? player.x : _pivX + Math.cos(player.yaw) * CAM_SHOULDER;
        var _eyeY = viewFP ? player.y + PH * 0.85 : _pivY;
        var _eyeZ = viewFP ? player.z : _pivZ - Math.sin(player.yaw) * CAM_SHOULDER;
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
    _place.pos = selHit.prev;
    _idleInc = false;
  }

  if (_idleInc) {
    _place.idleT += dt;
    if (_place.idleT > 3.5) {
      _place.lastPos = null;
      _place.lastDir = null;
      _place.idleT   = 0;
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

  var _heldNow = player.inv[player.slot];
  var _btnsEl  = document.getElementById('btns');
  if (isFurnitureId(_heldNow)) {
    if (_lastHeldFurni !== _heldNow) {
      _ghostYaw = Math.round((player.yaw + Math.PI) / (Math.PI / 2)) * (Math.PI / 2);
      if (!_furnitureLoaded) loadFurnitureModels(function () {});
    }
    if (_btnsEl) _btnsEl.classList.add('furni');
    if (_place.pos) {
      updateFurnitureGhost(_heldNow, _place.pos.x, _place.pos.y, _place.pos.z, _ghostYaw, true);
      placeBox.visible = false;
    } else {
      updateFurnitureGhost(0, 0, 0, 0, 0, false);
    }
  } else {
    if (_lastHeldFurni) disposeFurnitureGhost();
    if (_btnsEl) _btnsEl.classList.remove('furni');
    updateFurnitureGhost(0, 0, 0, 0, 0, false);
  }
  _lastHeldFurni = isFurnitureId(_heldNow) ? _heldNow : 0;

  // ── 放置（单次 + 长按节流）───────────────────────────────────────────────────
  if (player.placeQ || (placeHeld && nowS - _lastPlace > PLACE_CD)) {
    player.placeQ = false;
    if (typeof _onTrain !== 'undefined' && _onTrain) { /* 车内禁止放置方块 */ }
    else {
    if (_swingT <= 0) _swingT = SWING_DUR;
    var pv = _place.pos;
    if (pv) {
      var px0 = Math.floor(player.x - PR), px1 = Math.floor(player.x + PR);
      var pz0 = Math.floor(player.z - PR), pz1 = Math.floor(player.z + PR);
      var py0 = Math.floor(player.y),      py1 = Math.floor(player.y + PH - 0.01);
      if (pv.x < px0 || pv.x > px1 || pv.y < py0 || pv.y > py1 || pv.z < pz0 || pv.z > pz1) {
        var _placedId = player.inv[player.slot];
        if (_placedId === TOWER_ITEM) {
          if (typeof placeTower === 'function') placeTower(pv.x + 0.5, pv.z + 0.5);
          _lastPlace = nowS;
        } else if (typeof isCropSeed === 'function' && isCropSeed(_placedId)) {
          var _below = getBlock(pv.x, pv.y - 1, pv.z);
          if (_below === GRASS || _below === DIRT) {
            if (typeof plantCrop === 'function') plantCrop(_placedId, pv.x, pv.y, pv.z);
            placeSound();
          }
          _lastPlace = nowS;
        } else if (typeof isVehicleId === 'function' && isVehicleId(_placedId)) {
          if (typeof placeVehicle === 'function') placeVehicle(_placedId, pv.x, pv.y, pv.z, player.yaw);
          placeSound();
          _lastPlace = nowS;
        } else if (isFurnitureId(_placedId)) {
          if (typeof loadFurnitureModels === 'function') {
            loadFurnitureModels(function () {
              placeFurniture(_placedId, pv.x, pv.y, pv.z, _ghostYaw);
              placeSound();
            });
          }
          _lastPlace = nowS;
        } else {
          setBlock(pv.x, pv.y, pv.z, _placedId);
          placeSound();
          if (typeof recordEdit === 'function') recordEdit(pv.x, pv.y, pv.z, _placedId);
          if (_placedId === TERRITORY_STONE && typeof _addTerritory === 'function') _addTerritory(pv.x, pv.y, pv.z);
          _lastPlace = nowS;
          if (_place.lastPos) {
            var _dx = pv.x - _place.lastPos.x;
            var _dy = pv.y - _place.lastPos.y;
            var _dz = pv.z - _place.lastPos.z;
            if (_dx || _dy || _dz) {
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
    }  // end else (!_onTrain)
  }

  if (coordEl) {
    coordEl.textContent =
      'X:' + Math.floor(player.x) + ' Y:' + Math.floor(player.y) + ' Z:' + Math.floor(player.z);
  }

  if (typeof _furniturePlaced !== 'undefined') {
    var _nearF = null, _nearD2 = 2.0 * 2.0;
    for (var _fi = 0; _fi < _furniturePlaced.length; _fi++) {
      var _fe = _furniturePlaced[_fi];
      if (!isInteractive(_fe.typeId)) continue;
      var _ddx = (_fe.x + 0.5) - player.x;
      var _ddz = (_fe.z + 0.5) - player.z;
      var _ddy = _fe.y - player.y;
      var _fd2 = _ddx * _ddx + _ddz * _ddz + _ddy * _ddy * 0.25;
      if (_fd2 < _nearD2) { _nearD2 = _fd2; _nearF = _fe; }
    }
    _curInteract = _nearF;
    _updateInteractPrompt(_nearF);
  }
  if (_restT > 0) {
    _restT -= dt;
    if (_restT <= 0) { _restT = 0; _updateInteractPrompt(_curInteract); }
  }
  _nearCropKey = (typeof nearestMatureCrop === 'function')
    ? nearestMatureCrop(player.x, player.y, player.z, 2.5) : null;
  if (!_curInteract) _updateCropActPrompt();
  _nearVehicleKey = (typeof nearestVehicle === 'function')
    ? nearestVehicle(player.x, player.y, player.z, 3.0) : null;
  if (!_curInteract && !_nearCropKey) _updateVehicleActPrompt();

  updateChunks();

  playerGroup.position.set(player.x, player.y, player.z);
  playerGroup.rotation.y = player.yaw;

  var _mounted = (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) ||
                 (typeof _onTrain !== 'undefined' && _onTrain);
  // 驾驶车辆时隐藏玩家模型避免穿模；乘高铁时第三人称仍显示角色（第一人称本就隐藏）
  var _hideModel = (typeof _mountedVehicle !== 'undefined' && _mountedVehicle);
  if (!viewFP) playerGroup.visible = !_hideModel;
  if (_mounted && typeof syncMountedVehicle === 'function') syncMountedVehicle(dt);

  var moveMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
  if (playerMixer) {
    if      (!player.onGround && !player.flying && player.vy >  2) playerAnim('jump');
    else if (!player.onGround && !player.flying && player.vy < -4) playerAnim('fall');
    else if (_playerRunning && moveMag > 0.5) playerAnim('run');
    else if (moveMag > 0.5)                   playerAnim('walk');
    else                                      playerAnim('idle');
    playerMixer.update(dt);
    if (_fpArmMixer) _fpArmMixer.update(dt);
    if (typeof updatePlayerProcAnim === 'function') updatePlayerProcAnim(dt);
  }

  updateNPCs(dt);

  var cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  var fwx = -Math.sin(player.yaw) * cp;
  var fwy = sp;
  var fwz = -Math.cos(player.yaw) * cp;
  var rwx = Math.cos(player.yaw), rwz = -Math.sin(player.yaw);

  var tPx = player.x, tPy = player.y + PH * 0.8, tPz = player.z;
  if (!_pivInit) { _pivX = tPx; _pivY = tPy; _pivZ = tPz; _pivInit = true; }
  var kH = Math.min(1, 25 * dt), kV = Math.min(1, 12 * dt);
  _pivX += (tPx - _pivX) * kH;
  _pivZ += (tPz - _pivZ) * kH;
  _pivY += (tPy - _pivY) * kV;

  _dipV += (-_dipY * 90 - _dipV * 12) * dt;
  _dipY += _dipV * dt;

  var bobOn = (player.onGround && moveMag > 0.3) ? 1 : 0;
  if (bobOn) {
    _bobT += dt * moveMag * 1.6;
    var stepNow = Math.floor(_bobT * 2);
    if (stepNow !== _stepPh) {
      _stepPh = stepNow;
      stepSound(getBlock(Math.floor(player.x), Math.floor(player.y) - 1, Math.floor(player.z)));
    }
  }
  var bobY = Math.sin(_bobT * Math.PI * 2) * 0.016 * bobOn;
  var bobL = Math.sin(_bobT * Math.PI)     * 0.012 * bobOn;

  var _sitDip = _sitting ? 0.45 : 0;
  if (viewFP) {
    camera.position.set(
      player.x + rwx * bobL * 0.5,
      player.y + PH * 0.85 - _sitDip + bobY * 0.6 + _dipY,
      player.z + rwz * bobL * 0.5
    );
  } else if (typeof _onTrain !== 'undefined' && _onTrain) {
    // 高铁第三人称追车相机：从车尾正后方 8 格、上方 4 格俯视行进方向
    var _tFwx = -Math.sin(player.yaw);
    var _tFwz = -Math.cos(player.yaw);
    _pivX = player.x; _pivY = player.y; _pivZ = player.z; _pivInit = true;
    camera.position.set(
      player.x - _tFwx * 8,
      player.y + 4.0,
      player.z - _tFwz * 8
    );
  } else if (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) {
    // 驾驶追车相机：车后上方俯视，沿平滑相机朝向；不与车体碰撞，避免埋进车体黑屏
    var vcd = (typeof _camIntro !== 'undefined') ? _camIntro.d : 6.0;
    var vch = (typeof _camIntro !== 'undefined') ? _camIntro.h : 3.2;
    var vsx = -Math.sin(_driveCamYaw), vsz = -Math.cos(_driveCamYaw); // 平滑跟随车头
    camera.position.set(
      player.x - vsx * vcd,
      player.y + vch,
      player.z - vsz * vcd
    );
  } else {
    var shX = _pivX + rwx * CAM_SHOULDER;
    var shY = _pivY - _sitDip;
    var shZ = _pivZ + rwz * CAM_SHOULDER;
    var hitD = CAM_DIST, cd, cid;
    for (cd = 0.2; cd <= CAM_DIST; cd += 0.1) {
      cid = getBlock(
        Math.floor(shX - fwx * cd),
        Math.floor(shY - fwy * cd),
        Math.floor(shZ - fwz * cd)
      );
      if (cid !== AIR && cid !== WATER && !_PLANT[cid]) { hitD = Math.max(0.4, cd - 0.3); break; }
    }
    if (hitD < _camDcur) _camDcur = hitD;
    else                 _camDcur += (hitD - _camDcur) * Math.min(1, 4 * dt);

    camera.position.set(
      shX - fwx * _camDcur + rwx * bobL,
      shY - fwy * _camDcur + bobY + _dipY,
      shZ - fwz * _camDcur + rwz * bobL
    );
  }

  // jx 仅在"行走"分支里赋值；驾驶时为 undefined → 防止 NaN 污染 _rollCur（曾导致下车黑屏）
  var _rollIn = (!_mounted && typeof jx === 'number') ? jx : 0;
  if (isNaN(_rollCur)) _rollCur = 0;
  var tgtRoll = -_rollIn * 0.007;
  _rollCur += (tgtRoll - _rollCur) * Math.min(1, 8 * dt);
  if (typeof _onTrain !== 'undefined' && _onTrain && !viewFP) {
    camera.rotation.set(-0.3, player.yaw, 0);      // 高铁第三人称：固定俯角，朝行进方向
  } else if (typeof _mountedVehicle !== 'undefined' && _mountedVehicle) {
    camera.rotation.set(-0.35, _driveCamYaw, 0);  // 驾驶：固定俯角，朝向平滑跟随车头
  } else {
    camera.rotation.set(player.pitch, player.yaw, _rollCur);
  }

  if (_swingT > 0) _swingT -= dt;
  if (viewFP) {
    var swP = _swingT > 0 ? Math.sin((1 - _swingT / SWING_DUR) * Math.PI) : 0;
    armGroup.rotation.x  = ARM_BASE_RX - swP * 1.0;
    armGroup.position.y  = -0.28 + Math.sin(_bobT * Math.PI * 2)          * 0.018 * bobOn;
    armGroup.position.x  =  0.30 + jx * 0.02;
    armGroupL.rotation.x = ARM_BASE_RX + Math.sin(_bobT * Math.PI * 2)    * 0.08  * bobOn;
    armGroupL.position.y = -0.28 + Math.sin(_bobT * Math.PI * 2 + Math.PI) * 0.018 * bobOn;
    armGroupL.position.x = -0.30 + jx * 0.02;
  }

  var tgFov = (!player.flying && player.onGround && _playerRunning) ? 76 : 70;
  _fovCur += (tgFov - _fovCur) * Math.min(1, 6 * dt);
  if (Math.abs(_fovCur - camera.fov) > 0.05) {
    camera.fov = _fovCur;
    camera.updateProjectionMatrix();
  }

  updateSky(dt);
  if (typeof updateCrops === 'function') updateCrops(dt);
  combatUpdate(dt, nowS);
  if (typeof updateVillagers === 'function') updateVillagers(dt);

  if (typeof _updateFpClip === 'function') _updateFpClip();
  renderer.render(scene, camera);
}

function onUnitDeath(u) {
  if (u.side === 1) killSound();
}

window.startGame = function () {
  unlockAudio();

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  if (menuEl) menuEl.style.display = 'none';
  if (uiEl)   uiEl.style.display   = 'block';
  buildHotbar();
  buildBattleUI();
  if (typeof initAutoSave === 'function') initAutoSave();
  lastT = performance.now();
  requestAnimationFrame(tick);
};

var bootSX, bootSZ, bootStep = 0;

function bootNext() {
  try {
    if (bootStep === 0) {
      setProgress(8, '加载贴图 (0/' + _TILES.length + ')...');
      loadTextures(function () {
        setProgressSub('');
        addProgressLog('贴图集合并完成');
        _mat.map = atlasTexture;
        _mat.needsUpdate = true;
        _handItemMat.map = atlasTexture;
        _handItemMat.needsUpdate = true;
        _updateHeldItem(player.slot);
        _lastPlaceSlot = player.slot;
        bootStep = 1;
        requestAnimationFrame(bootNext);
      }, function (done, total, name) {
        var pct = 8 + Math.round(done / total * 60);
        setProgress(pct, '加载贴图 (' + done + '/' + total + ')...');
        setProgressSub(name + '.png');
        addProgressLog(name + '.png');
      });
      return;

    } else if (bootStep === 1) {
      setProgress(70, '测试渲染器...');
      setProgressSub('');
      renderer.render(scene, camera);
      bootSX = Math.floor(player.x / CHUNK_W);
      bootSZ = Math.floor(player.z / CHUNK_D);
      bootStep = 2; requestAnimationFrame(bootNext);

    } else if (bootStep === 2) {
      setProgress(74, '生成地形...');
      addProgressLog('生成地形噪声...');
      var dx1, dz1;
      for (dx1 = -2; dx1 <= 2; dx1++) {
        for (dz1 = -2; dz1 <= 2; dz1++) { createChunk(bootSX + dx1, bootSZ + dz1); }
      }
      addProgressLog('区块数据生成完成');
      bootStep = 3; requestAnimationFrame(bootNext);

    } else if (bootStep >= 3 && bootStep <= 7) {
      var col = bootStep - 5, dz2;
      for (dz2 = -2; dz2 <= 2; dz2++) { rebuildChunk(bootSX + col, bootSZ + dz2); }
      setProgress(78 + (bootStep - 3) * 4, '构建地形网格 ' + (bootStep - 2) + '/5...');
      addProgressLog('构建区块列 ' + (bootStep - 2) + '/5');
      bootStep++; requestAnimationFrame(bootNext);

    } else if (bootStep === 8) {
      setProgress(94, '定位出生点...');
      addProgressLog('定位出生点...');
      var y;
      for (y = CHUNK_H - 1; y >= 0; y--) {
        if (getBlock(Math.floor(player.x), y, Math.floor(player.z)) !== AIR) {
          player.y = y + 1;
          break;
        }
      }
      bootStep = 9; requestAnimationFrame(bootNext);

    } else if (bootStep === 9) {
      setProgress(97, '放置建筑...');
      addProgressLog('生成城堡与建筑...');
      placeStructures();
      placeSimpleCastle(-8, -8);
      placeVillage( 110,  70);   // 东南村庄
      placeVillage(-110,  90);   // 西南村庄
      placeVillage(  70, -130);  // 北方村庄
      if (typeof initTrain === 'function') initTrain();   // 高铁轨道 + 列车
      _loadSuzukaCircuit();                               // 铃鹿赛道（道路尽头）
      if (typeof loadGame === 'function') loadGame();
      bootStep = 10; requestAnimationFrame(bootNext);

    } else {
      setProgress(100, '完成!');
      addProgressLog('世界已就绪 — 开始游戏');
      if (loadEl) loadEl.style.display = 'none';
      if (menuEl) menuEl.style.display = 'flex';
      loadPlayerModel();
      spawnNPCs();
      loadArmyModels(function () {
        if (!_enemyStrongholdPos || !_enemyStrongholdPos.posts) return;
        var posts = _enemyStrongholdPos.posts;
        var pox = _enemyStrongholdPos.ox, poz = _enemyStrongholdPos.oz;
        var roster = [
          { k: 'skel_war', n: 20 },
          { k: 'skel_min', n: 20 },
          { k: 'skel_rog', n: 15 }
        ];
        var pi = 0;
        roster.forEach(function (r) {
          for (var i = 0; i < r.n && pi < posts.length; i++, pi++) {
            var p = posts[pi];
            var u = spawnUnit(r.k, 1, pox + p[0], poz + p[1]);
            if (u) u.passive = true;
          }
        });
      }, function () {});
    }
  } catch (e) {
    setProgress(0, '错误: ' + (e.message || String(e)));
    if (loadFill) { loadFill.style.width = '100%'; loadFill.style.background = '#f44'; }
  }
}

requestAnimationFrame(bootNext);

// 铃鹿赛道 GLB —— 全局引用供 Raycaster 碰撞使用
var _circuitModel = null;
var _circuitRC    = null;
var _circuitRCDir = new THREE.Vector3(0, -1, 0);
var _circuitRCOrg = new THREE.Vector3();

function _loadSuzukaCircuit() {
  if (typeof gltfLoader === 'undefined') return;
  gltfLoader.load('assets/models/suzuka_circuit.glb', function (g) {
    var model = g.scene;

    // 1. 缩放到目标尺寸
    model.updateMatrixWorld(true);
    var bb = new THREE.Box3().setFromObject(model);
    var maxDim = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (maxDim > 0.1) {
      var s = 3000 / maxDim;
      model.scale.multiplyScalar(s);
      model.updateMatrixWorld(true);
      bb.setFromObject(model);
    }

    // 2. X/Z 居中放到 z=1710（道路尽头 z=210 再往南 1500）
    model.position.x = 0 - (bb.min.x + bb.max.x) / 2;
    model.position.z = 1710 - (bb.min.z + bb.max.z) / 2;
    model.position.y = 0;
    model.updateMatrixWorld(true);

    // 3. 自动找赛道面高度：从赛道中心上方射线向下，取第一个命中点 Y
    var floorRC = new THREE.Raycaster();
    var cx = (bb.min.x + bb.max.x) / 2 + model.position.x;  // 世界 X 中心
    var cz = 1710;
    floorRC.set(new THREE.Vector3(cx, 5000, cz), new THREE.Vector3(0, -1, 0));
    var fhits = floorRC.intersectObject(model, true);
    var trackY = fhits.length > 0 ? fhits[0].point.y : 0;
    // 把赛道面对齐 SEA+3（= 体素石头地面的站立高度，避免人物下陷一格）
    model.position.y = (SEA + 3) - trackY;

    // 4. 保留 PBR 材质，注入中性灰 IBL 环境贴图（仅影响赛道 MeshStandardMaterial）
    var _pmrem = new THREE.PMREMGenerator(renderer);
    var _envScene = new THREE.Scene();
    _envScene.background = new THREE.Color(0x999999);
    var _envTex = _pmrem.fromScene(_envScene).texture;
    _pmrem.dispose();

    model.traverse(function (node) {
      if (!node.isMesh) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      for (var mi2 = 0; mi2 < mats.length; mi2++) {
        var m = mats[mi2];
        if (!m) continue;
        m.envMap = _envTex;
        m.envMapIntensity = 1.0;
        m.needsUpdate = true;
      }
    });

    scene.add(model);
    _circuitModel = model;
    _circuitRC    = new THREE.Raycaster();
  }, undefined, function (e) { console.warn('suzuka load failed', e); });
}

// 每帧：玩家在赛道区时向下射线打 GLB，站在模型表面
function _resolveCircuitGround() {
  if (!_circuitModel || !_circuitRC) return;
  if (player.x < -900 || player.x > 900 || player.z < 205 || player.z > 3215) return;
  _circuitRCOrg.set(player.x, player.y + 10, player.z);
  _circuitRC.set(_circuitRCOrg, _circuitRCDir);
  var hits = _circuitRC.intersectObject(_circuitModel, true);
  if (!hits.length) return;
  var sy = hits[0].point.y;
  // 体素石地（y=SEA+3）始终承托，永不下陷；射线只在 GLB 表面高于地面时把玩家抬上去
  if (sy <= SEA + 3) return;
  if (player.y >= sy - 2 && player.y <= sy + 1.2) {
    player.y  = sy;
    if (player.vy < 0) player.vy = 0;
    player.onGround = true;
  }
}
