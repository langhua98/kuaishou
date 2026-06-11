// ─── game.js ──────────────────────────────────────────────────────────────────
// 核心游戏逻辑：玩家状态、区块流加载、主循环、启动序列。
//
// 依赖（须按顺序在此之前加载）：
//   init.js → constants.js → noise.js → world.js →
//   renderer.js → mesh.js → physics.js → raycast.js →
//   controls.js → ui.js
//
// 执行流程：
//   1. 声明 player 对象（位置、速度、视角、背包）
//   2. bootNext() 分帧生成并构建初始区块，避免首帧卡顿
//   3. startGame() 在玩家点击"开始"后进入主循环
//   4. tick(now) 每帧处理移动/物理/交互/渲染

// 所有文件共享的函数（setProgress 在 init.js 中定义）已就绪
window._step = 3;
setProgress(10, '初始化世界...');

// ── 玩家状态 ───────────────────────────────────────────────────────────────────
// 出生点：X=8, Y=海平面+振幅+4（地表上空），Z=8
var player = {
  x: 8, y: SEA + AMP + 4, z: 8,   // 位置（底部中心）
  vx: 0, vy: 0, vz: 0,             // 速度（米/秒）
  yaw: 0, pitch: 0,                 // 视角（弧度）
  onGround: false,
  flying:   false,
  jumpQ:    false,   // 本帧跳跃请求（touchstart 设置，tick 消费）
  breakQ:   false,   // 本帧破坏请求
  placeQ:   false,   // 本帧放置请求
  slot: 0,
  inv: [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, WATER]
};

window._step = 4;

// ── 区块流加载 ─────────────────────────────────────────────────────────────────
// RDIST=3 → 直径 7 区块 = 112×112 格视野
var lastCX = null, lastCZ = null, RDIST = 3;

// 每帧检查玩家所在区块是否变化，变化则加载新区块/卸载远端区块
function updateChunks() {
  var cx = Math.floor(player.x / CHUNK_W);
  var cz = Math.floor(player.z / CHUNK_D);
  if (cx === lastCX && cz === lastCZ) return;
  lastCX = cx; lastCZ = cz;

  var dx, dz, keys, k, p2, kcx, kcz;
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) {
      createChunk(cx + dx, cz + dz);
    }
  }
  for (dx = -RDIST; dx <= RDIST; dx++) {
    for (dz = -RDIST; dz <= RDIST; dz++) {
      rebuildChunk(cx + dx, cz + dz);
    }
  }
  // 卸载超出范围的区块（RDIST+1 缓冲，避免边界抖动）
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
  var dt = Math.min((now - lastT) / 1000, 0.05);  // 最大 50ms，防止大步长穿墙
  lastT = now;

  // 运动：摇杆偏移 → 世界空间速度
  var sy = Math.sin(player.yaw), cy2 = Math.cos(player.yaw);
  var jx = joy.dx / 40, jy = joy.dy / 40;  // 归一化到 [-1, 1]
  var spd = player.flying ? FLY_SPD : MOVE_SPD;
  // 摇杆前后（jy）沿视线水平方向，左右（jx）为其垂直方向
  player.vx = (-jy * (-sy) + jx *  cy2) * spd;
  player.vz = (-jy * (-cy2) + jx * (-sy)) * spd;

  // 垂直速度：飞行模式衰减；行走模式重力 + 跳跃
  if (player.flying) {
    player.vy *= 0.8;
  } else {
    player.vy -= GRAVITY * dt;
    if (player.jumpQ && player.onGround) player.vy = JUMP_V;
  }
  player.jumpQ    = false;
  player.onGround = false;

  // 积分位置，然后碰撞解算
  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.z += player.vz * dt;
  resolveAABB();

  // 破坏方块
  if (player.breakQ) {
    player.breakQ = false;
    var hit = raycast(6);
    if (hit) setBlock(hit.x, hit.y, hit.z, AIR);
  }

  // 放置方块（不能放在玩家脚下两格内，防止卡进方块）
  if (player.placeQ) {
    player.placeQ = false;
    var hit2 = raycast(6);
    if (hit2 && hit2.prev) {
      var pv   = hit2.prev;
      var px2  = Math.floor(player.x);
      var py2  = Math.floor(player.y);
      var pz2  = Math.floor(player.z);
      if (!(pv.x === px2 && (pv.y === py2 || pv.y === py2 + 1) && pv.z === pz2)) {
        setBlock(pv.x, pv.y, pv.z, player.inv[player.slot]);
      }
    }
  }

  // 坐标显示
  if (coordEl) {
    coordEl.textContent = 'X:' + Math.floor(player.x) + ' Y:' + Math.floor(player.y) + ' Z:' + Math.floor(player.z);
  }

  // 区块流
  updateChunks();

  // 摄像机跟随
  camera.position.set(player.x, player.y + PH * 0.85, player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  renderer.render(scene, camera);
}

