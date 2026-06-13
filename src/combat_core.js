// ─── combat_core.js ───────────────────────────────────────────────────────────
// 战斗单位层：模型加载、骨骼网格克隆、单位生成/动画/伤害/生死。
//
// 骨骼网格不能 mesh.clone()（骨骼引用会指向原骨架）——cloneSkinned() 为
// SkeletonUtils.clone 的精简实现：克隆节点树后按映射重绑骨架。
// 武器为静态 GLB，挂到 KayKit 骨架的 handslot.r / handslot.l 空节点上。

var combatUnits = [];        // 全部活动单位（含尸体，DEAD 超时后移除）
var _armyGltf = {};          // model 名 → gltf（含动画）
var _armyLoaded = false;
var _unitSeq = 1;

// ── 模型加载（首次开战时调用，含武器）─────────────────────────────────────────
function loadArmyModels(onDone, onProgress) {
  var models = {};
  var seen = {}, mounts = {};
  var names = [], k, t;
  for (k in UNIT_TYPES) {
    t = UNIT_TYPES[k];
    if (!seen[t.model]) { seen[t.model] = 1; names.push(t.model); }
    if (t.mount && !seen[t.mount]) { seen[t.mount] = 1; names.push(t.mount); mounts[t.mount] = 1; }
    if (t.wpnR && !seen[t.wpnR]) { seen[t.wpnR] = 1; names.push(t.wpnR); }
    if (t.wpnL && !seen[t.wpnL]) { seen[t.wpnL] = 1; names.push(t.wpnL); }
  }
  if (!seen['arrow']) names.push('arrow');
  var done = 0, total = names.length;
  names.forEach(function (n) {
    // 坐骑从 assets/models/ 加载，其余兵装从 assets/models/army/
    var path = mounts[n] ? 'assets/models/' + n + '.glb' : 'assets/models/army/' + n + '.glb';
    gltfLoader.load(path, function (g) {
      _armyGltf[n] = g;
      if (++done === total) { _armyLoaded = true; onDone(); }
      else if (onProgress) onProgress(done, total);
    }, undefined, function () {
      if (++done === total) { _armyLoaded = true; onDone(); }
    });
  });
}

// ── SkeletonUtils.clone 精简版 ────────────────────────────────────────────────
function _parallelTraverse(a, b, cb) {
  cb(a, b);
  for (var i = 0; i < a.children.length; i++) _parallelTraverse(a.children[i], b.children[i], cb);
}
function cloneSkinned(source) {
  var srcOf = new Map(), cloneOf = new Map();
  var clone = source.clone(true);
  _parallelTraverse(source, clone, function (s, c) { srcOf.set(c, s); cloneOf.set(s, c); });
  clone.traverse(function (node) {
    if (!node.isSkinnedMesh) return;
    var sm = srcOf.get(node);
    node.skeleton = sm.skeleton.clone();
    node.bindMatrix.copy(sm.bindMatrix);
    node.skeleton.bones = sm.skeleton.bones.map(function (b) { return cloneOf.get(b); });
    node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
}

// ── 单位生成 ──────────────────────────────────────────────────────────────────
function _attachWeapon(model, wpnName, slotName) {
  var g = _armyGltf[wpnName];
  if (!g) return;
  var slot = model.getObjectByName(slotName);
  if (!slot) return;
  slot.add(g.scene.clone(true));
}

function spawnUnit(kind, side, x, z) {
  var t = UNIT_TYPES[kind];
  var g = _armyGltf[t.model];
  if (!g) return null;

  var group = new THREE.Group();
  var model = cloneSkinned(g.scene);
  var horseMixer = null;

  if (t.cavalry) {
    // 骑兵：马在地面（2.2m 含头），骑手骑于马背（约 1.4m 处）
    _prepModel(model, 1.8);
    model.rotation.y = 0;   // KayKit 模型原生朝 +Z，_prepModel 的 π 翻转会倒着走——归零修正
    model.position.y = 1.4; // 骑手固定高度，不用 bbox 补偿
    var hg = _armyGltf[t.mount];
    if (hg) {
      var horseModel = hg.scene.clone(true);
      _prepModel(horseModel, 2.2);
      horseModel.rotation.y = 0;
      horseModel.position.y = 0; // KayKit origin 在脚底，bind-pose bbox 补偿无效
      group.add(horseModel);
      horseMixer = new THREE.AnimationMixer(horseModel);
      if (hg.animations.length > 0) {
        var hact = horseMixer.clipAction(hg.animations[0]);
        hact.setLoop(THREE.LoopRepeat, Infinity);
        hact.play();
      }
    }
  } else {
    _prepModel(model, t.h);
    model.rotation.y = 0;
    // KayKit 模型 origin 在脚底，bind-pose 包围盒补偿会因 T-pose 骨骼偏移造成悬浮，强制归零
    model.position.y = 0;
  }

  _attachWeapon(model, t.wpnR, 'handslot.r');
  if (t.wpnL) _attachWeapon(model, t.wpnL, 'handslot.l');
  group.add(model);

  var gy = _groundY(Math.floor(x), Math.floor(z));
  group.position.set(x, gy, z);
  scene.add(group);

  var mixer = new THREE.AnimationMixer(model);
  var anims = {}, i, c;
  for (i = 0; i < g.animations.length; i++) {
    c = g.animations[i];
    anims[c.name] = mixer.clipAction(c);
  }

  // 地面阴影圆饼（随 group 移动，不受 group 旋转影响）
  var shadowR = t.cavalry ? 0.85 : 0.55;
  var blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(shadowR, 10),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.30, depthWrite: false })
  );
  blobShadow.rotation.x = -Math.PI * 0.5;
  blobShadow.position.y = 0.03;
  group.add(blobShadow);

  var u = {
    id: _unitSeq++, side: side, kind: kind, t: t,
    x: x, y: gy, z: z, yaw: 0,
    vx: 0, vz: 0, speed: 0,
    hp: t.hp, atkCd: 0, actT: 0,
    state: side === 0 ? 'FOLLOW' : (t.cavalry ? 'SCAN' : 'SEEK'),
    stateT: 0, target: null, nextDecide: 0, nextScore: 0,
    deadT: 0, cheering: false, cheerT: 0,
    chargeFrom: null, breakDir: null, regroupT: 0,
    group: group, model: model, mixer: mixer, anims: anims, curAnim: '',
    horseMixer: horseMixer, hpBar: null, blobShadow: blobShadow,
  };
  if (typeof initMorale === 'function') initMorale(u);   // 注入士气/恐惧/纪律
  playAnim(u, ANIM.idle, 0);
  makeHpBar(u);
  combatUnits.push(u);
  return u;
}

