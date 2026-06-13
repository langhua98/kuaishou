// ─── combat_steer.js ──────────────────────────────────────────────────────────
// 转向层：朝目标移动 + 体素避障 + 单位分离（防互相堵塞，需求文档 §5/§8）。
//
// 避障：候选方向（目标向 + ±35°/±75°）逐个测试，取第一个 2.5m 内无实心方块的；
//   全堵则原方向减速蹭行。每个候选 5 次 getBlock 查表，开销可忽略。
// 上下坡：跟随地形列高度，差 ≤1 格直接走上（体素世界天然台阶）。

// ── 领地结界系统 ──────────────────────────────────────────────────────────────
// 每块领地石放置时创建 R=25m 圆形穹顶保护圈；敌方无法进入。
// 半球形穹顶：内壁半透明 + 经纬线框 + 底部圆环，整体按周期自发光呼吸。

var _territoryList = [];   // [{cx,cz,r,mesh,meshOut,ring}]
var _territoryTime = 0;

function _addTerritory(bx, by, bz) {
  var R = 25;
  var cx = bx + 0.5, cz = bz + 0.5;

  var geoInner = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
  var matInner = new THREE.MeshBasicMaterial({
    color: 0x9333ea, transparent: true, opacity: 0.07,
    side: THREE.BackSide, depthWrite: false
  });
  var meshInner = new THREE.Mesh(geoInner, matInner);
  meshInner.position.set(cx, by, cz);
  scene.add(meshInner);

  var geoWire = new THREE.SphereGeometry(R * 1.005, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.5);
  var matWire = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.45 });
  var meshWire = new THREE.LineSegments(new THREE.WireframeGeometry(geoWire), matWire);
  meshWire.position.set(cx, by, cz);
  scene.add(meshWire);

  var geoRing = new THREE.TorusGeometry(R, 0.08, 6, 72);
  var matRing = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.6 });
  var meshRing = new THREE.Mesh(geoRing, matRing);
  meshRing.rotation.x = Math.PI * 0.5;
  meshRing.position.set(cx, by + 0.12, cz);
  scene.add(meshRing);

  _territoryList.push({ cx: cx, cz: cz, r: R,
    mesh: meshInner, meshOut: meshWire, ring: meshRing });
}

function _removeTerritory(bx, by, bz) {
  var cx = bx + 0.5, cz = bz + 0.5, i;
  for (i = _territoryList.length - 1; i >= 0; i--) {
    var t = _territoryList[i];
    if (Math.abs(t.cx - cx) < 0.5 && Math.abs(t.cz - cz) < 0.5) {
      scene.remove(t.mesh);    t.mesh.geometry.dispose();    t.mesh.material.dispose();
      scene.remove(t.meshOut); t.meshOut.geometry.dispose(); t.meshOut.material.dispose();
      if (t.ring) { scene.remove(t.ring); t.ring.geometry.dispose(); t.ring.material.dispose(); }
      _territoryList.splice(i, 1);
      return;
    }
  }
}

// 每帧动画（combat_ai.js combatUpdate 调用）
// 穹顶整体呼吸发光：慢速正弦 → 内壁/线框/底圈同步亮暗，感觉像在充放能量。
function updateTerritoryFx(dt) {
  _territoryTime += dt;
  var i, t, glow;
  for (i = 0; i < _territoryList.length; i++) {
    t = _territoryList[i];
    // 主呼吸：周期 ~3s（慢），相位随索引错开，感觉每个结界独立跳动
    glow = (Math.sin(_territoryTime * 2.1 + i * 1.9) + 1) * 0.5;   // 0→1→0
    t.mesh.material.opacity    = 0.03 + 0.12 * glow;    // 内壁：暗时几乎透明，亮时明显
    t.meshOut.material.opacity = 0.18 + 0.45 * glow;    // 线框：变化范围更大
    if (t.ring) t.ring.material.opacity = 0.35 + 0.55 * glow;  // 底圈：最亮时几乎不透明
  }
}

// 判断 (x,z) 是否在任意领地保护范围内（圆形精确判定）
function _inTerritory(x, z) {
  var i, t, dx, dz;
  for (i = 0; i < _territoryList.length; i++) {
    t = _territoryList[i];
    dx = x - t.cx; dz = z - t.cz;
    if (dx * dx + dz * dz <= t.r * t.r) return true;
  }
  return false;
}

// ── 空间哈希网格（O(n²)→O(n·邻居)，支撑大规模战场分离/碰撞）──────────────────
// 每帧重建一次：把活动单位按 2.5m 网格分桶。邻域查询只扫 3×3 桶，避免全表遍历。
var _CELL = 2.5;
var _grid = {};
var _nbrBuf = [];   // 复用缓冲，避免每次查询分配数组/闭包（GC 抖动是密集战场掉帧主因）

