// ─── combat_steer.js ──────────────────────────────────────────────────────────
// 转向层：朝目标移动 + 体素避障 + 单位分离（防互相堵塞，需求文档 §5/§8）。
//
// 避障：候选方向（目标向 + ±35°/±75°）逐个测试，取第一个 2.5m 内无实心方块的；
//   全堵则原方向减速蹭行。每个候选 5 次 getBlock 查表，开销可忽略。
// 上下坡：跟随地形列高度，差 ≤1 格直接走上（体素世界天然台阶）。

// ── 领地结界系统 ──────────────────────────────────────────────────────────────
// 每块领地石在放置时创建半径 12m 的保护圈；敌方无法进入该范围。
// 用紫色线框 BoxHelper 标注边界（高度 10m，视觉提示）。

var _territoryList = [];   // [{cx,cz,r,mesh}]

function _addTerritory(bx, by, bz) {
  var R = 12;
  var H = 10;
  var cx = bx + 0.5, cz = bz + 0.5;
  var geo = new THREE.BoxGeometry(R * 2, H, R * 2);
  var edges = new THREE.EdgesGeometry(geo);
  var mat = new THREE.LineBasicMaterial({ color: 0x9333ea, transparent: true, opacity: 0.85 });
  var mesh = new THREE.LineSegments(edges, mat);
  mesh.position.set(cx, by + H / 2, cz);
  scene.add(mesh);
  _territoryList.push({ cx: cx, cz: cz, r: R, mesh: mesh });
}

function _removeTerritory(bx, by, bz) {
  var cx = bx + 0.5, cz = bz + 0.5, i;
  for (i = _territoryList.length - 1; i >= 0; i--) {
    var t = _territoryList[i];
    if (Math.abs(t.cx - cx) < 0.5 && Math.abs(t.cz - cz) < 0.5) {
      scene.remove(t.mesh);
      t.mesh.material.dispose();
      _territoryList.splice(i, 1);
      return;
    }
  }
}

// 判断 (x,z) 是否在任意领地保护范围内
function _inTerritory(x, z) {
  var i, t;
  for (i = 0; i < _territoryList.length; i++) {
    t = _territoryList[i];
    if (Math.abs(x - t.cx) <= t.r && Math.abs(z - t.cz) <= t.r) return true;
  }
  return false;
}

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

  // 领地结界：敌方不得进入保护区（直接停住，保持在边界外）
  if (u.side === 1 && _inTerritory(nx, nz)) return false;

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

// ── 硬碰撞解算（每帧，AI 移动之后、渲染同步之前）────────────────────────────
// 软分离力只在移动时生效；站定攻击的单位靠这里保证不重叠：
//   单位↔单位：圆形（半径 UNIT_R）两两推挤，各退一半
//   单位↔玩家：只推单位（不干扰玩家操作手感）
//   推挤不得进入实心方块/跌落悬崖（_tryShift 校验后才生效）
var UNIT_R = 0.45;

function _tryShift(u, sx, sz) {
  var nx = u.x + sx, nz = u.z + sz;
  var gy = _groundY(Math.floor(nx), Math.floor(nz));
  if (Math.abs(gy - u.y) > 1.2) return;                       // 落差过大：不推
  var head = getBlock(Math.floor(nx), Math.floor(u.y) + 1, Math.floor(nz));
  if (head !== AIR && head !== WATER) return;                 // 推进墙里：不推
  u.x = nx; u.z = nz;
  u.y += (gy - u.y) * 0.5;
}

function resolveUnitCollisions() {
  var n = combatUnits.length, i, j, a, b, dx, dz, d2, d, min, push;
  for (i = 0; i < n; i++) {
    a = combatUnits[i];
    if (a.state === 'DEAD') continue;

    for (j = i + 1; j < n; j++) {
      b = combatUnits[j];
      if (b.state === 'DEAD') continue;
      dx = b.x - a.x; dz = b.z - a.z;
      d2 = dx * dx + dz * dz;
      min = UNIT_R * 2;
      if (d2 >= min * min) continue;
      if (d2 < 0.0001) { dx = 0.02 * (i - j); dz = 0.017; d2 = dx * dx + dz * dz; }  // 完全重合：固定方向錯开
      d = Math.sqrt(d2);
      push = (min - d) * 0.5;
      dx /= d; dz /= d;
      _tryShift(a, -dx * push, -dz * push);
      _tryShift(b,  dx * push,  dz * push);
    }

    // 与玩家推挤（单方向：推单位）
    dx = a.x - player.x; dz = a.z - player.z;
    d2 = dx * dx + dz * dz;
    min = UNIT_R + 0.42;
    if (d2 < min * min && d2 > 0.0001) {
      d = Math.sqrt(d2);
      _tryShift(a, (dx / d) * (min - d), (dz / d) * (min - d));
    }
  }
}

// 面向某点（站立攻击时用）
function faceTo(u, tx, tz, dt) {
  var tyaw = Math.atan2(tx - u.x, tz - u.z);
  var dy = tyaw - u.yaw;
  while (dy > Math.PI)  dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  u.yaw += dy * Math.min(1, 12 * dt);
}