// ── 动画切换（同名去重 + crossFade；once=true 播完即停留末帧）──────────────────
function playAnim(u, name, fade, once) {
  if (u.curAnim === name) return;
  var next = u.anims[name];
  if (!next) return;
  var prev = u.anims[u.curAnim];
  u.curAnim = name;
  next.reset();
  if (once) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
  }
  if (prev && fade) {
    next.crossFadeFrom(prev, fade, false);
  }
  next.play();
}

// ── 伤害与死亡 ────────────────────────────────────────────────────────────────
function damageUnit(u, dmg, fromUnit) {
  if (u.isTower) {
    if (typeof damageTower === 'function' && u.towerRef && !u.towerRef.dead)
      damageTower(u.towerRef, dmg, fromUnit);
    return;
  }
  if (u.state === 'DEAD') return;
  u.passive = false;   // 被攻击后解除被动，开始自主反击
  // 盾牌格挡：持盾兵种 30% 概率减半伤害（自己攻击动作中举不起盾）
  var blocked = false;
  if (u.t.shield && u.actT <= 0 && Math.random() < 0.3) {
    blocked = true;
    dmg = Math.max(1, Math.ceil(dmg / 2));
  }
  u.hp -= dmg;
  battleSfx(blocked || !u.t.ranged ? 'atk_clang' : 'atk_hit');
  if (!blocked) battleSfx('enemy_hurt');
  updateHpBar(u);
  dmgFloat(u, dmg, fromUnit && fromUnit.isPlayer, blocked);
  if (u.hp <= 0) { killUnit(u); return; }
  if (blocked) {
    playAnim(u, ANIM.block, 0.06, true);
    u.actT = 0.4;
  } else if (u.actT <= 0) {
    // 受击硬直（攻击动作中不打断）
    playAnim(u, ANIM.hit, 0.08, true);
    u.actT = 0.45;
  }
  // 近战命中击退 0.5m（远程不击退；_tryShift 校验，不会推进墙/坠崖）
  if (fromUnit && !blocked) {
    var kx = u.x - fromUnit.x, kz = u.z - fromUnit.z;
    var kd = Math.sqrt(kx * kx + kz * kz);
    if (kd > 0.01 && kd < 4) _tryShift(u, (kx / kd) * 0.5, (kz / kd) * 0.5);
  }
  // 被单位打必还手；玩家免伤——被玩家打不转火（打不到玩家，追了也白追）
  if (fromUnit && !fromUnit.isPlayer && u.target !== fromUnit) u.target = fromUnit;
}

function killUnit(u) {
  if (typeof onUnitDeath === 'function') onUnitDeath(u);
  u.state = 'DEAD';
  u.deadT = 0;
  u.target = null;
  u.routing = false;
  playAnim(u, ANIM.death, 0.12, true);
  if (u.hpBar)     { u.group.remove(u.hpBar);     u.hpBar = null; }
  if (u.moraleBar) { u.group.remove(u.moraleBar); u.moraleBar = null; }
  battleSfx('enemy_death');
}

function _removeUnit(u) {
  scene.remove(u.group);
  u.model.traverse(function (n) {
    if (n.geometry && n.isSkinnedMesh) { /* 几何体共享自 gltf，不 dispose */ }
  });
  var i = combatUnits.indexOf(u);
  if (i >= 0) combatUnits.splice(i, 1);
}

// 阵营存活统计
function countAlive(side) {
  var n = 0, i;
  for (i = 0; i < combatUnits.length; i++) {
    if (combatUnits[i].side === side && combatUnits[i].state !== 'DEAD') n++;
  }
  return n;
}
