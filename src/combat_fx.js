// ─── combat_fx.js ─────────────────────────────────────────────────────────────
// 表现层：箭矢抛物线、血条 sprite、伤害飘字、战斗音效。
// 玩家完全免伤（指挥官模式）：敌方不索敌玩家、箭矢穿过玩家、无玩家 HP。

// ── 战斗音效（复用 audio.js 的 _playSfx 管线，组名在 audio.js _SFX 注册）──────
function battleSfx(group) {
  if (typeof _playSfx === 'function') _playSfx(group, 0.55, 0.9, 1.1);
}

// ── 血条（canvas sprite，仅血量变化时重绘）────────────────────────────────────
function makeHpBar(u) {
  var cv = document.createElement('canvas');
  cv.width = 64; cv.height = 8;
  var tex = new THREE.CanvasTexture(cv);
  var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.1, 0.14, 1);
  spr.position.y = u.t.h + 0.35;
  spr.renderOrder = 10;
  u.group.add(spr);
  u.hpBar = spr;
  u._hpCv = cv; u._hpTex = tex;
  updateHpBar(u);
}

function updateHpBar(u) {
  if (!u.hpBar) return;
  var ctx = u._hpCv.getContext('2d');
  var w = 64, h = 8, r = Math.max(0, u.hp / u.t.hp);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = u.side === 0 ? '#4ade80' : '#ef4444';
  ctx.fillRect(1, 1, (w - 2) * r, h - 2);
  u._hpTex.needsUpdate = true;
}

// ── 箭矢（对象池 + 重力抛物线，按飞行时间预瞄）─────────────────────────────────
var _arrows = [];
function shootArrow(u, tgt) {
  battleSfx('atk_bow');
  var g = _armyGltf['arrow'];
  var mesh;
  if (g) {
    mesh = g.scene.clone(true);
    mesh.scale.setScalar(1.4);
  } else {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.7),
      new THREE.MeshBasicMaterial({ color: 0x8a6a3a })
    );
  }
  var sx = u.x, sy = u.y + u.t.h * 0.75, sz = u.z;
  var dx = tgt.x - sx, dz = tgt.z - sz;
  var dist = Math.sqrt(dx * dx + dz * dz);
  var ft = dist / BTL.arrowSpd;                      // 飞行时间
  var ty = (tgt.isPlayer ? tgt.y + 1.2 : tgt.y + tgt.t.h * 0.6);
  var G = 14;
  var vx = dx / ft, vz = dz / ft;
  var vy = (ty - sy) / ft + 0.5 * G * ft;            // 抛物线补偿
  scene.add(mesh);
  _arrows.push({
    mesh: mesh, x: sx, y: sy, z: sz, vx: vx, vy: vy, vz: vz,
    t: 0, life: ft + 0.4, dmg: u.t.dmg, side: u.side, from: u,
  });
}

function updateArrows(dt) {
  var G = 14, i, a, j, o, dx, dy, dz;
  for (i = _arrows.length - 1; i >= 0; i--) {
    a = _arrows[i];
    a.t += dt;
    a.vy -= G * dt;
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    a.mesh.position.set(a.x, a.y, a.z);
    a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz);

    var hit = false;
    // 命中敌对单位（半径 0.7）。玩家免伤：箭矢直接穿过玩家
    for (j = 0; j < combatUnits.length; j++) {
      o = combatUnits[j];
      if (o.side === a.side || o.state === 'DEAD') continue;
      dx = o.x - a.x; dy = (o.y + o.t.h * 0.5) - a.y; dz = o.z - a.z;
      if (dx * dx + dy * dy + dz * dz < 0.5) { damageUnit(o, a.dmg, a.from); hit = true; break; }
    }
    // 入地/超时
    if (hit || a.t > a.life || getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z)) !== AIR) {
      scene.remove(a.mesh);
      _arrows.splice(i, 1);
    }
  }
}

// ── 伤害飘字（canvas sprite，命中点上方升起渐隐）──────────────────────────────
var _floats = [];
function dmgFloat(u, dmg, byPlayer, blocked) {
  var cv = document.createElement('canvas');
  cv.width = 96; cv.height = 40;
  var ctx = cv.getContext('2d');
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.fillStyle = blocked ? '#93c5fd' : (byPlayer ? '#fde047' : '#fff');
  var txt = (blocked ? '🛡' : '') + '-' + dmg;
  ctx.strokeText(txt, 48, 30);
  ctx.fillText(txt, 48, 30);
  var spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true,
  }));
  spr.scale.set(1.2, 0.5, 1);
  spr.position.set(u.x, u.y + u.t.h + 0.6, u.z);
  spr.renderOrder = 11;
  scene.add(spr);
  _floats.push({ spr: spr, t: 0 });
}

function updateFloats(dt) {
  var i, f;
  for (i = _floats.length - 1; i >= 0; i--) {
    f = _floats[i];
    f.t += dt;
    f.spr.position.y += dt * 1.2;
    f.spr.material.opacity = 1 - f.t / 0.8;
    if (f.t > 0.8) {
      scene.remove(f.spr);
      f.spr.material.map.dispose();
      f.spr.material.dispose();
      _floats.splice(i, 1);
    }
  }
}

// ── 玩家挥剑攻击：范围内最近敌人（game.js 破坏键调用，命中则不挖方块）──────
// 不做朝向限制——只要在 playerReach 半径内即可命中，手机操作不精准需要宽容度。
// side !== 1 保证绝对不会打中友军。
function tryPlayerAttack() {
  if (!combatUnits.length) return false;
  var best = null, bd = BTL.playerReach, i, u, dx, dz, d;
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    if (u.side !== 1 || u.state === 'DEAD') continue;   // 只打敌方，绝不打友军
    dx = u.x - player.x; dz = u.z - player.z;
    d = Math.sqrt(dx * dx + dz * dz);
    if (d < bd) { bd = d; best = u; }
  }
  if (!best) return false;
  damageUnit(best, BTL.playerDmg, _playerProxy());
  battleSfx('atk_swing');
  return true;
}

// 玩家伪单位（敌方 AI 与还手逻辑统一接口用）
var _playerProxyObj = { isPlayer: true, x: 0, y: 0, z: 0 };
function _playerProxy() {
  _playerProxyObj.x = player.x; _playerProxyObj.y = player.y; _playerProxyObj.z = player.z;
  return _playerProxyObj;
}

// ── 提示浮层 ──────────────────────────────────────────────────────────────────
var _toastEl = null, _toastTimer = null;
function battleToast(msg) {
  if (!_toastEl) {
    var ui = document.getElementById('ui') || document.body;
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = 'position:absolute;top:18%;left:50%;transform:translateX(-50%);' +
      'padding:10px 24px;background:rgba(0,0,0,.65);border-radius:10px;color:#fde047;' +
      'font:bold 18px monospace;z-index:130;transition:opacity .5s;pointer-events:none';
    ui.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.style.opacity = '1';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { _toastEl.style.opacity = '0'; }, 2200);
}
