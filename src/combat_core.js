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
    model.position.y = 1.4;     // 马背高度约为全高 2.2m 的 64%
    var hg = _armyGltf[t.mount];
    if (hg) {
      var horseModel = hg.scene.clone(true);
      _prepModel(horseModel, 2.2);
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
    horseMixer: horseMixer, hpBar: null,
  };
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
  if (u.state === 'DEAD') return;
  u.hp -= dmg;
  battleSfx(u.t.ranged ? 'atk_hit' : 'atk_clang');
  updateHpBar(u);
  if (u.hp <= 0) { killUnit(u); return; }
  // 受击硬直（攻击动作中不打断）
  if (u.actT <= 0) {
    playAnim(u, ANIM.hit, 0.08, true);
    u.actT = 0.45;
  }
  // 被打必还手：转火攻击者（玩家伪单位为持久对象，可直接作为目标）
  if (fromUnit && u.target !== fromUnit) u.target = fromUnit;
}

function killUnit(u) {
  u.state = 'DEAD';
  u.deadT = 0;
  u.target = null;
  playAnim(u, ANIM.death, 0.12, true);
  if (u.hpBar) { u.group.remove(u.hpBar); u.hpBar = null; }
  battleSfx('atk_hit');
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
