// ─── models.js ────────────────────────────────────────────────────────────────
// GLTF 模型加载：玩家角色（Steve）+ NPC（僵尸/狐狸/马/鹦鹉）。
//
// 模型来源（提交在 assets/models/）：
//   player.glb — Steve，hexianWeb/Third-Person-MC（MIT），
//                24 个动画：idle/forward/running_forward/jump/falling/出拳/潜行等
//   zombie.glb — 僵尸，同上（MIT），同套动画体系
//   fox.glb    — Fox，PixelMannen（CC0，Khronos 官方样例）
//   horse.glb  — Horse，three.js 示例（mirada/ro.me）
//   parrot.glb — Parrot，同上
//
// 加载策略：异步、不阻塞游戏启动。
//   玩家先用盒子占位（game.js 构建），player.glb 加载完成后热替换。
//   NPC 在各自模型就绪后才生成。
//
// 对外接口：
//   loadPlayerModel()  — 异步加载玩家模型
//   playerAnim(state)  — 切换玩家动画状态：'idle' | 'walk' | 'run' | 'jump' | 'fall'
//   playerMixer        — 玩家动画混合器（tick 中 update）
//   spawnNPCs() / updateNPCs(dt) — NPC 生成与 AI 更新

var gltfLoader = new THREE.GLTFLoader();

// ── 玩家模型 ──────────────────────────────────────────────────────────────────
var playerMixer = null;   // null = 模型未就绪
var _pActions   = {};     // 动画名(原始) → AnimationAction
var _pCurrent   = '';
var _playerModelScale = 1;   // loadPlayerModel 完成后写入，loadPlayerArms 复用

// ── 第一人称 GLB 手臂（player_arms.glb，仅含手臂网格）────────────────────
var _fpArmScene = null;
var _fpArmMixer = null;
var _fpArmAnims = {};

// 程序化骨骼动画（模型自带 0 动画时由代码驱动 idle/walk/run）
// D.Va 模型为 Unreal 骨骼，按名匹配四肢骨，每帧相对绑定姿势叠加旋转
var _procBones = {};      // 逻辑名 → THREE.Object3D（骨骼节点）
var _procBind  = {};      // 逻辑名 → 绑定姿势四元数
var _procState = 'idle';  // 当前动作
var _procT     = 0;       // 步态相位累加
var _procAmp   = 0;       // 行走幅度权重（0→1 平滑过渡）
var _procReady = false;
var _PROC_Q    = null;    // 复用临时四元数
// 同时兼容 Unreal（thigh_l）与 3ds Max Biped（Bip001_L_Thigh）命名
var _PROC_PAT  = {
  thighL: /^thigh_l_\d|Bip\d*_L_Thigh/i,    thighR: /^thigh_r_\d|Bip\d*_R_Thigh/i,
  calfL:  /^calf_l_\d|Bip\d*_L_Calf/i,      calfR:  /^calf_r_\d|Bip\d*_R_Calf/i,
  upperarmL: /^upperarm_l_\d|Bip\d*_L_UpperArm/i, upperarmR: /^upperarm_r_\d|Bip\d*_R_UpperArm/i,
  lowerarmL: /^lowerarm_l_\d|Bip\d*_L_Forearm/i,  lowerarmR: /^lowerarm_r_\d|Bip\d*_R_Forearm/i,
  spine:  /^spine_03_\d|Bip\d*_Spine1/i,    pelvis: /^pelvis_\d|Bip\d*_Pelvis/i
};