// ── 开始游戏 ───────────────────────────────────────────────────────────────────
// 由菜单"开始游戏"按钮调用（见 template.html onclick）
window.startGame = function () {
  if (menuEl) menuEl.style.display = 'none';
  if (uiEl)   uiEl.style.display   = 'block';
  buildHotbar();
  lastT = performance.now();
  requestAnimationFrame(tick);
};

// ── 启动序列 ───────────────────────────────────────────────────────────────────
// 分帧生成初始地形，避免首次加载时的长时间白屏卡顿。
// 每一帧只做一步工作，然后 requestAnimationFrame 交还控制权。
var bootSX, bootSZ, bootStep = 0;

function bootNext() {
  try {
    if (bootStep === 0) {
      // 测试渲染器正常工作
      setProgress(10, '测试渲染器...');
      renderer.render(scene, camera);
      bootSX   = Math.floor(player.x / CHUNK_W);
      bootSZ   = Math.floor(player.z / CHUNK_D);
      bootStep = 1;
      requestAnimationFrame(bootNext);

    } else if (bootStep === 1) {
      // 生成 5×5 区块数据（仅数组，不建网格）
      setProgress(25, '生成地形...');
      var dx1, dz1;
      for (dx1 = -2; dx1 <= 2; dx1++) {
        for (dz1 = -2; dz1 <= 2; dz1++) {
          createChunk(bootSX + dx1, bootSZ + dz1);
        }
      }
      bootStep = 2;
      requestAnimationFrame(bootNext);

    } else if (bootStep >= 2 && bootStep <= 6) {
      // 每帧构建一列（5 个）区块的网格，共 5 帧
      var col2 = bootStep - 4, dz2;
      for (dz2 = -2; dz2 <= 2; dz2++) {
        rebuildChunk(bootSX + col2, bootSZ + dz2);
      }
      setProgress(40 + (bootStep - 2) * 12, '构建地形 ' + (bootStep - 1) + '/5...');
      bootStep++;
      requestAnimationFrame(bootNext);

    } else if (bootStep === 7) {
      // 从地表往下找第一个实心方块，作为出生点
      setProgress(92, '定位出生点...');
      var y;
      for (y = CHUNK_H - 1; y >= 0; y--) {
        if (getBlock(Math.floor(player.x), y, Math.floor(player.z)) !== AIR) {
          player.y = y + 1;
          break;
        }
      }
      bootStep = 8;
      requestAnimationFrame(bootNext);

    } else {
      // 启动完成，隐藏加载屏，显示主菜单
      setProgress(100, '完成!');
      if (loadEl) loadEl.style.display = 'none';
      if (menuEl) menuEl.style.display = 'flex';
    }
  } catch (e) {
    // 任一步骤出错，显示红色进度条和错误信息
    setProgress(0, '错误: ' + (e.message || String(e)));
    if (loadFill) { loadFill.style.width = '100%'; loadFill.style.background = '#f44'; }
  }
}

requestAnimationFrame(bootNext);
