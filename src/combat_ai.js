// ─── combat_ai.js ─────────────────────────────────────────────────────────────
// 决策层：步兵/弓手 FSM + 总入口 combatUpdate(dt, now)。
// 状态：IDLE / FOLLOW / SEEK / FIGHT / HOLD / DEAD（P1，骑兵九状态见 P2）。
// 决策节流 0.2s（需求文档 §2）；移动/动画/攻击判定每帧。
//
// 我方命令（combat_cmd.js 写入 playerOrder）：
//   follow → FOLLOW 跟随玩家   charge → SEEK 自由索敌
//   hold   → HOLD 原地驻守     retreat → FOLLOW 且脱战（不再选目标）

var playerOrder = 'follow';

// 敌我目标选择：最近的存活敌对单位。玩家完全免伤——敌方永不索敌玩家本体。
// anyRange=true（冲锋命令）时不限索敌距离——否则敌人超过 28m 冲锋令毫无反应
function _pickTarget(u, anyRange) {
  var best = null, bd = anyRange ? Infinity : BTL.detectR * BTL.detectR, i, o, dx, dz, d;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o.side === u.side || o.state === 'DEAD') continue;
    dx = o.x - u.x; dz = o.z - u.z; d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// 命中朝向判定：攻击者必须面向目标 ±70°，被碰撞推得转了身就挥空
function _facingTo(u, t) {
  var dy = Math.atan2(t.x - u.x, t.z - u.z) - u.yaw;
  while (dy > Math.PI)  dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  return Math.abs(dy) < 1.22;
}

function _distTo(u, t) {
  var dx = t.x - u.x, dz = t.z - u.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// 方队跟随：所有待命盟友按矩形方阵站位（玩家身后），各有专属格子不扎堆。
// 站定后面向玩家，整齐待命。
function _followFormation(u, dt) {
  // 统计当前跟随/待命我方单位，按 id 排序取该单位的名次
  var allies = [], i, o;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o.side === 0 && o.state !== 'DEAD') allies.push(o.id);
  }
  allies.sort(function (a, b) { return a - b; });
  var rank = allies.indexOf(u.id), total = allies.length;

  var cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  var col  = rank % cols;
  var row  = Math.floor(rank / cols);
  var sep  = u.t.cavalry ? 2.8 : 2.2;   // 骑兵间距更大
  var localX = (col - (cols - 1) * 0.5) * sep;
  var localZ = (row + 1) * sep + 2.5;   // 跟在玩家身后

  // 旋转到玩家朝向的"身后"方向
  var sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
  // 玩家前向 F = (sinY, cosY)，右向 R = (cosY, -sinY)
  // 身后偏移 = -localZ * F + localX * R
  var wx = player.x - localZ * sinY + localX * cosY;
  var wz = player.z - localZ * cosY - localX * sinY;

  var dx = wx - u.x, dz = wz - u.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d > 0.9) {
    steerMove(u, wx, wz, d > 6 ? u.t.spd : u.t.spd * 0.5, dt);
    if (u.actT <= 0) playAnim(u, d > 6 ? ANIM.run : ANIM.walk, 0.2);
  } else {
    faceTo(u, player.x + sinY * 5, player.z + cosY * 5, dt);  // 面朝玩家前方
    if (u.actT <= 0) playAnim(u, u.cheering ? ANIM.cheer : ANIM.idle, 0.2);
  }
}

// ── 骑兵辅助函数 ──────────────────────────────────────────────────────────────

// 统计半径内指定阵营单位数（side 为 undefined 时统计所有）
function _countNear(u, radius, side) {
  var n = 0, i, o, dx, dz, r2 = radius * radius;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o === u || o.state === 'DEAD') continue;
    if (side !== undefined && o.side !== side) continue;
    dx = o.x - u.x; dz = o.z - u.z;
    if (dx * dx + dz * dz < r2) n++;
  }
  return n;
}