// 状态 → 可能的动画名（不同模型命名不同，按序取第一个存在的）
// 已扩充常见 Overwatch / Mixamo / Sketchfab 风格命名
var _ANIM_ALIAS = {
  idle:     ['idle', 'Idle', 'IDLE', 'stand', 'Stand', 'standing', 'TPose', 'T-Pose', 'tpose'],
  walk:     ['forward', 'walk', 'Walking', 'Walk', 'WALK', 'walking', 'move', 'Move', 'run'],
  run:      ['running_forward', 'run', 'Running', 'Run', 'RUN', 'sprint', 'Sprint', 'forward', 'walk', 'Walk'],
  jump:     ['jump', 'Jump', 'JUMP', 'jumping', 'Jumping', 'leap', 'Leap'],
  fall:     ['falling', 'Falling', 'fall', 'Fall', 'jump', 'Jump'],
  sit_down: ['sit_down', 'Stand_To_Sit', 'sit'],
  sitting:  ['sitting', 'Sitting', 'sit_idle'],
};

// 播放一次就停（不循环）的动画状态集合
var _ANIM_ONCE = { sit_down: true, jump: true, fall: true };

function loadPlayerModel() {
  gltfLoader.load('assets/models/player.glb', function (gltf) {
    var model = gltf.scene;

    // 归一化身高，脚底对齐 y=0。
    // 注意：蒙皮网格挂在 Armature(0.01 缩放) 下，geometry.boundingBox×matrixWorld
    // 会得到 0.01 空间的绑定盒（≈0.004，无意义）→ 缩放暴涨成上千米。
    // 几何体顶点本就以「米」为单位（头顶 y≈1.78），直接用原始 geometry.boundingBox
    // 即等于真实渲染高度（已无头 CPU 蒙皮实测验证）。
    model.updateMatrixWorld(true);
    var bbox = new THREE.Box3();
    model.traverse(function (o) {
      if (o.isSkinnedMesh || o.isMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        if (o.geometry.boundingBox) bbox.union(o.geometry.boundingBox);
      }
    });
    var bh = bbox.max.y - bbox.min.y;   // ≈ 1.78
    if (!(bh > 0.01)) bh = PH;   // 极端保底
    var s = PLAYER_MODEL_H / bh;
    _playerModelScale = s;   // 供 loadPlayerArms 使用相同比例
    model.scale.set(s, s, s);
    model.position.y = -bbox.min.y * s;
    // 模型默认朝 +Z，游戏前进方向为 -Z → 转 180°
    model.rotation.y = Math.PI;

    while (playerGroup.children.length) playerGroup.remove(playerGroup.children[0]);
    playerGroup.add(model);

    // 材质修正：GLB 为 PBR（metalness≈0.5），缺环境贴图时金属分量渲染为黑 →
    // 角色发暗、贴图色彩出不来。把金属度降到 0 让 albedo 在现有光照下正常显色，
    // 再注入中性灰 IBL（与赛道模型同处理）补一点环境高光。
    _fixPlayerMaterials(model);

    playerMixer = new THREE.AnimationMixer(model);
    var i;
    for (i = 0; i < gltf.animations.length; i++) {
      _lockRootMotion(gltf.animations[i]);   // 去除根骨水平位移，原地循环播放
      _pActions[gltf.animations[i].name] = playerMixer.clipAction(gltf.animations[i]);
    }

    // 检测是否存在可用的位移动画（idle/walk/run 别名命中）
    var hasLoco = false, ls, alias, k;
    var locoStates = ['idle', 'walk', 'run'];
    for (ls = 0; ls < locoStates.length && !hasLoco; ls++) {
      alias = _ANIM_ALIAS[locoStates[ls]];
      for (k = 0; k < alias.length; k++) { if (_pActions[alias[k]]) { hasLoco = true; break; } }
    }
    // 无可用位移动画（0 动画 或 仅有一段非标准片段）→ 程序化驱动四肢
    if (!hasLoco) _setupProcBones(model);

    playerAnim('idle');
    _registerSitTransition();

  }, undefined, function () { /* 加载失败：保留盒子占位 */ });
}