function _rebuildGrid() {
  _grid = {};
  var i, u, k;
  for (i = 0; i < combatUnits.length; i++) {
    u = combatUnits[i];
    if (u.state === 'DEAD') continue;
    k = Math.floor(u.x / _CELL) + ',' + Math.floor(u.z / _CELL);
    if (_grid[k]) _grid[k].push(u); else _grid[k] = [u];
  }
}

// 填充 _nbrBuf 为 (x,z) 半径内所有单位（含调用者自身，调用方自行排除），返回该缓冲
function _queryNeighbors(x, z, radius) {
  _nbrBuf.length = 0;
  var c = Math.ceil(radius / _CELL); if (c < 1) c = 1;
  var bx = Math.floor(x / _CELL), bz = Math.floor(z / _CELL), gx, gz, arr, i;
  for (gx = -c; gx <= c; gx++) for (gz = -c; gz <= c; gz++) {
    arr = _grid[(bx + gx) + ',' + (bz + gz)];
    if (!arr) continue;
    for (i = 0; i < arr.length; i++) _nbrBuf.push(arr[i]);
  }
  return _nbrBuf;
}

// ── 地形可走性（台阶感知）─────────────────────────────────────────────────────
// 从 fromY 出发，目标列 (nx,nz) 是否可站立：
//   抬升 ≤1 格可上（台阶），下落 ≤4 格可下（再深算悬崖不走），且站立格+头顶格无实心。
// 返回可站立的地面高度；不可走返回 null。
function _walkHeight(nx, nz, fromY) {
  var gx = Math.floor(nx), gz = Math.floor(nz);
  var gy = _groundY(gx, gz);
  if (gy - fromY > 1.05) return null;     // 高于 1 格：当墙挡住
  if (fromY - gy > 4) return null;        // 落差 >4 格：当悬崖不走
  var b0 = getBlock(gx, gy, gz);          // 站立格（脚部）
  var b1 = getBlock(gx, gy + 1, gz);      // 头顶格
  if ((b0 !== AIR && b0 !== WATER) || (b1 !== AIR && b1 !== WATER)) return null;
  return gy;
}

// 方向可走探测：沿 (dx,dz) 探 3 步，台阶高度逐步累进（楼梯可连续攀爬）
function _dirClear(x, y, z, dx, dz) {
  var i, gy, fromY = y;
  for (i = 1; i <= 3; i++) {
    gy = _walkHeight(x + dx * i * 0.6, z + dz * i * 0.6, fromY);
    if (gy === null) return false;
    fromY = gy;
  }
  return true;
}

// 朝 (tx,tz) 移动；返回本帧是否真的位移。
// 含：空间哈希分离力 + 台阶感知避障 + 绕行侧迟滞（贴墙绕路）+ 卡死检测与脱困。
var _STEER_OFF = [0, 0.5, 1.0, 1.6, 2.2, 2.8];   // 偏转角档位（绝对值，按 sign 取侧）