// 骑兵目标评分（需求文档 §4.3）
function _scoreTarget(u, enemy) {
  var score = SCORE_ENEMY[enemy.kind] || 40;
  var dx = enemy.x - u.x, dz = enemy.z - u.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 20) score += 20;
  else if (dist < 50) score += 10;
  else score -= 20;
  // 侧背加成：我方位于敌方背后/侧翼得分更高
  var toUs = Math.atan2(u.x - enemy.x, u.z - enemy.z);
  var rel = toUs - enemy.yaw;
  while (rel > Math.PI)  rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  var abs = Math.abs(rel);
  if (abs > Math.PI * 0.75)      score += 50;  // 背刺
  else if (abs > Math.PI * 0.3)  score += 30;  // 侧翼
  else                           score -= 30;  // 正面
  return score;
}

// 评分选最优目标（骑兵专用，替代 _pickTarget 的近距优先逻辑）
function _pickBestTarget(u, anyRange) {
  var best = null, bestScore = -Infinity;
  var detectR2 = anyRange ? Infinity : BTL.detectR * BTL.detectR;
  var i, o, dx, dz, score;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o.side === u.side || o.state === 'DEAD') continue;
    dx = o.x - u.x; dz = o.z - u.z;
    if (dx * dx + dz * dz > detectR2) continue;
    score = _scoreTarget(u, o);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

// 计算冲锋起始位置：目标侧背方 25~40m，偏向我方当前位置
function _pickChargePos(u, tgt) {
  var angles = [Math.PI, Math.PI * 0.75, -Math.PI * 0.75, Math.PI * 0.5, -Math.PI * 0.5, 0];
  var dist = CAV.chargeGoodDist;
  var best = null, bestScore = -Infinity;
  var i, a, px, pz, score, dx, dz;
  for (i = 0; i < angles.length; i++) {
    a = tgt.yaw + angles[i];
    px = tgt.x + Math.sin(a) * dist;
    pz = tgt.z + Math.cos(a) * dist;
    score = (5 - i) * 15;   // 靠后角度优先
    dx = px - u.x; dz = pz - u.z;
    score -= Math.sqrt(dx * dx + dz * dz) * 0.4;  // 距我方越近越好
    if (score > bestScore) { bestScore = score; best = { x: px, z: pz }; }
  }
  return best;
}

// 计算撤离方向：选敌军最少的方向
function _calcBreakDir(u) {
  var best = { x: 0, z: 1 }, minEn = Infinity;
  var i, a, dirx, dirz, score, j, o, ex, ez;
  for (i = 0; i < 8; i++) {
    a = (i / 8) * Math.PI * 2;
    dirx = Math.sin(a); dirz = Math.cos(a);
    score = 0;
    for (j = 0; j < combatUnits.length; j++) {
      o = combatUnits[j];
      if (o.side === u.side || o.state === 'DEAD') continue;
      ex = o.x - u.x; ez = o.z - u.z;
      if (ex * dirx + ez * dirz > 0) score++;
    }
    if (score < minEn) { minEn = score; best = { x: dirx, z: dirz }; }
  }
  return best;
}