function loadPlayerArms() {
  gltfLoader.load('assets/models/player_arms.glb', function (gltf) {
    var model = gltf.scene;

    // 手臂模型与主角 player.glb 来自同一几何体坐标系，
    // 直接复用主模型的缩放比（_playerModelScale），不做高度归一化偏移。
    // 若主模型还未加载（竞态），用 PLAYER_MODEL_H/PH 作后备。
    var s = (_playerModelScale > 0.001) ? _playerModelScale : (PLAYER_MODEL_H / PH);
    model.scale.set(s, s, s);
    model.position.y = 0;

    _fixPlayerMaterials(model);

    // SkinnedMesh 挂在 camera 下时，包围球在世界空间判定会被错误剔除
    model.traverse(function (n) {
      if (n.isMesh || n.isSkinnedMesh) n.frustumCulled = false;
    });

    // 重绑骨架：clone 后 skeleton 仍指向原始骨骼节点，需重定向到 clone 内同名节点
    var boneMap = {};
    model.traverse(function (n) { if (n.name) boneMap[n.name] = n; });
    model.traverse(function (n) {
      if (!n.isSkinnedMesh) return;
      var nb = [], invs = [], bi;
      for (bi = 0; bi < n.skeleton.bones.length; bi++) {
        nb.push(boneMap[n.skeleton.bones[bi].name] || n.skeleton.bones[bi]);
        invs.push(n.skeleton.boneInverses[bi].clone());
      }
      n.skeleton = new THREE.Skeleton(nb, invs);
      n.bind(n.skeleton, n.bindMatrix);
    });

    // CF/吃鸡风格：模型朝 +Z（面向摄像机），rotation.y=0 确保左右手不镜像
    model.rotation.y = 0;

    // 定位到相机空间：仅前臂+手部出现在屏幕下方
    // · rotation.x = 0.8：把垂直向下(-Y)的手臂旋转约 46°，让其同时朝 -Z（入屏）—— 吃鸡视角
    // · scale = 0.38：控制手臂在屏幕中的大小
    // · position.y = -0.35：把模型原点（脚底）放在摄像机下方，手臂出现在屏幕下半部
    // · position.z = -0.50：手臂不遮挡中央视野
    var fpScale = 0.38;
    _fpArmScene = new THREE.Group();
    _fpArmScene.add(model);
    _fpArmScene.scale.set(fpScale, fpScale, fpScale);
    _fpArmScene.rotation.x = 0.8;
    _fpArmScene.position.set(0, -0.35, -0.50);
    _fpArmScene.visible = false;
    camera.add(_fpArmScene);

    // 独立 Mixer
    _fpArmMixer = new THREE.AnimationMixer(model);
    var i;
    for (i = 0; i < gltf.animations.length; i++) {
      _lockRootMotion(gltf.animations[i]);
      _fpArmAnims[gltf.animations[i].name] = _fpArmMixer.clipAction(gltf.animations[i]);
    }
    // 同步当前主角动画状态
    if (_pCurrent && _fpArmAnims[_pCurrent]) _fpArmAnims[_pCurrent].reset().play();

    // 延迟加载兼容：若已处于第一人称则立即显示
    if (typeof viewFP !== 'undefined' && viewFP) {
      _fpArmScene.visible = true;
      if (typeof armGroup  !== 'undefined') armGroup.visible  = false;
      if (typeof armGroupL !== 'undefined') armGroupL.visible = false;
    }
  });
}

// 去除剪辑的根运动。合并自 Mixamo 的 GLB 经 Blender 轴转换后，Hips 平移轨道数值
// 异常且方向错位（前后位移落在局部 Y 而非 Z），原地播放会从 A 点滑到 B 点。
// 直接整条删除 Hips 平移轨道：角色只靠关节旋转原地循环，Hips 回退到节点静止平移
// 定位（=正确身高）；竖直位移本就由物理 player.vy 驱动 playerGroup，不受影响。
function _lockRootMotion(clip) {
  var kept = [], t, tr;
  for (t = 0; t < clip.tracks.length; t++) {
    tr = clip.tracks[t];
    if (/Hips\.position$/i.test(tr.name)) continue;  // 丢弃 Hips 平移轨道
    kept.push(tr);
  }
  clip.tracks = kept;
}

