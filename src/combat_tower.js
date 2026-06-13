// ─── combat_tower.js ──────────────────────────────────────────────────────────
// 塔防系统：领地内可放置魔法塔。
// 敌方优先向塔移动并攻击；塔闪电束瞬发伤害范围内敌人；塔有 HP 可被摧毁。

var _towers = [];          // 活动防御塔列表
var _lightningBeams = [];  // 淡出中的闪电束 [{line,t,life}]
var _towerTime = 0;        // 动画累计时间

// 塔配置
var TOWER_CFG = {
  hp:      350,
  range:   22,      // 攻击半径（米）
  dmg:     15,
  atkCd:   1.5,     // 攻击间隔（秒）
  orbSpd:  14,
  h:       7.5,
};

// ── 程序化魔法塔 ──────────────────────────────────────────────────────────────
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

  grp.add(cyl(1.20, 1.55, 1.50, 32, matDark,  0.75));
  grp.add(cyl(1.28, 1.28, 0.22, 32, matStone, 1.55));
  grp.add(cyl(0.98, 1.22, 2.20, 32, matStone, 2.75));
  grp.add(cyl(1.06, 1.06, 0.22, 32, matDark,  3.86));
  grp.add(cyl(1.12, 1.00, 1.40, 32, matStone, 4.66));
  grp.add(cyl(1.28, 1.14, 0.50, 32, matDark,  5.61));

  // 12 个雉堞
  var bi, ba;
  for (bi = 0; bi < 12; bi++) {
    ba = (bi / 12) * Math.PI * 2;
    var cr = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.44, 0.22), matStone);
    cr.position.set(Math.cos(ba) * 1.12, 6.12, Math.sin(ba) * 1.12);
    grp.add(cr);
  }

  // 双锥菱形水晶（下移 0.5，嵌入顶台）
  var crystalTop = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.92, 6), matPurple);
  crystalTop.position.y = 6.62;
  var crystalBot = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.92, 6), matLilac);
  crystalBot.rotation.x = Math.PI;
  crystalBot.position.y = 5.94;
  grp.add(crystalTop);
  grp.add(crystalBot);

  // 大水平光环
  var ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.12, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xc084fc })
  );
  ring.rotation.x = Math.PI * 0.5;
  ring.position.y = 5.88;
  grp.add(ring);

  // 小倾斜光环（进动）
  var ring2 = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.08, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0x9333ea })
  );
  ring2.rotation.z = Math.PI / 3.5;
  ring2.position.y = 6.28;
  grp.add(ring2);

  // 水晶外发光球（BackSide 朝外辉光，透明脉冲）
  var glowSph = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.BackSide })
  );
  glowSph.position.y = 6.28;
  grp.add(glowSph);

  grp.userData.crystal  = crystalTop;
  grp.userData.crystal2 = crystalBot;
  grp.userData.ring     = ring;
  grp.userData.ring2    = ring2;
  grp.userData.glow     = glowSph;
  return grp;
}

// ── 放置防御塔 ────────────────────────────────────────────────────────────────
function placeTower(tx, tz, silent) {
  var grp = _makeProcTower();
  var gy = _groundY(Math.floor(tx), Math.floor(tz));
  grp.position.set(tx, gy, tz);
  scene.add(grp);

  var tower = {
    x: tx, y: gy, z: tz,
    hp: TOWER_CFG.hp, maxHp: TOWER_CFG.hp,
    atkCd: Math.random() * TOWER_CFG.atkCd,
    group: grp, dead: false,
    hpBar: null, _hpCv: null, _hpTex: null,
  };
  _makeTowerHpBar(tower);
  _towers.push(tower);
  if (!silent) {
    battleToast('⚗️ 魔法塔已建立！');
    if (typeof saveGame === 'function') saveGame();
  }
  return tower;
}

// ── 塔血条 ────────────────────────────────────────────────────────────────────
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