// ── 骑兵九状态 FSM（需求文档 §3）────────────────────────────────────────────
function _aiCavalry(u, dt, now) {
  u.stateT += dt;
  if (u.atkCd > 0) u.atkCd -= dt;
  if (u.actT > 0)  u.actT -= dt;
  if (u.cheering) {
    u.cheerT -= dt;
    if (u.cheerT <= 0) { u.cheering = false; if (u.side === 0) u.state = 'FOLLOW'; }
  }

  if (u.state === 'DEAD') {
    u.deadT += dt;
    if (u.deadT > BTL.corpseT) _removeUnit(u);
    return;
  }

  // 待结算伤害（同步 MELEE 帧判定）
  if (u._pendHit && u.actT <= u._pendHitAt) {
    var tg = u._pendHit; u._pendHit = null;
    // 判定帧三重检查：目标存活、仍在攻击距离内、攻击者面向目标（±70°）
    if (!tg.isPlayer && tg.state !== 'DEAD' &&
        _distTo(u, tg) < u.t.range + 0.6 && _facingTo(u, tg)) {
      damageUnit(tg, u.t.dmg, u);
    }
  }

  var t = u.t, tgt = u.target, d;

  // 0.2s 决策节流
  if (now >= u.nextDecide) {
    u.nextDecide = now + CAV.scanIv * 0.4;  // 0.2s
    if (u.target && !u.target.isPlayer && u.target.state === 'DEAD') { u.target = null; tgt = null; }

    // 触发撤退（§4.7）
    if (u.state !== 'RETREAT' && u.state !== 'DEAD') {
      var hpRatio = u.hp / t.hp;
      var nearEn = _countNear(u, 12, 1 - u.side);
      if (hpRatio <= CAV.retreatHp || (nearEn >= CAV.retreatOutnum && hpRatio < 0.5)) {
        u.state = 'RETREAT'; u.stateT = 0; u.target = null;
        return;
      }
    }

    // 我方命令（hold/retreat 强制覆盖任何战斗状态；follow/charge 需先解除 HOLD）
    if (u.side === 0) {
      if (playerOrder === 'hold')         { if (u.state !== 'HOLD') { u.state = 'HOLD'; u.target = null; } }
      else if (playerOrder === 'retreat') { u.state = 'FOLLOW'; u.target = null; }
      else {
        if (u.state === 'HOLD') { u.state = 'FOLLOW'; u.target = null; }
        if (!u.target) { u.target = _pickBestTarget(u, playerOrder === 'charge'); tgt = u.target; }
        if (u.target && (u.state === 'FOLLOW' || u.state === 'IDLE')) u.state = 'SCAN';
        else if (!u.target && (u.state === 'SCAN' || u.state === 'POSITION')) u.state = 'FOLLOW';
      }
    } else {
      if (!u.target) { u.target = _pickBestTarget(u); tgt = u.target; }
      if (u.target && u.state === 'IDLE') u.state = 'SCAN';
    }
  }

  // 0.5s 评分刷新
  if (now >= u.nextScore) {
    u.nextScore = now + CAV.scanIv;
    if (u.state === 'SCAN' || u.state === 'POSITION') {
      var nb = _pickBestTarget(u);
      if (nb) { u.target = nb; tgt = nb; }
    }
  }

  switch (u.state) {

    case 'FOLLOW':
      _followFormation(u, dt);
      break;

    case 'SCAN':
      if (!tgt) { u.target = _pickBestTarget(u); tgt = u.target; }
      if (!tgt) { u.state = u.side === 0 ? 'FOLLOW' : 'IDLE'; break; }
      // 目标太近凑不出冲锋助跑距离：直接近战，不绕去 40m 外起跑（观感像抗命）
      if (_distTo(u, tgt) < CAV.chargeMinDist) {
        u.state = 'MELEE'; u.stateT = 0;
      } else {
        u.chargeFrom = _pickChargePos(u, tgt);
        u.state = 'POSITION'; u.stateT = 0;
      }
      break;

    case 'POSITION':
      if (!tgt || tgt.state === 'DEAD') { u.state = 'SCAN'; u.chargeFrom = null; break; }
      if (!u.chargeFrom) u.chargeFrom = _pickChargePos(u, tgt);
      d = Math.sqrt((u.chargeFrom.x - u.x) * (u.chargeFrom.x - u.x) + (u.chargeFrom.z - u.z) * (u.chargeFrom.z - u.z));
      if (d < 4) {
        u.state = 'CHARGE'; u.stateT = 0; u.chargeFrom = null;
      } else {
        steerMove(u, u.chargeFrom.x, u.chargeFrom.z, t.spd * 0.75, dt);
        if (u.actT <= 0) playAnim(u, ANIM.run, 0.2);
      }
      break;

    case 'CHARGE':
      if (!tgt || tgt.state === 'DEAD') { u.state = 'SCAN'; u.vx = 0; u.vz = 0; break; }
      d = _distTo(u, tgt);
      // 加速冲向目标
      u.speed = Math.min(t.spd, (u.speed || 0) + t.spd * dt * 3);
      var ctx = tgt.x - u.x, ctz = tgt.z - u.z, cdd = Math.sqrt(ctx * ctx + ctz * ctz);
      if (cdd > 0.01) { u.vx = (ctx / cdd) * u.speed; u.vz = (ctz / cdd) * u.speed; }
      // 地形跟随移动；撞墙/悬崖累积停滞时间，>0.8s 判冲锋失败（需求文档 §4.4 速度跌破阈值）
      var cnx = u.x + u.vx * dt, cnz = u.z + u.vz * dt;
      var cgy = _groundY(Math.floor(cnx), Math.floor(cnz));
      if (cgy - u.y <= 1.5 && u.y - cgy <= 4) {
        u.x = cnx; u.z = cnz; u.y += (cgy - u.y) * Math.min(1, 10 * dt);
        u._stallT = 0;
      } else {
        u._stallT = (u._stallT || 0) + dt;
        if (u._stallT > 0.8) {
          u._stallT = 0; u.vx = 0; u.vz = 0; u.speed = 0;
          u.state = d < 8 ? 'MELEE' : 'SCAN'; u.stateT = 0;
          break;
        }
      }
      faceTo(u, tgt.x, tgt.z, dt);
      if (u.actT <= 0) playAnim(u, ANIM.run, 0.1);
      // 接触：冲锋伤害（速度越高伤害越大）
      if (d < t.range + 1.2) {
        if (tgt.state !== 'DEAD') {
          damageUnit(tgt, Math.round((t.chargeDmg || t.dmg * 2) * (u.speed / t.spd)), u);
        }
        battleSfx('atk_clang');
        u.state = 'MELEE'; u.stateT = 0;
        u.vx = 0; u.vz = 0; u.speed = 0;
      }
      break;

    case 'MELEE':
      if (!tgt || tgt.state === 'DEAD') { u.state = 'SCAN'; break; }
      // 持续时间/包围判定 → BREAKAWAY
      if (u.stateT > CAV.meleeMaxT || _countNear(u, 5, 1 - u.side) >= CAV.meleeCrowd) {
        u.state = 'BREAKAWAY'; u.stateT = 0;
        u.breakDir = _calcBreakDir(u); break;
      }
      d = _distTo(u, tgt);
      if (d > t.range * 1.8) {
        steerMove(u, tgt.x, tgt.z, t.spd * 0.6, dt);
        if (u.actT <= 0) playAnim(u, ANIM.run, 0.2);
      } else {
        faceTo(u, tgt.x, tgt.z, dt);
        if (u.atkCd <= 0 && u.actT <= 0) {
          playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.08, true);
          u.actT = 0.9; u.atkCd = t.atkCd;
          u._pendHit = tgt; u._pendHitAt = 0.9 - BTL.meleeDmgDelay;
          battleSfx('atk_swing');
        } else if (u.actT <= 0) {
          playAnim(u, ANIM.idle, 0.2);
        }
      }
      break;

    case 'BREAKAWAY':
      if (!u.breakDir) u.breakDir = _calcBreakDir(u);
      var bx = u.x + u.breakDir.x * CAV.breakFarDist;
      var bz = u.z + u.breakDir.z * CAV.breakFarDist;
      steerMove(u, bx, bz, t.spd, dt);
      if (u.actT <= 0) playAnim(u, ANIM.run, 0.1);
      if (u.stateT * t.spd > CAV.breakDist) {
        u.state = 'REGROUP'; u.stateT = 0; u.regroupT = 0; u.breakDir = null;
      }
      break;

    case 'REGROUP':
      u.regroupT += dt;
      if (u.actT <= 0) playAnim(u, ANIM.idle, 0.25);
      if (u.regroupT > CAV.regroupMaxT || _countNear(u, 20, u.side) >= 2) {
        u.target = null; u.state = 'SCAN'; u.stateT = 0;
      }
      break;

    case 'RETREAT':
      var re = _countNear(u, BTL.detectR, 1 - u.side);
      if (re === 0) { u.state = 'REGROUP'; u.stateT = 0; u.regroupT = 0; break; }
      // 朝远离重心方向全速逃跑
      var rcx = 0, rcz = 0, ri, ro;
      for (ri = 0; ri < combatUnits.length; ri++) {
        ro = combatUnits[ri];
        if (ro.side === u.side || ro.state === 'DEAD') continue;
        rcx += ro.x - u.x; rcz += ro.z - u.z;
      }
      if (re > 0) {
        steerMove(u, u.x - rcx / re * 10, u.z - rcz / re * 10, t.spd, dt);
      }
      if (u.actT <= 0) playAnim(u, ANIM.run, 0.1);
      break;

    case 'HOLD':
      if (tgt && _distTo(u, tgt) > t.range * 1.5) { u.target = null; tgt = null; }
      if (!tgt && now >= u.nextDecide - CAV.scanIv * 0.4 * 0.5) {
        u.target = _pickBestTarget(u); tgt = u.target;
      }
      if (tgt) {
        d = _distTo(u, tgt);
        faceTo(u, tgt.x, tgt.z, dt);
        if (d <= t.range && u.atkCd <= 0 && u.actT <= 0) {
          playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.08, true);
          u.actT = 0.9; u.atkCd = t.atkCd;
          u._pendHit = tgt; u._pendHitAt = 0.9 - BTL.meleeDmgDelay;
          battleSfx('atk_swing');
        } else if (u.actT <= 0) { playAnim(u, ANIM.idle, 0.2); }
      } else if (u.actT <= 0) { playAnim(u, ANIM.idle, 0.25); }
      break;

    default:   // IDLE
      if (u.actT <= 0) playAnim(u, u.cheering ? ANIM.cheer : ANIM.idle, 0.25);
  }
}

