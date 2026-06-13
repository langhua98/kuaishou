// ─── combat_morale.js ─────────────────────────────────────────────────────────
// 士气层（士气=战争的"隐藏物理引擎"）。在 物理/战斗 之后、渲染 之前更新，
// 形成闭环：被冲锋/队友阵亡/被包围 → 士气↓ → morale<阈值 进入 ROUT 溃逃 →
//           溃逃者向邻近队友传播恐惧 → 一个跑→一片跑→连锁崩溃。
//
// 每单位三维心理量（spawnUnit 时 initMorale 注入）：
//   morale 士气 0-100   fear 恐惧 0-100   discipline 纪律（兵种固定，抗崩溃）
//
// 关键：AI 不直接判断"我要逃"，只读 u.routing 标志（updateMorale 写入）。

// 状态阈值（需求文档 §6.1）
var MORALE_ROUT = 20, MORALE_PRESSURE = 40, MORALE_UNEASY = 60, MORALE_CONFIDENT = 80;

// 士气更新节流 ~10Hz（需求文档 §10.3：Morale 10-20Hz）
var _moraleAccum = 0;
var _MORALE_IV = 0.1;

function _clampM(v) { return v < 0 ? 0 : (v > 100 ? 100 : v); }

// ── 士气条可视化 ──────────────────────────────────────────────────────────────
var _MORALE_COL = {
  CONFIDENT:        '#22c55e',  // 绿：高昂
  NORMAL:           '#84cc16',  // 草绿：正常
  UNEASY:           '#f59e0b',  // 橙：不安
  RETREAT_PRESSURE: '#ef4444',  // 红：压力后退
  ROUT:             '#a855f7',  // 紫：溃逃
};

function makeMoraleBar(u) {
  if (!u.group) return;
  var cv = document.createElement('canvas');
  cv.width = 48; cv.height = 4;
  var tex = new THREE.CanvasTexture(cv);
  var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(0.90, 0.08, 1);
  spr.position.y = u.t.h + 0.14;   // HP 条下方 0.21 世界单位
  spr.renderOrder = 10;
  u.group.add(spr);
  u.moraleBar = spr;
  u._moraleCv = cv; u._moraleTex = tex;
  _updateMoraleBar(u);
}

function _updateMoraleBar(u) {
  if (!u.moraleBar || u.morale === undefined) return;
  var ctx = u._moraleCv.getContext('2d');
  var w = 48, h = 4, r = u.morale / 100;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.40)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = _MORALE_COL[u.moraleState] || '#84cc16';
  ctx.fillRect(0, 0, w * r, h);
  u._moraleTex.needsUpdate = true;
}

// 初始化（combat_core.spawnUnit 调用）
function initMorale(u) {
  u.discipline  = (DISCIPLINE[u.kind] !== undefined) ? DISCIPLINE[u.kind] : 60;
  u.morale      = 70 + Math.random() * 20;   // 70~90
  u.fear        = 10 + Math.random() * 20;   // 10~30
  u.moraleState = 'NORMAL';
  u.routing     = false;
  makeMoraleBar(u);
}

// 士气数值 → 状态分层
function _moraleStateOf(m) {
  if (m >= MORALE_CONFIDENT) return 'CONFIDENT';
  if (m >= MORALE_UNEASY)    return 'NORMAL';
  if (m >= MORALE_PRESSURE)  return 'UNEASY';
  if (m >= MORALE_ROUT)      return 'RETREAT_PRESSURE';
  return 'ROUT';
}

// ── 事件钩子 ──────────────────────────────────────────────────────────────────

// 骑兵冲锋冲击（combat_ai CHARGE 命中时调用）：直击目标 + 命中点周围一片震慑
function onCavalryImpact(target, impact) {
  if (target.fear !== undefined) {
    target.fear   = _clampM(target.fear + impact * 0.8);
    target.morale = _clampM(target.morale - impact * 0.6);
  }
  // 冲击波及命中点 5m 内同阵营敌军（"骑兵冲一次 → 一片后退"）
  var i, o, dx, dz;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o === target || o.state === 'DEAD' || o.morale === undefined) continue;
    if (target.side !== undefined && o.side !== target.side) continue;
    dx = o.x - target.x; dz = o.z - target.z;
    if (dx * dx + dz * dz > 25) continue;
    o.fear   = _clampM(o.fear + impact * 0.3);
    o.morale = _clampM(o.morale - impact * 0.25);
  }
}

