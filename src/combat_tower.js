// ─── combat_tower.js ──────────────────────────────────────────────────────────
// 塔防系统：领地内可放置魔法塔。
// 敌方优先向塔移动并攻击；塔自动射出魔法弹伤害范围内敌人；塔有 HP 可被摧毁。

var _towers = [];          // 活动防御塔列表 [{x,y,z,hp,maxHp,atkCd,group,dead,...}]
var _towerGltf = null;     // magic_tower.glb 缓存（异步加载）
var _towerLoaded = false;
var _towerOrbs = [];       // 飞行中的魔法弹

// 塔配置
var TOWER_CFG = {
  hp:      150,
  range:   16,      // 攻击半径（米）
  dmg:     6,
  atkCd:   2.0,     // 攻击间隔（秒）
  orbSpd:  14,      // 魔法弹速度
  h:       4.5,     // 显示高度（HP 条用）
  scale:   3.8,     // GLB 模型整体缩放（根据模型大小微调）
};

// ── 加载魔法塔 GLB ─────────────────────────────────────────────────────────────
function _loadTowerGltf(cb) {
  if (_towerLoaded) { cb(); return; }
  gltfLoader.load('assets/models/army/magic_tower.glb', function (g) {
    _towerGltf = g;
    _towerLoaded = true;
    cb();
  }, undefined, function () {
    // 加载失败：标记为已加载（使用程序化备用模型）
    _towerLoaded = true;
    cb();
  });
}

// ── 程序化备用塔（GLB 失败时）────────────────────────────────────────────────
function _makeProcTower() {
  var grp = new THREE.Group();
  // 底座圆柱
  var base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.2, 3.2, 8),
    new THREE.MeshLambertMaterial({ color: 0x3d2b1f })
  );
  base.position.y = 1.6;
  grp.add(base);
  // 中段细柱
  var mid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 1.0, 8),
    new THREE.MeshLambertMaterial({ color: 0x5a3e2c })
  );
  mid.position.y = 3.7;
  grp.add(mid);
  // 顶部魔法水晶（发光紫色八面体）
  var crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.65, 0),
    new THREE.MeshBasicMaterial({ color: 0x9333ea })
  );
  crystal.position.y = 4.5;
  grp.add(crystal);
  // 顶部光环
  var ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.07, 6, 16),
    new THREE.MeshBasicMaterial({ color: 0xc084fc })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 4.0;
  grp.add(ring);
  return grp;
}

// ── 放置防御塔 ────────────────────────────────────────────────────────────────
function placeTower(tx, tz) {
  _loadTowerGltf(function () {
    var grp = new THREE.Group();

    if (_towerGltf) {
      var model = _towerGltf.scene.clone(true);
      // 自动适配缩放
      var box = new THREE.Box3().setFromObject(model);
      var sz = box.getSize(new THREE.Vector3());
      var scl = TOWER_CFG.scale / Math.max(sz.x, sz.y, sz.z);
      model.scale.setScalar(scl);
      // 对齐底部到地面
      box.setFromObject(model);
      model.position.y = -box.min.y;
      grp.add(model);
    } else {
      grp.add(_makeProcTower());
    }

    var gy = _groundY(Math.floor(tx), Math.floor(tz));
    grp.position.set(tx, gy, tz);
    scene.add(grp);

    var tower = {
      x: tx, y: gy, z: tz,
      hp: TOWER_CFG.hp, maxHp: TOWER_CFG.hp,
      atkCd: Math.random() * TOWER_CFG.atkCd,  // 随机偏移防止同帧齐射
      group: grp, dead: false,
      hpBar: null, _hpCv: null, _hpTex: null,
    };
    _makeTowerHpBar(tower);
    _towers.push(tower);
    battleToast('⚗️ 魔法塔已建立！');
  });
}

// ── 塔血条（与单位血条相同风格，紫色）──────────────────────────────────────────
function _makeTowerHpBar(tower) {
  var cv = document.createElement('canvas');
  cv.width = 64; cv.height = 8;
  var tex = new THREE.CanvasTexture(cv);
  var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.4, 0.18, 1);
  spr.position.y = TOWER_CFG.h + 0.6;
  spr.renderOrder = 10;
  tower.group.add(spr);
  tower.hpBar = spr;
  tower._hpCv = cv; tower._hpTex = tex;
  _updateTowerHpBar(tower);
}

function _updateTowerHpBar(tower) {
  if (!tower.hpBar) return;
  var ctx = tower._hpCv.getContext('2d');
  var w = 64, h = 8, r = Math.max(0, tower.hp / tower.maxHp);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(1, 1, (w - 2) * r, h - 2);
  tower._hpTex.needsUpdate = true;
}

