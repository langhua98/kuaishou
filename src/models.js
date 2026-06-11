// ─── models.js ────────────────────────────────────────────────────────────────
// GLTF 模型加载：玩家角色 + NPC（狐狸/马/鹦鹉）。
//
// 模型来源（均为 CC0/公有领域，提交在 assets/models/）：
//   player.glb — Kenney Starter Kit 角色（kenney.nl，CC0），
//                方块积木风格，动画：idle / walk / jump
//   fox.glb    — Fox，PixelMannen（CC0，Khronos 官方样例），动画：Survey/Walk/Run
//   horse.glb  — Horse，three.js 示例（mirada/ro.me），形变动画
//   parrot.glb — Parrot，同上，飞行动画
//
// 加载策略：异步、不阻塞游戏启动。
//   玩家先用盒子占位（game.js 构建），player.glb 加载完成后热替换。
//   NPC 在各自模型就绪后才生成。
//
// 对外接口：
//   loadPlayerModel()  — 异步加载玩家模型
//   playerAnim(state)  — 切换玩家动画状态：'idle' | 'walk' | 'run' | 'jump'
//   playerMixer        — 玩家动画混合器（tick 中 update）
//   spawnNPCs() / updateNPCs(dt) — NPC 生成与 AI 更新

var gltfLoader = new THREE.GLTFLoader();

// ── 玩家模型 ──────────────────────────────────────────────────────────────────
var playerMixer = null;   // null = 模型未就绪
var _pActions   = {};     // 动画名(原始) → AnimationAction
var _pCurrent   = '';

// 状态 → 可能的动画名（不同模型命名不同，按序取第一个存在的）
var _ANIM_ALIAS = {
  idle: ['idle', 'Idle'],
  walk: ['walk', 'Walking', 'Walk'],
  run:  ['run', 'Running', 'walk', 'Walking'],  // 没有跑步动画就用走路
  jump: ['jump', 'Jump']
};

function loadPlayerModel() {
  gltfLoader.load('assets/models/player.glb', function (gltf) {
    var model = gltf.scene;

    // 归一化身高，脚底对齐 y=0
    var bbox = new THREE.Box3().setFromObject(model);
    var s = (PH * 0.95) / (bbox.max.y - bbox.min.y);
    model.scale.set(s, s, s);
    model.position.y = -bbox.min.y * s;
    // 模型默认朝 +Z，游戏前进方向为 -Z → 转 180°
    model.rotation.y = Math.PI;

    while (playerGroup.children.length) playerGroup.remove(playerGroup.children[0]);
    playerGroup.add(model);

    playerMixer = new THREE.AnimationMixer(model);
    var i;
    for (i = 0; i < gltf.animations.length; i++) {
      _pActions[gltf.animations[i].name] = playerMixer.clipAction(gltf.animations[i]);
    }
    playerAnim('idle');
  }, undefined, function () { /* 加载失败：保留盒子占位 */ });
}

// 切换玩家动画状态（同状态重复调用为空操作）
function playerAnim(state) {
  if (!playerMixer) return;
  var names = _ANIM_ALIAS[state] || [state], name = null, i;
  for (i = 0; i < names.length; i++) {
    if (_pActions[names[i]]) { name = names[i]; break; }
  }
  if (!name || _pCurrent === name) return;
  var prev = _pActions[_pCurrent];
  if (prev) prev.fadeOut(0.2);
  _pActions[name].reset().fadeIn(0.2).play();
  _pCurrent = name;
}

// ── NPC ───────────────────────────────────────────────────────────────────────
// 地面 NPC（狐狸/马）：漫游 AI（直走 + 随机转向 + 贴地 + 遇水/悬崖掉头）
// 飞行 NPC（鹦鹉）：绕出生点圆周飞行 + 上下浮动
var npcs     = [];  // 地面：{ group, mixer, x, y, z, yaw, speed, timer }
var flyNpcs  = [];  // 飞行：{ group, mixer, cx, cz, radius, baseY, angSpd, ang, phase }

// 从高空往下找第一个实心方块顶面的 y
function _groundY(wx, wz) {
  var bx = Math.floor(wx), bz = Math.floor(wz), y, id;
  for (y = CHUNK_H - 1; y >= 0; y--) {
    id = getBlock(bx, y, bz);
    if (id !== AIR && id !== WATER) return y + 1;
  }
  return SEA + 2;
}

// 通用：缩放到目标高度、脚底对齐、转向 -Z
function _prepModel(model, targetH) {
  var bbox = new THREE.Box3().setFromObject(model);
  var s = targetH / (bbox.max.y - bbox.min.y);
  model.scale.set(s, s, s);
  model.position.y = -bbox.min.y * s;
  model.rotation.y = Math.PI;
  return model;
}