function steerMove(u, tx, tz, spd, dt) {
  var dx = tx - u.x, dz = tz - u.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.05) return false;
  dx /= d; dz /= d;

  // 分离力：3×3 桶邻域排斥（平方反比近似），仅扫附近单位
  var nbrs = _queryNeighbors(u.x, u.z, BTL.sepR), i, o, ox, oz, od, w;
  for (i = 0; i < nbrs.length; i++) {
    o = nbrs[i];
    if (o === u || o.state === 'DEAD') continue;
    ox = u.x - o.x; oz = u.z - o.z; od = ox * ox + oz * oz;
    if (od < BTL.sepR * BTL.sepR && od > 0.0001) {
      od = Math.sqrt(od); w = (1 - od / BTL.sepR) * 1.3;
      dx += (ox / od) * w; dz += (oz / od) * w;
    }
  }
  var dl = Math.sqrt(dx * dx + dz * dz);
  if (dl < 0.0001) { dx = (tx - u.x); dz = (tz - u.z); dl = Math.sqrt(dx*dx+dz*dz) || 1; }
  dx /= dl; dz /= dl;

  // 脱困绕行：被卡时强制走存储的垂直逃逸方向一小段
  if ((u._detourT || 0) > 0) { u._detourT -= dt; dx = u._detourDx; dz = u._detourDz; }

  // 避障：先直行，再按"上次成功绕行侧"优先逐档偏转，找第一个可走方向（贴墙绕路）
  var sign = u._turnSign || 1;
  var best = null, chosenA = 0, k, a, ca, sa, ndx, ndz, ti, tries;
  for (k = 0; k < _STEER_OFF.length; k++) {
    tries = (_STEER_OFF[k] === 0) ? [0] : [_STEER_OFF[k] * sign, -_STEER_OFF[k] * sign];
    for (ti = 0; ti < tries.length; ti++) {
      a = tries[ti]; ca = Math.cos(a); sa = Math.sin(a);
      ndx = dx * ca - dz * sa; ndz = dx * sa + dz * ca;
      if (_dirClear(u.x, u.y, u.z, ndx, ndz)) { best = [ndx, ndz]; chosenA = a; break; }
    }
    if (best) break;
  }

  var moved = false;
  if (best) {
    if (chosenA !== 0) u._turnSign = chosenA > 0 ? 1 : -1;   // 记住绕行侧，下帧延续
    var mv = Math.min(spd * dt, d);
    var nx = u.x + best[0] * mv, nz = u.z + best[1] * mv;
    // 领地结界：敌方不得进入（停在边界外）；否则按台阶高度落地，y 直接吸附地面
    if (!(u.side === 1 && _inTerritory(nx, nz))) {
      var gy = _walkHeight(nx, nz, u.y);
      if (gy !== null) { u.x = nx; u.z = nz; u.y = gy; moved = true; }
    }
    var tyaw = Math.atan2(best[0], best[1]);
    var dy = tyaw - u.yaw;
    while (dy > Math.PI)  dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    u.yaw += dy * Math.min(1, 10 * dt);
  }

  // 卡死检测：本帧推进 < 期望的 30% 累计停滞，>0.7s 触发一次垂直绕行脱困
  if (u._lastX === undefined) { u._lastX = u.x; u._lastZ = u.z; }
  var mdx = u.x - u._lastX, mdz = u.z - u._lastZ;
  var need = spd * dt * 0.3;
  if (mdx * mdx + mdz * mdz < need * need) u._stuckT = (u._stuckT || 0) + dt;
  else u._stuckT = 0;
  u._lastX = u.x; u._lastZ = u.z;
  if ((u._stuckT || 0) > 0.7 && (u._detourT || 0) <= 0) {
    u._stuckT = 0; u._detourT = 0.5;
    var s = (Math.random() < 0.5) ? 1 : -1;
    u._turnSign = s;
    var gx = tx - u.x, gz = tz - u.z, gl = Math.sqrt(gx * gx + gz * gz) || 1;
    gx /= gl; gz /= gl;
    u._detourDx = -gz * s; u._detourDz = gx * s;   // 垂直于目标方向，随机一侧
  }

  return moved;
}

// ── 硬碰撞解算（每帧，AI 移动之后、渲染同步之前）────────────────────────────
// 软分离力只在移动时生效；站定攻击的单位靠这里保证不重叠：
//   单位↔单位：圆形（半径 UNIT_R）两两推挤，各退一半
//   单位↔玩家：只推单位（不干扰玩家操作手感）
//   推挤不得进入实心方块/跌落悬崖（_tryShift 校验后才生效）
var UNIT_R = 0.45;

function _tryShift(u, sx, sz) {
  var nx = u.x + sx, nz = u.z + sz;
  var gy = _walkHeight(nx, nz, u.y);
  if (gy === null) return;        // 推进墙里/推下悬崖：不推
  u.x = nx; u.z = nz; u.y = gy;   // 地面直接吸附（与移动一致，杜绝悬浮/抖动）
}

// 硬碰撞解算：空间哈希 3×3 邻域逐对推挤（O(n·邻居)），单帧推力封顶抑制密集抖动
function resolveUnitCollisions() {
  _rebuildGrid();
  var n = combatUnits.length, i, a, b, nbrs, k, dx, dz, d2, d, push;
  var min = UNIT_R * 2, mm = min * min;
  for (i = 0; i < n; i++) {
    a = combatUnits[i];
    if (a.state === 'DEAD') continue;

    nbrs = _queryNeighbors(a.x, a.z, min);
    for (k = 0; k < nbrs.length; k++) {
      b = nbrs[k];
      if (b === a || b.state === 'DEAD' || b.id <= a.id) continue;   // 每对仅算一次（id 去重）
      dx = b.x - a.x; dz = b.z - a.z; d2 = dx * dx + dz * dz;
      if (d2 >= mm) continue;
      if (d2 < 0.0001) { dx = 0.02 * (a.id - b.id); dz = 0.017; d2 = dx * dx + dz * dz; }
      d = Math.sqrt(d2);
      push = (min - d) * 0.5;
      if (push > 0.25) push = 0.25;   // 单帧推力上限：防止爆冲来回弹（鬼畜）
      dx /= d; dz /= d;
      _tryShift(a, -dx * push, -dz * push);
      _tryShift(b,  dx * push,  dz * push);
    }

    // 与玩家推挤（单方向：推单位）
    dx = a.x - player.x; dz = a.z - player.z; d2 = dx * dx + dz * dz;
    var pm = UNIT_R + 0.42;
    if (d2 < pm * pm && d2 > 0.0001) {
      d = Math.sqrt(d2);
      push = pm - d; if (push > 0.3) push = 0.3;
      _tryShift(a, (dx / d) * push, (dz / d) * push);
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
