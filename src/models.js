// ─── models.js ────────────────────────────────────────────────────────────────
// GLTF 模型加载：玩家角色 + NPC（狐狸）。
//
// 模型来源（均为 CC0/公有领域，提交在 assets/models/）：
//   robot.glb — RobotExpressive，Tomás Laulhé 制作（CC0），
//               动画：Idle / Walking / Running / Jump 等 14 个
//   fox.glb   — Fox，PixelMannen 制作（CC0，Khronos 官方样例），
//               动画：Survey / Walk / Run
//
// 加载策略：异步、不阻塞游戏启动。
//   玩家先用盒子占位模型（game.js 构建），robot.glb 加载完成后热替换。
//   狐狸 NPC 在模型就绪后才生成。
//
// 对外接口：
//   loadPlayerModel()       — 开始异步加载玩家模型（替换 playerGroup 内容）
//   playerAnim(name)        — 切换玩家动画（带 0.2s 淡入淡出）
//   playerMixer             — 玩家动画混合器（tick 中 update）
//   spawnNPCs() / updateNPCs(dt) — 狐狸生成与漫游 AI

var gltfLoader = new THREE.GLTFLoader();

// ── 玩家模型 ──────────────────────────────────────────────────────────────────
var playerMixer   = null;   // THREE.AnimationMixer，null = 模型未就绪
var _pActions     = {};     // name → AnimationAction
var _pCurrent     = '';     // 当前动画名

function loadPlayerModel() {
  gltfLoader.load('assets/models/robot.glb', function (gltf) {
    var model = gltf.scene;

    // 归一化身高到 PH（1.7）
    var bbox = new THREE.Box3().setFromObject(model);
    var s = PH / (bbox.max.y - bbox.min.y);
    model.scale.set(s, s, s);
    // 模型默认朝 +Z，游戏 yaw=0 时玩家朝 -Z → 转 180°
    model.rotation.y = Math.PI;

    // 移除盒子占位模型，挂载 GLTF
    while (playerGroup.children.length) playerGroup.remove(playerGroup.children[0]);
    playerGroup.add(model);

    playerMixer = new THREE.AnimationMixer(model);
    var i, c;
    for (i = 0; i < gltf.animations.length; i++) {
      c = gltf.animations[i];
      _pActions[c.name] = playerMixer.clipAction(c);
    }
    playerAnim('Idle');
  }, undefined, function () {
    // 加载失败：保留盒子模型，无动画
  });
}

// 切换玩家动画（同名重复调用为空操作）
function playerAnim(name) {
  if (!playerMixer || _pCurrent === name || !_pActions[name]) return;
  var prev = _pActions[_pCurrent];
  var next = _pActions[name];
  if (prev) prev.fadeOut(0.2);
  next.reset().fadeIn(0.2).play();
  _pCurrent = name;
}

// ── NPC：漫游的狐狸 ───────────────────────────────────────────────────────────
var NPC_COUNT = 3;
var npcs = [];  // { group, mixer, x, y, z, yaw, speed, timer }

function spawnNPCs() {
  gltfLoader.load('assets/models/fox.glb', function (gltf) {
    var i, src, model, mixer, walkClip, npc, ang;

    walkClip = null;
    for (i = 0; i < gltf.animations.length; i++) {
      if (gltf.animations[i].name === 'Walk') walkClip = gltf.animations[i];
    }

    for (i = 0; i < NPC_COUNT; i++) {
      // 每只狐狸独立 load 的开销大，改用 clone；
      // 狐狸是 SkinnedMesh，普通 clone 骨骼引用会错乱，
      // 但 r147 的 SkeletonUtils 不在 UMD 包里 → 简单起见首只用原模型，
      // 其余重复 gltfLoader.load（文件已被浏览器 HTTP 缓存，第二次加载几乎瞬时）
      if (i === 0) {
        _addFox(gltf.scene, walkClip);
      } else {
        gltfLoader.load('assets/models/fox.glb', (function () {
          return function (g2) {
            var wc = null, j;
            for (j = 0; j < g2.animations.length; j++) {
              if (g2.animations[j].name === 'Walk') wc = g2.animations[j];
            }
            _addFox(g2.scene, wc);
          };
        }()));
      }
    }
  }, undefined, function () { /* 加载失败：无 NPC */ });
}

function _addFox(model, walkClip) {
  // 狐狸原始模型很大（~100 单位），缩放到约 0.9 格高
  var bbox = new THREE.Box3().setFromObject(model);
  var s = 0.9 / (bbox.max.y - bbox.min.y);
  model.scale.set(s, s, s);
  // 模型头朝 +Z，前进约定为 -Z → 转 180°
  model.rotation.y = Math.PI;

  var group = new THREE.Group();
  group.add(model);
  scene.add(group);

  var mixer = null;
  if (walkClip) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(walkClip).play();
  }

  // 出生在玩家附近 8~16 格的随机方向
  var ang = Math.random() * Math.PI * 2;
  var dist = 8 + Math.random() * 8;
  var nx = player.x + Math.sin(ang) * dist;
  var nz = player.z + Math.cos(ang) * dist;

  npcs.push({
    group: group, mixer: mixer,
    x: nx, y: _groundY(nx, nz), z: nz,
    yaw: Math.random() * Math.PI * 2,
    speed: 1.2 + Math.random() * 0.8,
    timer: 2 + Math.random() * 3   // 距下次转向的秒数
  });
}

// 从高空往下找第一个实心方块顶面的 y
function _groundY(wx, wz) {
  var bx = Math.floor(wx), bz = Math.floor(wz), y, id;
  for (y = CHUNK_H - 1; y >= 0; y--) {
    id = getBlock(bx, y, bz);
    if (id !== AIR && id !== WATER) return y + 1;
  }
  return SEA + 2;
}

// 漫游 AI：直走 + 随机转向 + 贴地，遇水掉头
function updateNPCs(dt) {
  var i, n, nx, nz, gy;
  for (i = 0; i < npcs.length; i++) {
    n = npcs[i];

    n.timer -= dt;
    if (n.timer <= 0) {
      n.yaw  += (Math.random() - 0.5) * Math.PI;  // 随机偏转 ±90°
      n.timer = 2 + Math.random() * 4;
    }

    // 模型旋转后面朝 -Z 方向（与玩家一致的前进约定）
    nx = n.x - Math.sin(n.yaw) * n.speed * dt;
    nz = n.z - Math.cos(n.yaw) * n.speed * dt;
    gy = _groundY(nx, nz);

    // 前方落差超过 2 格或是水 → 掉头
    if (Math.abs(gy - n.y) > 2 ||
        getBlock(Math.floor(nx), Math.floor(gy) - 1, Math.floor(nz)) === WATER) {
      n.yaw += Math.PI;
    } else {
      n.x = nx; n.z = nz;
      n.y += (gy - n.y) * Math.min(1, 10 * dt);  // 平滑贴地
    }

    n.group.position.set(n.x, n.y, n.z);
    n.group.rotation.y = n.yaw;
    if (n.mixer) n.mixer.update(dt);
  }
}
