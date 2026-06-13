// ─── combat_particles.js ──────────────────────────────────────────────────────
// 轻量粒子特效：基于 THREE.Points + BufferGeometry（Three.js r147 原生，零外部依赖）。
//
// 设计取舍：调研的 Partykals 等库要么需要 npm 打包，要么其运行时 API 无法在本项目
// 的 r147 UMD 环境中验证；为保证稳定，这里用原生 Points 自实现一个够用的爆发系统。
// spawnBurst() 在某点喷出一簇粒子（半球向上 + 重力 + 渐隐），updateParticles() 每帧推进。

var _bursts = [];   // 活动粒子簇

// 在 (x,y,z) 喷出一簇粒子。opts: {count,color,speed,size,life,gravity,up}
function spawnBurst(x, y, z, opts) {
  if (typeof scene === 'undefined') return;
  opts = opts || {};
  var n     = opts.count   || 18;
  var color = opts.color   != null ? opts.color   : 0x9333ea;
  var spd   = opts.speed   || 4;
  var size  = opts.size    || 0.22;
  var life  = opts.life    || 0.7;
  var grav  = opts.gravity != null ? opts.gravity : 10;
  var up    = opts.up      != null ? opts.up      : 0.3;   // 额外向上初速比例

  var positions = new Float32Array(n * 3);
  var vel = new Float32Array(n * 3);
  var i, a, b, sp;
  for (i = 0; i < n; i++) {
    positions[i*3] = x; positions[i*3+1] = y; positions[i*3+2] = z;
    a  = Math.random() * Math.PI * 2;          // 方位角
    b  = Math.random() * Math.PI * 0.5;         // 仰角 0~90°（半球向上）
    sp = spd * (0.4 + Math.random() * 0.6);
    vel[i*3]   = Math.cos(a) * Math.cos(b) * sp;
    vel[i*3+1] = Math.sin(b) * sp + spd * up;
    vel[i*3+2] = Math.sin(a) * Math.cos(b) * sp;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var mat = new THREE.PointsMaterial({
    color: color, size: size, transparent: true, opacity: 1,
    depthWrite: false, sizeAttenuation: true,
  });
  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  _bursts.push({ pts: pts, vel: vel, t: 0, life: life, grav: grav, n: n });
}

// 每帧推进所有粒子簇（combat_ai.js combatUpdate 调用）
function updateParticles(dt) {
  var i, b, pos, j, k;
  for (i = _bursts.length - 1; i >= 0; i--) {
    b = _bursts[i];
    b.t += dt;
    pos = b.pts.geometry.attributes.position.array;
    for (j = 0; j < b.n; j++) {
      k = j * 3;
      b.vel[k+1] -= b.grav * dt;
      pos[k]   += b.vel[k]   * dt;
      pos[k+1] += b.vel[k+1] * dt;
      pos[k+2] += b.vel[k+2] * dt;
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.t / b.life);
    if (b.t >= b.life) {
      scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
      _bursts.splice(i, 1);
    }
  }
}