// ── 闪电束攻击（瞬发伤害 + 0.12s 淡出线条）────────────────────────────────────
function _shootLightning(tower, tgt) {
  battleSfx('atk_bow');

  // 瞬发伤害
  damageUnit(tgt, TOWER_CFG.dmg, null);

  var sx = tower.x, sy = tower.y + TOWER_CFG.h * 0.90, sz = tower.z;
  var ex = tgt.x, ey = tgt.y + (tgt.t ? tgt.t.h * 0.5 : 1), ez = tgt.z;

  // 命中粒子迸溅
  if (typeof spawnBurst === 'function') {
    spawnBurst(ex, ey, ez, { count: 16, color: 0xc084fc, speed: 5, size: 0.18, life: 0.5, up: 0.4 });
  }

  // 闪电线条（淡紫色）
  var pts = [new THREE.Vector3(sx, sy, sz), new THREE.Vector3(ex, ey, ez)];
  var geo = new THREE.BufferGeometry().setFromPoints(pts);
  var mat = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 1.0 });
  var line = new THREE.Line(geo, mat);
  scene.add(line);
  _lightningBeams.push({ line: line, t: 0, life: 0.12 });
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
    if (typeof spawnBurst === 'function') {
      spawnBurst(tower.x, tower.y + 2.5, tower.z, { count: 40, color: 0x9333ea, speed: 8, size: 0.3, life: 1.0, up: 0.4 });
      spawnBurst(tower.x, tower.y + 1.2, tower.z, { count: 30, color: 0x6b7280, speed: 5, size: 0.25, life: 1.2, up: 0.2 });
    }
    battleToast('🏚️ 魔法塔被摧毁！');
    if (typeof saveGame === 'function') saveGame();
  }
}

// ── 每帧更新（combat_ai.js combatUpdate 调用）────────────────────────────────
function updateTowers(dt) {
  _towerTime += dt;
  var i, j, tower, u, dx, dz, d2, best, bd;

  for (i = 0; i < _towers.length; i++) {
    tower = _towers[i];
    if (tower.dead) continue;
    // 水晶/光环动效
    if (tower.group.userData.crystal)  tower.group.userData.crystal.rotation.y  += dt * 1.5;
    if (tower.group.userData.crystal2) tower.group.userData.crystal2.rotation.y += dt * 1.5;
    if (tower.group.userData.ring)     tower.group.userData.ring.rotation.z     += dt * 0.8;
    if (tower.group.userData.ring2)    tower.group.userData.ring2.rotation.y    += dt * 2.2;
    // 发光球脉冲
    if (tower.group.userData.glow) {
      tower.group.userData.glow.material.opacity = 0.15 + 0.15 * Math.sin(_towerTime * 3.5 + i * 1.7);
    }
    tower.atkCd -= dt;
    if (tower.atkCd <= 0) {
      best = null; bd = TOWER_CFG.range * TOWER_CFG.range;
      for (j = 0; j < combatUnits.length; j++) {
        u = combatUnits[j];
        if (u.side !== 1 || u.state === 'DEAD') continue;
        dx = u.x - tower.x; dz = u.z - tower.z;
        d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = u; }
      }
      if (best) { _shootLightning(tower, best); tower.atkCd = TOWER_CFG.atkCd; }
    }
  }

  // 敌方近战打塔
  for (j = 0; j < combatUnits.length; j++) {
    u = combatUnits[j];
    if (u.side !== 1 || u.state === 'DEAD') continue;
    if ((u._towerAtkCd || 0) > 0) { u._towerAtkCd -= dt; continue; }
    for (i = 0; i < _towers.length; i++) {
      tower = _towers[i]; if (tower.dead) continue;
      dx = tower.x - u.x; dz = tower.z - u.z;
      if (dx * dx + dz * dz < 5.0) {
        damageTower(tower, u.t.dmg);
        u._towerAtkCd = u.t.atkCd * 0.9;
        if (u.actT <= 0) {
          playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.1, true);
          u.actT = 0.8;
          battleSfx('atk_clang');
        }
        break;
      }
    }
  }

  // 闪电束淡出
  for (i = _lightningBeams.length - 1; i >= 0; i--) {
    var b = _lightningBeams[i];
    b.t += dt;
    b.line.material.opacity = 1.0 - b.t / b.life;
    if (b.t >= b.life) {
      scene.remove(b.line);
      b.line.geometry.dispose();
      b.line.material.dispose();
      _lightningBeams.splice(i, 1);
    }
  }
}
