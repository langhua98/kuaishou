// ─── combat_steer.js ──────────────────────────────────────────────────────────
// 转向层：朝目标移动 + 体素避障 + 单位分离（防互相堵塞，需求文档 §5/§8）。
//
// 避障：候选方向（目标向 + ±35°/±75°）逐个测试，取第一个 2.5m 内无实心方块的；
//   全堵则原方向减速蹭行。每个候选 5 次 getBlock 查表，开销可忽略。
// 上下坡：跟随地形列高度，差 ≤1 格直接走上（体素世界天然台阶）。

function _dirClear(x, y, z, dx, dz) {
  var i, cx, cz;
  for (i = 1; i <= 5; i++) {
    cx = Math.floor(x + dx * i * 0.5);
    cz = Math.floor(z + dz * i * 0.5);
    var head = getBlock(cx, Math.floor(y) + 1, cz);   // 头高一格必须空
    if (head !== AIR && head !== WATER) return false;
  }
  return true;
}

// 朝 (tx,tz) 移动；返回实际是否在移动
function steerMove(u, tx, tz, spd, dt) {
  var dx = tx - u.x, dz = tz - u.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.05) return false;
  dx /= d; dz /= d;

  // 分离力：邻近同阵营单位排斥（平方反比近似）
  var i, o, ox, oz, od;
  for (i = 0; i < combatUnits.length; i++) {
    o = combatUnits[i];
    if (o === u || o.state === 'DEAD') continue;
    ox = u.x - o.x; oz = u.z - o.z;
    od = ox * ox + oz * oz;
    if (od < BTL.sepR * BTL.sepR && od > 0.0001) {
      od = Math.sqrt(od);
      dx += (ox / od) * (1 - od / BTL.sepR) * 1.4;
      dz += (oz / od) * (1 - od / BTL.sepR) * 1.4;
    }
  }
  var dl = Math.sqrt(dx * dx + dz * dz);
  dx /= dl; dz /= dl;

  // 避障：原方向 → ±35° → ±75°
  var ANG = [0, 0.61, -0.61, 1.31, -1.31];
  var best = null, a, ca, sa, ndx, ndz;
  for (i = 0; i < ANG.length; i++) {
    a = ANG[i]; ca = Math.cos(a); sa = Math.sin(a);
    ndx = dx * ca - dz * sa; ndz = dx * sa + dz * ca;
    if (_dirClear(u.x, u.y, u.z, ndx, ndz)) { best = [ndx, ndz]; break; }
  }
  var slow = 1;
  if (!best) { best = [dx, dz]; slow = 0.3; }   // 全堵：原方向慢速蹭

  var mv = Math.min(spd * slow * dt, d);
  var nx = u.x + best[0] * mv, nz = u.z + best[1] * mv;

  // 地形跟随：目标列地面高度差 ≤1.2 格可走，悬崖/高墙不走
  var gy = _groundY(Math.floor(nx), Math.floor(nz));
  if (gy - u.y <= 1.2 && u.y - gy <= 4) {
    u.x = nx; u.z = nz;
    u.y += (gy - u.y) * Math.min(1, 10 * dt);
  }

  // 朝向平滑转向移动方向
  var tyaw = Math.atan2(best[0], best[1]);
  var dy = tyaw - u.yaw;
  while (dy > Math.PI)  dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  u.yaw += dy * Math.min(1, 10 * dt);
  return true;
}

// 面向某点（站立攻击时用）
function faceTo(u, tx, tz, dt) {
  var tyaw = Math.atan2(tx - u.x, tz - u.z);
  var dy = tyaw - u.yaw;
  while (dy > Math.PI)  dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  u.yaw += dy * Math.min(1, 12 * dt);
}
