// ─── combat_steer.js ──────────────────────────────────────────────────────────
// 转向层：朝目标移动 + 体素避障 + 单位分离（防互相堵塞，需求文档 §5/§8）。
//
// 避障：候选方向（目标向 + ±35°/±75°）逐个测试，取第一个 2.5m 内无实心方块的；
//   全堵则原方向减速蹭行。每个候选 5 次 getBlock 查表，开销可忽略。
// 上下坡：跟随地形列高度，差 ≤1 格直接走上（体素世界天然台阶）。

// ── 领地结界系统 ──────────────────────────────────────────────────────────────
// 每块领地石放置时创建 R=25m 圆形穹顶保护圈；敌方无法进入。
// 半球形穹顶：内壁半透明 + 经纬线框 + 底部圆环 + 脉冲动画。

var _territoryList = [];   // [{cx,cz,r,mesh,meshOut,ring,pulseRing,pulseT,pulseFrac}]
var _territoryTime = 0;    // 动画时间（updateTerritoryFx 累加）

function _addTerritory(bx, by, bz) {
  var R = 25;
  var cx = bx + 0.5, cz = bz + 0.5;

  // 穹顶内壁（半透明紫色，BackSide 从内部可见）
  var geoInner = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
  var matInner = new THREE.MeshBasicMaterial({
    color: 0x9333ea, transparent: true, opacity: 0.07,
    side: THREE.BackSide, depthWrite: false
  });
  var meshInner = new THREE.Mesh(geoInner, matInner);
  meshInner.position.set(cx, by, cz);
  scene.add(meshInner);

  // 穹顶经纬线框（稀疏格，穹顶形态清晰）
  var geoWire = new THREE.SphereGeometry(R * 1.005, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.5);
  var matWire = new THREE.LineBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.45 });
  var meshWire = new THREE.LineSegments(new THREE.WireframeGeometry(geoWire), matWire);
  meshWire.position.set(cx, by, cz);
  scene.add(meshWire);

  // 底部圆环地基（落地光圈）
  var geoRing = new THREE.TorusGeometry(R, 0.18, 6, 72);
  var matRing = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.6 });
  var meshRing = new THREE.Mesh(geoRing, matRing);
  meshRing.rotation.x = Math.PI * 0.5;
  meshRing.position.set(cx, by + 0.15, cz);
  scene.add(meshRing);

  // 预分配脉冲扩散环（单个可复用 Mesh，每 3 秒重置动画；避免每次 new TorusGeometry）
  var prGeo  = new THREE.TorusGeometry(R, 0.3, 6, 48);
  var prMat  = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0, depthWrite: false });
  var prMesh = new THREE.Mesh(prGeo, prMat);
  prMesh.rotation.x = Math.PI * 0.5;
  prMesh.position.set(cx, by + 0.25, cz);
  prMesh.visible = false;
  scene.add(prMesh);

  _territoryList.push({ cx: cx, cz: cz, r: R,
    mesh: meshInner, meshOut: meshWire, ring: meshRing,
    pulseRing: prMesh, pulseT: 3.0, pulseFrac: 1.0 });
}

function _removeTerritory(bx, by, bz) {
  var cx = bx + 0.5, cz = bz + 0.5, i;
  for (i = _territoryList.length - 1; i >= 0; i--) {
    var t = _territoryList[i];
    if (Math.abs(t.cx - cx) < 0.5 && Math.abs(t.cz - cz) < 0.5) {
      scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose();
      scene.remove(t.meshOut); t.meshOut.geometry.dispose(); t.meshOut.material.dispose();
      if (t.ring) { scene.remove(t.ring); t.ring.geometry.dispose(); t.ring.material.dispose(); }
      if (t.pulseRing) { scene.remove(t.pulseRing); t.pulseRing.geometry.dispose(); t.pulseRing.material.dispose(); }
      _territoryList.splice(i, 1);
      return;
    }
  }
}

// 每帧动画（combat_ai.js combatUpdate 调用）
function updateTerritoryFx(dt) {
  _territoryTime += dt;
  var i, t, pulse, frac;
  for (i = 0; i < _territoryList.length; i++) {
    t = _territoryList[i];
    pulse = Math.sin(_territoryTime * 2.2 + i * 1.3);
    t.mesh.material.opacity    = 0.05 + 0.04 * pulse;
    t.meshOut.material.opacity = 0.30 + 0.20 * pulse;
    if (t.ring) t.ring.material.opacity = 0.5 + 0.25 * Math.sin(_territoryTime * 3.0 + i);

    // 每 3 秒触发一次脉冲扩散动画（复用预分配 Mesh，不分配新几何体）
    t.pulseT -= dt;
    if (t.pulseT <= 0) {
      t.pulseT = 3.0;
      t.pulseFrac = 0.0;
      if (t.pulseRing) {
        t.pulseRing.visible = true;
        t.pulseRing.scale.set(0.05, 1, 0.05);
        t.pulseRing.material.opacity = 0.7;
      }
    }

    // 每帧推进脉冲动画
    if (t.pulseRing && t.pulseRing.visible) {
      t.pulseFrac += dt / 1.6;   // life = 1.6s
      if (t.pulseFrac >= 1.0) {
        t.pulseRing.visible = false;
      } else {
        frac = t.pulseFrac;
        t.pulseRing.scale.set(frac < 0.05 ? 0.05 : frac, 1, frac < 0.05 ? 0.05 : frac);
        t.pulseRing.material.opacity = 0.7 * (1 - frac);
      }
    }
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

function _dirClear(x, y, z, dx, dz) {
  var i, cx, cz, by = Math.floor(y);
  for (i = 1; i <= 4; i++) {
    cx = Math.floor(x + dx * i * 0.5);
    cz = Math.floor(z + dz * i * 0.5);
    // 检查胸高 + 头顶第二格，覆盖城墙/建筑多层高度
    var b1 = getBlock(cx, by + 1, cz);
    var b2 = getBlock(cx, by + 2, cz);
    if ((b1 !== AIR && b1 !== WATER) || (b2 !== AIR && b2 !== WATER)) return false;
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

  // 避障：原方向 → ±30° → ±60° → ±90° → ±120° → ±150°（建筑角绕路必须覆盖更大角度）
  var ANG = [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57, 2.09, -2.09];
  var best = null, a, ca, sa, ndx, ndz;
  for (i = 0; i < ANG.length; i++) {
    a = ANG[i]; ca = Math.cos(a); sa = Math.sin(a);
    ndx = dx * ca - dz * sa; ndz = dx * sa + dz * ca;
    if (_dirClear(u.x, u.y, u.z, ndx, ndz)) { best = [ndx, ndz]; break; }
  }
  if (!best) return false;   // 全堵（被夹角卡死）：停止等待，不再顶着墙蹭

  var mv = Math.min(spd * dt, d);
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