// 单位阵亡（combat_core.killUnit 调用）：10m 内同阵营士气↓恐惧↑，纪律高者抗性强
function onUnitDeath(dead) {
  if (dead.side === undefined) return;
  var i, o, dx, dz, d2, R2 = 100, k, resist;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o === dead || o.side !== dead.side || o.state === 'DEAD' || o.morale === undefined) continue;
    dx = o.x - dead.x; dz = o.z - dead.z; d2 = dx * dx + dz * dz;
    if (d2 > R2) continue;
    k = 1 - Math.sqrt(d2) / 10;                   // 越近影响越大
    resist = o.discipline / 100;
    o.morale = _clampM(o.morale - (3 + 5 * k) * (1.2 - resist * 0.5));
    o.fear   = _clampM(o.fear + (2 + 3 * k));
  }
}

// ── 溃逃移动（AI 在 u.routing 时调用，覆盖正常 FSM；不再扣计时器，FSM 已扣）──
function moraleFlee(u, dt) {
  var cx = 0, cz = 0, n = 0, i, o, dx, dz;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o.side === u.side || o.state === 'DEAD') continue;
    dx = o.x - u.x; dz = o.z - u.z;
    if (dx * dx + dz * dz < 900) { cx += dx; cz += dz; n++; }   // 30m 内敌军重心
  }
  var tx, tz;
  if (n > 0) { tx = u.x - (cx / n) * 8; tz = u.z - (cz / n) * 8; }
  else       { tx = u.x; tz = u.z + 8; }
  steerMove(u, tx, tz, u.t.spd * 1.05, dt);        // 逃跑略快于常速
  if (u.actT <= 0) playAnim(u, ANIM.run, 0.2);
}

// ── 每帧更新（combat_ai.combatUpdate 调用，节流 10Hz）────────────────────────
function updateMorale(dt) {
  _moraleAccum += dt;
  if (_moraleAccum < _MORALE_IV) return;
  var step = _moraleAccum;       // 实际经过时间（用于积分）
  _moraleAccum = 0;

  var i, u, j, o, dx, dz, d2, allies, enemies, dM, ns;

  // 第一轮：环境因素 + 恐惧衰减 + 状态分层
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    if (u.morale === undefined || u.state === 'DEAD') continue;

    allies  = _countNear(u, 8, u.side);
    enemies = _countNear(u, 8, 1 - u.side);

    dM = 0;
    dM += allies * 0.6 * step;             // 身边友军壮胆（§4.1）
    dM -= enemies * 0.8 * step;            // 被包围怯场（§4.2）
    if (enemies === 0) dM += 5 * step;     // 脱战恢复
    if (u.hp / u.t.hp < 0.35) dM -= 3 * step;   // 残血压力

    u.morale = _clampM(u.morale + dM);
    u.fear   = _clampM(u.fear - 5 * step);      // 恐惧自然衰减
    if (u.fear > 50) u.morale = _clampM(u.morale - (u.fear - 50) * 0.1 * step);

    ns = _moraleStateOf(u.morale);
    if (ns === 'ROUT' && !u.routing) {
      u.routing = true;
      u.target = null;
      if (typeof spawnBurst === 'function')   // 溃逃瞬间：白色恐惧气泡
        spawnBurst(u.x, u.y + u.t.h * 0.6, u.z,
          { count: 10, color: 0xe5e5e5, speed: 2, size: 0.12, life: 0.7, up: 0.9 });
    } else if (u.routing && u.morale > MORALE_ROUT + 12) {
      u.routing = false;       // 回血迟滞（+12 缓冲），避免在阈值处抖动
    }
    u.moraleState = ns;
    _updateMoraleBar(u);   // 每 10Hz tick 刷新进度 + 颜色
  }

  // 第二轮：溃逃者向 10m 内同阵营传播恐惧（连锁崩溃，§8.2）
  // 单独成轮，避免本轮新崩的单位在同一遍里二次级联放大
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    if (u.morale === undefined || u.state === 'DEAD' || u.moraleState !== 'ROUT') continue;
    for (j = 0; j < combatUnits.length; j++) {
      o = combatUnits[j];
      if (o === u || o.side !== u.side || o.state === 'DEAD' || o.morale === undefined) continue;
      dx = o.x - u.x; dz = o.z - u.z; d2 = dx * dx + dz * dz;
      if (d2 > 100) continue;
      o.morale = _clampM(o.morale - 10 * step);
      o.fear   = _clampM(o.fear + u.fear * 0.15 * step);
    }
  }
}