// ── 单位 FSM ─────────────────────────────────────────────────────────────────
function _aiUnit(u, dt, now) {
  // 骑兵走专属九状态 FSM
  if (u.t.cavalry) { _aiCavalry(u, dt, now); return; }
  u.stateT += dt;
  if (u.atkCd > 0) u.atkCd -= dt;
  if (u.actT > 0)  u.actT -= dt;
  // 胜利欢呼限时，结束后恢复跟随（否则永远站在原地）
  if (u.cheering) {
    u.cheerT -= dt;
    if (u.cheerT <= 0) { u.cheering = false; if (u.side === 0) u.state = 'FOLLOW'; }
  }

  // 死亡：动画播完保留尸体几秒后移除
  if (u.state === 'DEAD') {
    u.deadT += dt;
    if (u.deadT > BTL.corpseT) _removeUnit(u);
    return;
  }

  // 攻击动作中：判定帧结算伤害（_pendHit 由 FIGHT 设置）
  if (u._pendHit && u.actT <= u._pendHitAt) {
    var tg = u._pendHit; u._pendHit = null;
    // 判定帧三重检查：目标存活、仍在攻击距离内、攻击者面向目标（±70°）
    if (!tg.isPlayer && tg.state !== 'DEAD' &&
        _distTo(u, tg) < u.t.range + 0.6 && _facingTo(u, tg)) {
      damageUnit(tg, u.t.dmg, u);
    }
  }

  // 0.2s 决策节流：目标有效性检查 + 状态切换
  if (now >= u.nextDecide) {
    u.nextDecide = now + BTL.decideIv;
    if (u.target && !u.target.isPlayer && u.target.state === 'DEAD') u.target = null;

    if (u.side === 0) {
      // 我方按命令行事（hold/retreat 强制覆盖；follow/charge 需先解除 HOLD——
      // 否则按过驻守后单位永远卡在 HOLD 不听后续命令）
      if (playerOrder === 'hold')         { if (u.state !== 'HOLD') { u.state = 'HOLD'; u.target = null; } }
      else if (playerOrder === 'retreat') { u.state = 'FOLLOW'; u.target = null; }
      else {
        if (u.state === 'HOLD') { u.state = 'FOLLOW'; u.target = null; }
        // 跟随中遇敌就近反击（跟随≠挨打）；冲锋不限索敌距离
        if (!u.target) u.target = _pickTarget(u, playerOrder === 'charge');
        if (u.target) { if (u.state === 'FOLLOW' || u.state === 'IDLE') u.state = 'SEEK'; }
        else if (u.state === 'SEEK' || u.state === 'FIGHT') u.state = 'FOLLOW';
      }
    } else {
      if (!u.target) u.target = _pickTarget(u);
      u.state = u.target ? 'SEEK' : 'IDLE';
    }
  }

  // 行为执行（每帧）
  var t = u.t, tgt = u.target, d;
  switch (u.state) {

    case 'FOLLOW':
      _followFormation(u, dt);
      break;

    case 'SEEK':
      if (!tgt) { u.state = u.side === 0 ? 'FOLLOW' : 'IDLE'; break; }
      d = _distTo(u, tgt);
      if (t.ranged) {
        // 弓手：保持距离带，太近后撤、太远逼近，带内射击
        if (d > BTL.rangedFar)      { steerMove(u, tgt.x, tgt.z, t.spd, dt); if (u.actT <= 0) playAnim(u, ANIM.run, 0.2); }
        else if (d < BTL.rangedNear){ steerMove(u, u.x * 2 - tgt.x, u.z * 2 - tgt.z, t.spd, dt); if (u.actT <= 0) playAnim(u, ANIM.walk, 0.2); }
        else {
          faceTo(u, tgt.x, tgt.z, dt);
          if (u.actT <= 0) playAnim(u, ANIM.aim, 0.15);
          if (u.atkCd <= 0 && u.actT <= 0) {
            playAnim(u, ANIM.shoot, 0.1, true);
            u.actT = 0.8; u.atkCd = t.atkCd;
            shootArrow(u, tgt);
          }
        }
      } else {
        if (d > t.range) {
          steerMove(u, tgt.x, tgt.z, t.spd, dt);
          if (u.actT <= 0) playAnim(u, ANIM.run, 0.2);
        } else {
          u.state = 'FIGHT';
        }
      }
      break;

    case 'FIGHT':
      if (!tgt) { u.state = u.side === 0 ? 'FOLLOW' : 'IDLE'; break; }
      d = _distTo(u, tgt);
      if (d > t.range * 1.4) { u.state = 'SEEK'; break; }
      faceTo(u, tgt.x, tgt.z, dt);
      if (u.atkCd <= 0 && u.actT <= 0) {
        playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.08, true);
        u.actT = 0.9; u.atkCd = t.atkCd;
        u._pendHit = tgt; u._pendHitAt = 0.9 - BTL.meleeDmgDelay;   // 起手 0.45s 后结算
        battleSfx('atk_swing');
      } else if (u.actT <= 0) {
        playAnim(u, ANIM.idle, 0.2);
      }
      break;

    case 'HOLD':
      // 驻守：不移动，打进入射程的敌人（索敌走 0.2s 决策节流，不每帧扫）
      if (tgt && _distTo(u, tgt) > (t.ranged ? BTL.rangedFar : t.range * 1.2)) {
        u.target = null; tgt = null;
      }
      if (!tgt && now >= u.nextDecide - BTL.decideIv * 0.5) {
        u.target = _pickTarget(u);
        tgt = u.target;
      }
      if (tgt) {
        d = _distTo(u, tgt);
        faceTo(u, tgt.x, tgt.z, dt);
        if (t.ranged && d <= BTL.rangedFar && u.atkCd <= 0 && u.actT <= 0) {
          playAnim(u, ANIM.shoot, 0.1, true);
          u.actT = 0.8; u.atkCd = t.atkCd;
          shootArrow(u, tgt);
        } else if (!t.ranged && d <= t.range && u.atkCd <= 0 && u.actT <= 0) {
          playAnim(u, Math.random() < 0.5 ? ANIM.atk1 : ANIM.atk2, 0.08, true);
          u.actT = 0.9; u.atkCd = t.atkCd;
          u._pendHit = tgt; u._pendHitAt = 0.9 - BTL.meleeDmgDelay;
          battleSfx('atk_swing');
        } else if (u.actT <= 0) {
          playAnim(u, t.ranged ? ANIM.aim : ANIM.idle, 0.2);
        }
      } else if (u.actT <= 0) {
        playAnim(u, ANIM.idle, 0.25);
      }
      break;

    default:   // IDLE
      if (u.actT <= 0) playAnim(u, u.cheering ? ANIM.cheer : ANIM.idle, 0.25);
  }
}

// ── 总入口 ────────────────────────────────────────────────────────────────────
function combatUpdate(dt, now) {
  battleProgress();   // 胜负判定先行（即使单位清空也要能收尾，combat_cmd.js）
  updateFloats(dt);   // 伤害飘字（单位清空后残留的飘字也要播完）
  if (!combatUnits.length) return;
  var i, u;
  // 第一段：AI 决策与移动（可能更新 x/z）
  for (i = combatUnits.length - 1; i >= 0; i--) {
    _aiUnit(combatUnits[i], dt, now);
  }
  // 第二段：硬碰撞解算（单位↔单位、单位↔玩家，combat_steer.js）
  resolveUnitCollisions();
  // 第三段：同步渲染（碰撞修正后的最终位置）
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    u.group.position.set(u.x, u.y, u.z);
    u.group.rotation.y = u.yaw;
    u.mixer.update(dt);
    if (u.horseMixer) u.horseMixer.update(dt);
  }
  updateArrows(dt);
}