// 让 PBR 玩家材质在体素场景灯光下正常显色（金属度归零 + 中性灰环境贴图）
var _playerEnvTex = null;
function _fixPlayerMaterials(model) {
  if (!_playerEnvTex && typeof renderer !== 'undefined' && renderer && THREE.PMREMGenerator) {
    var pm = new THREE.PMREMGenerator(renderer);
    var es = new THREE.Scene();
    es.background = new THREE.Color(0x999999);
    _playerEnvTex = pm.fromScene(es).texture;
    pm.dispose();
  }
  model.traverse(function (node) {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    var mats = Array.isArray(node.material) ? node.material : [node.material];
    for (var mi = 0; mi < mats.length; mi++) {
      var m = mats[mi];
      if (!m) continue;
      if (m.metalness !== undefined) m.metalness = 0.0;   // 角色非金属，让漫反射 albedo 显出来
      if (_playerEnvTex) { m.envMap = _playerEnvTex; m.envMapIntensity = 0.6; }
      m.needsUpdate = true;
    }
  });
}

// 切换玩家动画状态（同状态重复调用为空操作）
function playerAnim(state) {
  _procState = state;
  if (!playerMixer) return;
  var names = _ANIM_ALIAS[state] || [state], name = null, i;
  for (i = 0; i < names.length; i++) {
    if (_pActions[names[i]]) { name = names[i]; break; }
  }
  if (!name || _pCurrent === name) return;
  var prev = _pActions[_pCurrent];
  if (prev) prev.fadeOut(0.2);
  var action = _pActions[name];
  if (_ANIM_ONCE[state]) {
    // 一次性动画：播完后自动切到对应后续状态
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
  }
  action.reset().fadeIn(0.2).play();
  _pCurrent = name;
  // FP 手臂同步
  if (_fpArmMixer && _fpArmAnims[name]) {
    var fn;
    for (fn in _fpArmAnims) { if (_fpArmAnims[fn].isRunning()) _fpArmAnims[fn].fadeOut(0.2); }
    var fpAction = _fpArmAnims[name];
    if (_ANIM_ONCE[state]) {
      fpAction.setLoop(THREE.LoopOnce, 1);
      fpAction.clampWhenFinished = true;
    } else {
      fpAction.setLoop(THREE.LoopRepeat, Infinity);
    }
    fpAction.reset().fadeIn(0.2).play();
  }
}

// sit_down 播完后锁定玩家到座位并切 sitting 循环
// 由 loadPlayerModel 在 mixer 初始化后调用一次注册
function _registerSitTransition() {
  if (!playerMixer) return;
  playerMixer.addEventListener('finished', function (ev) {
    var action = ev.action;
    // 找到 sit_down 对应 action 名
    var sdName = null, k;
    for (k in _pActions) { if (_pActions[k] === action) { sdName = k; break; } }
    if (!sdName) return;
    // 检查是否属于 sit_down 别名
    var alias = _ANIM_ALIAS.sit_down || [];
    var isSitDown = false;
    for (var ai = 0; ai < alias.length; ai++) {
      if (alias[ai] === sdName) { isSitDown = true; break; }
    }
    if (!isSitDown) return;
    // 若玩家仍在坐着状态，锁定到座位坐标并切 sitting 循环
    if (typeof _sitting !== 'undefined' && _sitting &&
        typeof _sitTarget !== 'undefined' && _sitTarget) {
      player.x = _sitTarget.x;
      player.z = _sitTarget.z;
      // y: 保持当前物理高度（动画已让角色看起来坐下了）；
      //    _sitDip=0.45 会自动压低相机，不需要手动改 player.y
      player.vx = 0; player.vz = 0; player.vy = 0;
      playerAnim('sitting');
    }
  });
}

