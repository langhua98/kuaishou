// ─── combat_ai.js ─────────────────────────────────────────────────────────────
// 决策层：步兵/弓手 FSM + 总入口 combatUpdate(dt, now)。
// 状态：IDLE / FOLLOW / SEEK / FIGHT / HOLD / DEAD（P1，骑兵九状态见 P2）。
// 决策节流 0.2s（需求文档 §2）；移动/动画/攻击判定每帧。
//
// 我方命令（combat_cmd.js 写入 playerOrder）：
//   follow → FOLLOW 跟随玩家   charge → SEEK 自由索敌
//   hold   → HOLD 原地驻守     retreat → FOLLOW 且脱战（不再选目标）

var playerOrder = 'follow';

// 敌我目标选择：最近的存活敌对单位；敌方还会考虑玩家本体
function _pickTarget(u) {
  var best = null, bd = BTL.detectR * BTL.detectR, i, o, dx, dz, d;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o.side === u.side || o.state === 'DEAD') continue;
    dx = o.x - u.x; dz = o.z - u.z; d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = o; }
  }
  if (u.side === 1) {
    dx = player.x - u.x; dz = player.z - u.z; d = dx * dx + dz * dz;
    if (d < bd && playerAlive()) { best = _playerProxy(); bd = d; }
  }
  return best;
}

function _distTo(u, t) {
  var dx = t.x - u.x, dz = t.z - u.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ── 单位 FSM ─────────────────────────────────────────────────────────────────
function _aiUnit(u, dt, now) {
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
    if (tg.isPlayer) {
      if (_distTo(u, _playerProxy()) < u.t.range + 0.6) damagePlayer(u.t.dmg);
    } else if (tg.state !== 'DEAD' && _distTo(u, tg) < u.t.range + 0.6) {
      damageUnit(tg, u.t.dmg, u);
    }
  }

  // 0.2s 决策节流：目标有效性检查 + 状态切换
  if (now >= u.nextDecide) {
    u.nextDecide = now + BTL.decideIv;
    if (u.target && !u.target.isPlayer && u.target.state === 'DEAD') u.target = null;

    if (u.side === 0) {
      // 我方按命令行事
      if (playerOrder === 'hold')         { if (u.state !== 'HOLD') { u.state = 'HOLD'; u.target = null; } }
      else if (playerOrder === 'retreat') { u.state = 'FOLLOW'; u.target = null; }
      else if (playerOrder === 'charge')  { if (u.state === 'FOLLOW' || u.state === 'IDLE') u.state = 'SEEK'; }
      else                                { if (u.state === 'SEEK' && !u.target) u.state = 'FOLLOW'; }
      // 跟随中遇敌就近反击（跟随≠挨打）；撤退命令下不反击
      if (playerOrder !== 'retreat' && !u.target) u.target = _pickTarget(u);
      if (u.target && playerOrder !== 'retreat' && u.state !== 'HOLD') u.state = 'SEEK';
    } else {
      if (!u.target) u.target = _pickTarget(u);
      u.state = u.target ? 'SEEK' : 'IDLE';
    }
  }

  // 行为执行（每帧）
  var t = u.t, tgt = u.target, d;
  switch (u.state) {

    case 'FOLLOW':
      d = Math.sqrt((player.x - u.x) * (player.x - u.x) + (player.z - u.z) * (player.z - u.z));
      if (d > BTL.followFar) {
        steerMove(u, player.x, player.z, t.spd, dt);
        if (u.actT <= 0) playAnim(u, d > BTL.followFar * 2 ? ANIM.run : ANIM.walk, 0.2);
      } else if (d < BTL.followNear) {
        steerMove(u, u.x + (u.x - player.x), u.z + (u.z - player.z), t.spd * 0.5, dt);
        if (u.actT <= 0) playAnim(u, ANIM.walk, 0.2);
      } else {
        if (u.actT <= 0) playAnim(u, u.cheering ? ANIM.cheer : ANIM.idle, 0.2);
      }
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
  if (!combatUnits.length) return;
  _playerProxy();     // 刷新玩家伪单位坐标（敌方把它当持久目标，防坐标过期）
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
  }
  updateArrows(dt);
}