// 取第一个动画（这些动物模型都只有 1-3 个剪辑）
function _firstClip(anims, prefer) {
  var i;
  if (prefer) {
    for (i = 0; i < anims.length; i++) {
      if (anims[i].name === prefer) return anims[i];
    }
  }
  return anims.length ? anims[0] : null;
}

function _addGroundNPC(model, clip, targetH, speed) {
  _prepModel(model, targetH);
  var group = new THREE.Group();
  group.add(model);
  scene.add(group);

  var mixer = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
  }

  var ang  = Math.random() * Math.PI * 2;
  var dist = 8 + Math.random() * 10;
  var nx = player.x + Math.sin(ang) * dist;
  var nz = player.z + Math.cos(ang) * dist;

  npcs.push({
    group: group, mixer: mixer,
    x: nx, y: _groundY(nx, nz), z: nz,
    yaw: Math.random() * Math.PI * 2,
    speed: speed,
    timer: 2 + Math.random() * 3
  });
}

function _addFlyNPC(model, clip, targetH) {
  _prepModel(model, targetH);
  var group = new THREE.Group();
  group.add(model);
  scene.add(group);

  var mixer = null;
  if (clip) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
  }

  flyNpcs.push({
    group: group, mixer: mixer,
    cx: player.x + (Math.random() - 0.5) * 20,
    cz: player.z + (Math.random() - 0.5) * 20,
    radius: 6 + Math.random() * 6,
    baseY: _groundY(player.x, player.z) + 8 + Math.random() * 6,
    angSpd: 0.4 + Math.random() * 0.3,
    ang: Math.random() * Math.PI * 2,
    phase: Math.random() * Math.PI * 2
  });
}

function spawnNPCs() {
  // 狐狸 ×2
  gltfLoader.load('assets/models/fox.glb', function (g) {
    _addGroundNPC(g.scene, _firstClip(g.animations, 'Walk'), 0.9, 1.5);
    gltfLoader.load('assets/models/fox.glb', function (g2) {
      _addGroundNPC(g2.scene, _firstClip(g2.animations, 'Walk'), 0.9, 1.8);
    });
  }, undefined, function () {});

  // 马 ×2
  gltfLoader.load('assets/models/horse.glb', function (g) {
    _addGroundNPC(g.scene, _firstClip(g.animations), 1.6, 2.2);
    gltfLoader.load('assets/models/horse.glb', function (g2) {
      _addGroundNPC(g2.scene, _firstClip(g2.animations), 1.6, 2.0);
    });
  }, undefined, function () {});

  // 鹦鹉 ×3（飞行）
  gltfLoader.load('assets/models/parrot.glb', function (g) {
    _addFlyNPC(g.scene, _firstClip(g.animations), 0.5);
    gltfLoader.load('assets/models/parrot.glb', function (g2) {
      _addFlyNPC(g2.scene, _firstClip(g2.animations), 0.5);
      gltfLoader.load('assets/models/parrot.glb', function (g3) {
        _addFlyNPC(g3.scene, _firstClip(g3.animations), 0.5);
      });
    });
  }, undefined, function () {});
}

function updateNPCs(dt) {
  var i, n, nx, nz, gy, tx, tz;

  // 地面漫游
  for (i = 0; i < npcs.length; i++) {
    n = npcs[i];

    n.timer -= dt;
    if (n.timer <= 0) {
      n.yaw  += (Math.random() - 0.5) * Math.PI;
      n.timer = 2 + Math.random() * 4;
    }

    // 前进方向 -Z（与玩家一致）
    nx = n.x - Math.sin(n.yaw) * n.speed * dt;
    nz = n.z - Math.cos(n.yaw) * n.speed * dt;
    gy = _groundY(nx, nz);

    // 落差超过 2 格或踩水 → 掉头
    if (Math.abs(gy - n.y) > 2 ||
        getBlock(Math.floor(nx), Math.floor(gy) - 1, Math.floor(nz)) === WATER) {
      n.yaw += Math.PI;
    } else {
      n.x = nx; n.z = nz;
      n.y += (gy - n.y) * Math.min(1, 10 * dt);
    }

    n.group.position.set(n.x, n.y, n.z);
    n.group.rotation.y = n.yaw;
    if (n.mixer) n.mixer.update(dt);
  }

  // 圆周飞行
  for (i = 0; i < flyNpcs.length; i++) {
    n = flyNpcs[i];
    n.ang += n.angSpd * dt;
    tx = n.cx + Math.cos(n.ang) * n.radius;
    tz = n.cz + Math.sin(n.ang) * n.radius;
    n.group.position.set(
      tx,
      n.baseY + Math.sin(n.ang * 2 + n.phase) * 1.5,  // 上下浮动
      tz
    );
    // 面向切线方向：速度 = (-sin(ang), cos(ang))，
    // 前进约定 -Z → (-sin(yaw), -cos(yaw))，解得 yaw = π - ang
    n.group.rotation.y = Math.PI - n.ang;
    if (n.mixer) n.mixer.update(dt);
  }
}
