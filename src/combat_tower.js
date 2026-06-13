// ─── combat_tower.js ──────────────────────────────────────────────────────────
// 塔防系统：领地内可放置魔法塔。
// 敌方优先向塔移动并攻击；塔自动射出魔法弹伤害范围内敌人；塔有 HP 可被摧毁。

var _towers = [];          // 活动防御塔列表 [{x,y,z,hp,maxHp,atkCd,group,dead,...}]
var _towerOrbs = [];       // 飞行中的魔法弹

// 塔配置（程序化模型，无外部 GLB）
var TOWER_CFG = {
  hp:      150,
  range:   16,      // 攻击半径（米）
  dmg:     6,
  atkCd:   2.0,     // 攻击间隔（秒）
  orbSpd:  14,      // 魔法弹速度
  h:       7.5,     // 显示高度（HP 条用）
};

// ── 程序化魔法塔（升级版）────────────────────────────────────────────────────
// 32 段圆滑石柱塔身 + 双腰线装饰带 + 12 雉堞 + 双锥菱形水晶 + 双光环。
// 顶部水晶/光环存到 group.userData，updateTowers 每帧旋转做"充能"动效。
function _makeProcTower() {
  var grp = new THREE.Group();
  var matStone = new THREE.MeshPhongMaterial({ color: 0x6b7280, shininess: 28, specular: 0x222222 });
  var matDark  = new THREE.MeshPhongMaterial({ color: 0x4b5563, shininess: 18, specular: 0x111111 });
  var matPurple = new THREE.MeshBasicMaterial({ color: 0x9333ea });
  var matLilac  = new THREE.MeshBasicMaterial({ color: 0xc084fc });

  function cyl(rt, rb, h, seg, mat, y) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.y = y; return m;
  }

  grp.add(cyl(1.20, 1.55, 1.50, 32, matDark,  0.75));   // 塔基
  grp.add(cyl(1.28, 1.28, 0.22, 32, matStone, 1.55));   // 腰线 1
  grp.add(cyl(0.98, 1.22, 2.20, 32, matStone, 2.75));   // 塔身下段
  grp.add(cyl(1.06, 1.06, 0.22, 32, matDark,  3.86));   // 腰线 2
  grp.add(cyl(1.12, 1.00, 1.40, 32, matStone, 4.66));   // 塔身上段
  grp.add(cyl(1.28, 1.14, 0.50, 32, matDark,  5.61));   // 顶台

  // 12 个雉堞
  var bi, ba;
  for (bi = 0; bi < 12; bi++) {
    ba = (bi / 12) * Math.PI * 2;
    var cr = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.22), matStone);
    cr.position.set(Math.cos(ba) * 1.12, 6.12, Math.sin(ba) * 1.12);
    grp.add(cr);
  }

  // 双锥菱形水晶（上锥深紫 + 下锥淡紫）
  var crystalTop = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.92, 6), matPurple);
  crystalTop.position.y = 7.12;
  var crystalBot = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.92, 6), matLilac);
  crystalBot.rotation.x = Math.PI;
  crystalBot.position.y = 6.44;
  grp.add(crystalTop);
  grp.add(crystalBot);

  // 大水平光环（绕塔顶旋转）
  var ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.12, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xc084fc })
  );
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = 5.88;
  grp.add(ring);

  // 小倾斜光环（绕水晶旋转，进动效果）
  var ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.08, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0x9333ea })
  );
  ring2.rotation.z = Math.PI / 3.5;
  ring2.position.y = 6.78;
  grp.add(ring2);

  grp.userData.crystal  = crystalTop;
  grp.userData.crystal2 = crystalBot;
  grp.userData.ring     = ring;
  grp.userData.ring2    = ring2;
  return grp;
}

// ── 放置防御塔（同步，程序化）─────────────────────────────────────────────────
// silent=true：读档恢复时不弹提示、不触发再次存档。
function placeTower(tx, tz, silent) {
  var grp = _makeProcTower();
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
  if (!silent) {
    battleToast('⚗️ 魔法塔已建立！');
    if (typeof saveGame === 'function') saveGame();   // 立即落盘，防刷新丢塔
  }
  return tower;
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
    // 摧毁特效：紫色魔力炸裂 + 灰色碎石
    if (typeof spawnBurst === 'function') {
      spawnBurst(tower.x, tower.y + 2.5, tower.z, { count: 40, color: 0x9333ea, speed: 8, size: 0.3, life: 1.0, up: 0.4 });
      spawnBurst(tower.x, tower.y + 1.2, tower.z, { count: 30, color: 0x6b7280, speed: 5, size: 0.25, life: 1.2, up: 0.2 });
    }
    battleToast('🏚️ 魔法塔被摧毁！');
    if (typeof saveGame === 'function') saveGame();   // 塔没了，更新存档
  }
}

// ── 每帧更新（combat_ai.js combatUpdate 调用）────────────────────────────────
function updateTowers(dt) {
  var i, j, tower, u, dx, dz, d2, d, best, bd, orb;

  // 每座塔：扫描范围内敌人 → 射出魔法弹
  for (i = 0; i < _towers.length; i++) {
    tower = _towers[i];
    if (tower.dead) continue;
    // 顶部水晶/光环充能动效
    if (tower.group.userData.crystal)  tower.group.userData.crystal.rotation.y  += dt * 1.5;
    if (tower.group.userData.crystal2) tower.group.userData.crystal2.rotation.y += dt * 1.5;
    if (tower.group.userData.ring)     tower.group.userData.ring.rotation.z     += dt * 0.8;
    if (tower.group.userData.ring2)    tower.group.userData.ring2.rotation.y    += dt * 2.2;
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
    // 飞行拖尾（约 15Hz 一次）
    if (typeof spawnBurst === 'function') {
      orb._trailT = (orb._trailT || 0) + dt;
      if (orb._trailT > 0.066) {
        orb._trailT = 0;
        spawnBurst(orb.x, orb.y, orb.z, { count: 4, color: 0xc084fc, speed: 0.6, size: 0.1, life: 0.2, gravity: 1, up: 0 });
      }
    }

    var hit = false;
    if (orb.tgt && orb.tgt.state !== 'DEAD') {
      var ex = orb.tgt.x - orb.x;
      var ey = (orb.tgt.y + (orb.tgt.t ? orb.tgt.t.h * 0.5 : 1)) - orb.y;
      var ez = orb.tgt.z - orb.z;
      if (ex*ex + ey*ey + ez*ez < 0.9) {
        damageUnit(orb.tgt, orb.dmg, null);
        // 魔法弹命中：紫色魔力迸溅
        if (typeof spawnBurst === 'function')
          spawnBurst(orb.x, orb.y, orb.z, { count: 14, color: 0xc084fc, speed: 4, size: 0.18, life: 0.5, up: 0.3 });
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