// ── 魔法弹 ────────────────────────────────────────────────────────────────────
function _shootOrb(tower, tgt) {
  battleSfx('atk_bow');
  var geo = new THREE.SphereGeometry(0.22, 8, 8);
  var mat = new THREE.MeshBasicMaterial({ color: 0x9333ea });
  var mesh = new THREE.Mesh(geo, mat);
  var sx = tower.x, sy = tower.y + TOWER_CFG.h * 0.88, sz = tower.z;
  var ex = tgt.x, ey = tgt.y + (tgt.t ? tgt.t.h * 0.5 : 1), ez = tgt.z;
  var dx = ex - sx, dy = ey - sy, dz = ez - sz;
  var dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  var spd = TOWER_CFG.orbSpd;
  mesh.position.set(sx, sy, sz);
  scene.add(mesh);
  _towerOrbs.push({
    mesh: mesh, x: sx, y: sy, z: sz,
    vx: (dx/dist)*spd, vy: (dy/dist)*spd, vz: (dz/dist)*spd,
    t: 0, life: dist/spd + 0.6, dmg: TOWER_CFG.dmg, tgt: tgt,
  });
}

// ── 塔受伤 ────────────────────────────────────────────────────────────────────
function damageTower(tower, dmg) {
  if (tower.dead) return;
  tower.hp -= dmg;
  _updateTowerHpBar(tower);
  dmgFloat({ x: tower.x, y: tower.y, z: tower.z, t: { h: TOWER_CFG.h } }, dmg, false, false);
  battleSfx('atk_hit');
  if (tower.hp <= 0) {
    tower.dead = true;
    scene.remove(tower.group);
    var i = _towers.indexOf(tower);
    if (i >= 0) _towers.splice(i, 1);
    battleToast('🏚️ 魔法塔被摧毁！');
  }
}

// ── 每帧更新（combat_ai.js combatUpdate 调用）────────────────────────────────
function updateTowers(dt) {
  var i, j, tower, u, dx, dz, d2, d, best, bd, orb;

  // 每座塔：扫描范围内敌人 → 射出魔法弹
  for (i = 0; i < _towers.length; i++) {
    tower = _towers[i];
    if (tower.dead) continue;
    tower.atkCd -= dt;
    if (tower.atkCd <= 0) {
      best = null; bd = TOWER_CFG.range * TOWER_CFG.range;
      for (j = 0; j < combatUnits.length; j++) {
        u = combatUnits[j];
        if (u.side !== 1 || u.state === 'DEAD') continue;
        dx = u.x - tower.x; dz = u.z - tower.z;
        d2 = dx*dx + dz*dz;
        if (d2 < bd) { bd = d2; best = u; }
      }
      if (best) { _shootOrb(tower, best); tower.atkCd = TOWER_CFG.atkCd; }
    }
  }

  // 敌方近战打塔（接触判定，不走单位 FSM）
  for (j = 0; j < combatUnits.length; j++) {
    u = combatUnits[j];
    if (u.side !== 1 || u.state === 'DEAD') continue;
    if ((u._towerAtkCd || 0) > 0) { u._towerAtkCd -= dt; continue; }
    for (i = 0; i < _towers.length; i++) {
      tower = _towers[i]; if (tower.dead) continue;
      dx = tower.x - u.x; dz = tower.z - u.z;
      if (dx*dx + dz*dz < 5.0) {   // 接触范围 ~2.2m
        damageTower(tower, u.t.dmg);
        u._towerAtkCd = u.t.atkCd * 0.9;
        // 触发攻击动画（不影响对单位的 atkCd）
        if (u.actT <= 0) {
          playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.1, true);
          u.actT = 0.8;
          battleSfx('atk_clang');
        }
        break;
      }
    }
  }

  // 更新魔法弹飞行
  for (i = _towerOrbs.length - 1; i >= 0; i--) {
    orb = _towerOrbs[i];
    orb.t += dt;
    orb.x += orb.vx * dt; orb.y += orb.vy * dt; orb.z += orb.vz * dt;
    orb.mesh.position.set(orb.x, orb.y, orb.z);
    orb.mesh.rotation.y += dt * 4;

    var hit = false;
    if (orb.tgt && orb.tgt.state !== 'DEAD') {
      var ex = orb.tgt.x - orb.x;
      var ey = (orb.tgt.y + (orb.tgt.t ? orb.tgt.t.h * 0.5 : 1)) - orb.y;
      var ez = orb.tgt.z - orb.z;
      if (ex*ex + ey*ey + ez*ez < 0.9) {
        damageUnit(orb.tgt, orb.dmg, null);
        hit = true;
      }
    } else if (!orb.tgt || orb.tgt.state === 'DEAD') {
      hit = true;
    }

    if (hit || orb.t > orb.life || orb.y < -5) {
      scene.remove(orb.mesh);
      orb.mesh.geometry.dispose(); orb.mesh.material.dispose();
      _towerOrbs.splice(i, 1);
    }
  }
}