// 遍历模型，按名匹配四肢骨并记录绑定姿势四元数
function _setupProcBones(model) {
  _PROC_Q = new THREE.Quaternion();
  model.traverse(function (o) {
    if (!o.isBone && !o.isObject3D) return;
    var nm = o.name || '';
    for (var key in _PROC_PAT) {
      if (!_procBones[key] && _PROC_PAT[key].test(nm)) {
        _procBones[key] = o;
        _procBind[key] = o.quaternion.clone();
      }
    }
  });
  // 至少抓到双腿才启用（否则模型骨骼命名不符，跳过）
  _procReady = !!(_procBones.thighL && _procBones.thighR);
}

// 绕指定轴在绑定姿势上叠加旋转
function _procRot(key, ax, ay, az, ang) {
  var b = _procBones[key]; if (!b) return;
  _PROC_Q.setFromAxisAngle(_TMP_AXIS.set(ax, ay, az), ang);
  b.quaternion.copy(_procBind[key]).multiply(_PROC_Q);
}
var _TMP_AXIS = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;

// 每帧驱动程序化动画（game.js 在 playerMixer.update 后调用）
function updatePlayerProcAnim(dt) {
  if (!_procReady) return;
  // 目标行走幅度：idle=0，walk≈1，run≈1.7
  var target = (_procState === 'run') ? 1.7 : (_procState === 'walk') ? 1.0 : 0.0;
  _procAmp += (target - _procAmp) * Math.min(1, dt * 8);   // 平滑过渡
  // 相位推进：跑步更快
  var freq = (_procState === 'run') ? 11 : 8;
  _procT += dt * freq * (0.4 + 0.6 * Math.min(1, _procAmp));

  var ph = _procT;
  var amp = _procAmp;
  var swing = 0.5 * amp;                 // 大腿前后摆幅（弧度）
  var sL = Math.sin(ph), sR = Math.sin(ph + Math.PI);

  // 腿：左右反相前后摆（绕本地 X）
  _procRot('thighL', 1, 0, 0,  swing * sL);
  _procRot('thighR', 1, 0, 0,  swing * sR);
  // 小腿：腿后摆时屈膝（仅正向弯曲）
  _procRot('calfL', 1, 0, 0, -0.6 * amp * Math.max(0,  sL));
  _procRot('calfR', 1, 0, 0, -0.6 * amp * Math.max(0,  sR));
  // 手臂：与同侧腿反相摆动
  _procRot('upperarmL', 1, 0, 0, -0.4 * amp * sL);
  _procRot('upperarmR', 1, 0, 0, -0.4 * amp * sR);

  // 待机 / 整体：脊椎轻微呼吸晃动（idle 时仍有微动）
  var breathe = 0.04 * Math.sin(_procT * 0.5 + 1.0) * (1.0 - 0.5 * amp);
  _procRot('spine', 1, 0, 0, breathe);
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
// 两段测量：先按原始包围盒求缩放，应用缩放/旋转并刷新世界矩阵后，
// 再量一次缩放后的世界包围盒把脚底精确归零——单段测量在 GLTF 嵌套骨架/
// 世界矩阵未刷新时会得到偏低的 min.y，导致模型整体被抬高（悬空）。
function _prepModel(model, targetH) {
  model.updateMatrixWorld(true);
  var bbox = new THREE.Box3().setFromObject(model);
  var s = targetH / (bbox.max.y - bbox.min.y);
  model.scale.set(s, s, s);
  model.rotation.y = Math.PI;
  model.position.y = 0;
  model.updateMatrixWorld(true);
  bbox = new THREE.Box3().setFromObject(model);   // 缩放后世界空间脚底
  model.position.y = -bbox.min.y;                  // 脚底精确对齐 group 原点
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
  // 僵尸 ×2（缓慢徘徊，MC 标准身高 1.8）
  gltfLoader.load('assets/models/zombie.glb', function (g) {
    _addGroundNPC(g.scene, _firstClip(g.animations, 'forward'), 1.8, 0.7);
    gltfLoader.load('assets/models/zombie.glb', function (g2) {
      _addGroundNPC(g2.scene, _firstClip(g2.animations, 'forward'), 1.8, 0.8);
    });
  }, undefined, function () {});

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
