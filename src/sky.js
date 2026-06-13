// ─── sky.js ───────────────────────────────────────────────────────────────────
// 自然天空系统：昼夜循环 + 太阳/月亮 + 漂移云层 + 天气状态机（晴/多云/雨）。
//
// 昼夜：DAY_LEN 秒一整天。skyTime 0.25=日出、0.5=正午、0.75=日落、0/1=午夜。
//   太阳仰角 elev = sin((skyTime-0.25)·2π)，由它混合三套天空配色（白天/晨昏/夜）。
//
// 联动渲染管线：
//   天空穹顶顶点色   — 每帧按配色重算（170 个顶点，开销可忽略）
//   雾色             — 始终等于地平线色，远景无缝融入天空
//   地形亮度         — mesh.js 的 _mat.color 全局乘数（MeshBasicMaterial 不受灯光影响）
//   半球光/平行光    — 跟随太阳方向与强度，作用于玩家/NPC 的 Lambert 材质
//
// 天气状态机：晴 → 多云 ⇄ 雨，随机时长，参数（云量/亮度/雾距/雨强）平滑过渡。
// 云：两层体素风扁平四边形（noise2D 阈值取格），常驻层 + 阴天增量层，随风漂移。
// 雨：相机周围圆柱体内 300 条短线段下落循环，仅雨强 >0 时更新和显示。

var DAY_LEN = 600;          // 一整天 600 秒（10 分钟）
var skyTime = 0.42;         // 固定在下午（昼夜循环已关闭）

// ── 天空穹顶（顶点色渐变，每帧重算）────────────────────────────────────────────
var _domeGeo = new THREE.SphereGeometry(170, 16, 9);
var _domeT = [];                       // 每顶点渐变因子 0=地平线 1=天顶
(function () {
  var pos = _domeGeo.attributes.position.array;
  var n = _domeGeo.attributes.position.count;
  var col = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    var yN = pos[i * 3 + 1] / 170;
    _domeT.push(Math.max(0, Math.min(1, (yN + 0.2) / 1.2)));
  }
  _domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
}());
var _dome = new THREE.Mesh(
  _domeGeo,
  new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false })
);
_dome.renderOrder = -3;
scene.add(_dome);

// 三套配色 [地平线 r,g,b, 天顶 r,g,b]
var _SKY_DAY   = [0.557, 0.773, 0.961,  0.102, 0.373, 0.780];
var _SKY_DUSK  = [0.969, 0.604, 0.333,  0.275, 0.243, 0.490];
var _SKY_NIGHT = [0.043, 0.063, 0.125,  0.010, 0.020, 0.060];

// ── 太阳 / 月亮圆盘 ────────────────────────────────────────────────────────────
function _disc(radius, color, opacity) {
  var m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false, fog: false })
  );
  m.renderOrder = -2;
  scene.add(m);
  return m;
}
var _sunDisc  = _disc(9, 0xfff3c0, 1);
var _sunGlow  = _disc(16, 0xffd980, 0.25);   // 太阳光晕
var _moonDisc = _disc(6, 0xdfe8f5, 1);

// ── 灯光（作用于玩家/NPC Lambert 材质；地形亮度走 _mat.color）──────────────────
var _hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a6741, 1.2);
scene.add(_hemi);
var _sunLight = new THREE.DirectionalLight(0xfff4e0, 0.55);
_sunLight.position.set(2, 5, 1);
scene.add(_sunLight);

// ── 云层（体素风扁平四边形，noise 取格）────────────────────────────────────────
var CLOUD_Y = 46, CLOUD_CELL = 14, CLOUD_GRID = 26;   // 26×26 格 ≈ 364×364
function _buildClouds(thLo, thHi) {
  // 取 noise2D ∈ (thLo, thHi] 的格子生成四边形
  var pos = [], half = CLOUD_GRID / 2;
  for (var i = 0; i < CLOUD_GRID; i++) {
    for (var j = 0; j < CLOUD_GRID; j++) {
      var v = noise2D(i * 0.21 + 53.7, j * 0.21 + 17.3);
      if (v <= thLo || v > thHi) continue;
      var x0 = (i - half) * CLOUD_CELL, z0 = (j - half) * CLOUD_CELL;
      var x1 = x0 + CLOUD_CELL, z1 = z0 + CLOUD_CELL;
      pos.push(x0,0,z0, x1,0,z0, x1,0,z1,  x0,0,z0, x1,0,z1, x0,0,z1);
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  var mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false
  }));
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
}
var _cloudA = _buildClouds(0.32, 9);      // 常驻稀疏云
var _cloudB = _buildClouds(0.10, 0.32);   // 阴天增量云（晴天透明）
var _cloudDrift = 0;

// ── 雨（相机周围圆柱体内的下落线段）────────────────────────────────────────────
var RAIN_N = 300, RAIN_R = 18, RAIN_H = 26;
var _rainBase = new Float32Array(RAIN_N * 3);   // 每滴雨的固定 x/z 与初始 y
(function () {
  for (var i = 0; i < RAIN_N; i++) {
    var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RAIN_R;
    _rainBase[i * 3]     = Math.cos(a) * r;
    _rainBase[i * 3 + 1] = Math.random() * RAIN_H;
    _rainBase[i * 3 + 2] = Math.sin(a) * r;
  }
}());
var _rainGeo = new THREE.BufferGeometry();
_rainGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(RAIN_N * 6), 3));
var _rainMat = new THREE.LineBasicMaterial({ color: 0xa8bdd8, transparent: true, opacity: 0 });
var _rain = new THREE.LineSegments(_rainGeo, _rainMat);
_rain.visible = false;
_rain.frustumCulled = false;
scene.add(_rain);
var _rainFall = 0;   // 下落相位

// ── 天气状态机 ─────────────────────────────────────────────────────────────────
// 目标参数表 [增量云不透明度, 常驻云不透明度, 天光系数, 雨强, 雾近, 雾远]
var _WEATHER = [
  [0.00, 0.75, 1.00, 0, 55, 105],   // 0 晴
  [0.70, 0.85, 0.82, 0, 45,  95],   // 1 多云
  [0.92, 0.92, 0.55, 1, 30,  72],   // 2 雨
];
var _wState = 0, _wTimer = 60 + Math.random() * 90;
// 当前平滑值（从晴天参数出发）
var _wCur = [0, 0.75, 1, 0, 55, 105];

function _nextWeather() {
  if (_wState === 0)      _wState = 1;                              // 晴 → 多云
  else if (_wState === 1) _wState = Math.random() < 0.45 ? 2 : 0;   // 多云 → 雨/晴
  else                    _wState = 1;                              // 雨 → 多云
  if (_wState === 0)      _wTimer = 90 + Math.random() * 120;
  else if (_wState === 1) _wTimer = 45 + Math.random() * 60;
  else                    _wTimer = 40 + Math.random() * 50;
}

// ── 每帧更新（game.js tick 调用）──────────────────────────────────────────────
function updateSky(dt) {
  // skyTime 已固定，无昼夜循环
  var ang  = (skyTime - 0.25) * Math.PI * 2;
  var elev = Math.sin(ang);                          // 太阳仰角 -1..1

  // 天气推进 + 参数平滑
  _wTimer -= dt;
  if (_wTimer <= 0) _nextWeather();
  var tgt = _WEATHER[_wState], k = Math.min(1, 0.4 * dt), i;
  for (i = 0; i < 6; i++) _wCur[i] += (tgt[i] - _wCur[i]) * k;
  var wLight = _wCur[2], rainStr = _wCur[3];

  // 昼/晨昏/夜混合权重
  var wDay   = Math.max(0, Math.min(1, elev * 4));
  var wNight = Math.max(0, Math.min(1, -elev * 4));
  var wDusk  = Math.max(0, 1 - Math.abs(elev) * 4) * 0.9;
  var wSum   = wDay + wNight + wDusk;
  wDay /= wSum; wNight /= wSum; wDusk /= wSum;

  // 混合后的地平线/天顶色 × 天气系数
  var hz = [], zen = [];
  for (i = 0; i < 3; i++) {
    hz[i]  = (_SKY_DAY[i]   * wDay + _SKY_DUSK[i]   * wDusk + _SKY_NIGHT[i]   * wNight) * wLight;
    zen[i] = (_SKY_DAY[i+3] * wDay + _SKY_DUSK[i+3] * wDusk + _SKY_NIGHT[i+3] * wNight) * wLight;
  }

  // 穹顶顶点色 + 跟随相机
  var col = _domeGeo.attributes.color.array;
  for (i = 0; i < _domeT.length; i++) {
    var t = _domeT[i];
    col[i * 3]     = hz[0] + (zen[0] - hz[0]) * t;
    col[i * 3 + 1] = hz[1] + (zen[1] - hz[1]) * t;
    col[i * 3 + 2] = hz[2] + (zen[2] - hz[2]) * t;
  }
  _domeGeo.attributes.color.needsUpdate = true;
  _dome.position.copy(camera.position);

  // 雾：颜色=地平线色，距离随天气
  scene.fog.color.setRGB(hz[0], hz[1], hz[2]);
  scene.fog.near = _wCur[4];
  scene.fog.far  = _wCur[5];

  // 太阳/月亮方位（东升西落，路径略向南倾斜）
  var sx = Math.cos(ang), sy = elev, sz = Math.cos(ang) * 0.25 + 0.18;
  var inv = 1 / Math.sqrt(sx * sx + sy * sy + sz * sz);
  sx *= inv; sy *= inv; sz *= inv;

  _sunDisc.position.set(camera.position.x + sx * 150, camera.position.y + sy * 150, camera.position.z + sz * 150);
  _sunGlow.position.copy(_sunDisc.position);
  _moonDisc.position.set(camera.position.x - sx * 150, camera.position.y - sy * 150, camera.position.z - sz * 150);
  _sunDisc.lookAt(camera.position);
  _sunGlow.lookAt(camera.position);
  _moonDisc.lookAt(camera.position);
  // 日出日落偏橙；落到地平线下淡出
  var sunFade = Math.max(0, Math.min(1, (elev + 0.08) * 8)) * Math.max(0.25, wLight);
  _sunDisc.material.color.setRGB(1, 0.82 + wDay * 0.13, 0.55 + wDay * 0.2);
  _sunDisc.material.opacity = sunFade;
  _sunGlow.material.opacity = sunFade * 0.25;
  _moonDisc.material.opacity = Math.max(0, Math.min(1, (-elev + 0.05) * 6)) * Math.max(0.3, wLight);

  // 灯光：白天太阳，夜晚弱月光
  _sunLight.position.set(sx, Math.max(sy, 0.05), sz);
  _sunLight.intensity = 0.55 * wDay * wLight + 0.08 * wNight;
  _sunLight.color.setRGB(1, 0.86 + wDay * 0.1, 0.72 + wDay * 0.16);
  _hemi.intensity = (0.3 + 1.0 * wDay + 0.25 * wDusk) * wLight;

  // 地形亮度（MeshBasicMaterial 全局乘数）：夜晚保留最低可见度
  var b = (0.22 + 0.78 * (wDay + wDusk * 0.55)) * (0.55 + 0.45 * wLight);
  if (typeof _mat !== 'undefined') _mat.color.setScalar(b);

  // 云：随风漂移 + 跟随相机（按格吸附避免重定位时滑动）
  _cloudDrift += dt * 1.6;
  var snapX = Math.round((camera.position.x - _cloudDrift) / CLOUD_CELL) * CLOUD_CELL + _cloudDrift;
  var snapZ = Math.round(camera.position.z / CLOUD_CELL) * CLOUD_CELL;
  _cloudA.position.set(snapX, CLOUD_Y, snapZ);
  _cloudB.position.set(snapX, CLOUD_Y + 2, snapZ);
  _cloudA.material.opacity = _wCur[1] * (0.35 + 0.65 * Math.max(wDay, 0.25));
  _cloudB.material.opacity = _wCur[0] * (0.35 + 0.65 * Math.max(wDay, 0.25));
  // 夜晚云偏暗
  var cb = 0.35 + 0.65 * wDay;
  _cloudA.material.color.setScalar(cb);
  _cloudB.material.color.setScalar(cb * 0.92);

  // 雨
  if (rainStr > 0.02) {
    _rain.visible = true;
    _rainMat.opacity = rainStr * 0.45;
    _rainFall = (_rainFall + dt * 34) % RAIN_H;
    var rp = _rainGeo.attributes.position.array;
    for (i = 0; i < RAIN_N; i++) {
      var rx = _rainBase[i * 3], ry0 = _rainBase[i * 3 + 1], rz = _rainBase[i * 3 + 2];
      var ry = ((ry0 - _rainFall) % RAIN_H + RAIN_H) % RAIN_H;   // 0..RAIN_H 循环下落
      rp[i * 6]     = rx; rp[i * 6 + 1] = ry;        rp[i * 6 + 2] = rz;
      rp[i * 6 + 3] = rx; rp[i * 6 + 4] = ry - 0.7;  rp[i * 6 + 5] = rz;
    }
    _rainGeo.attributes.position.needsUpdate = true;
    _rain.position.set(camera.position.x, camera.position.y - 4, camera.position.z);
  } else {
    _rain.visible = false;
  }
}

// 立即初始化一次：boot 阶段渲染时天空就有正确颜色（而非黑色顶点）
updateSky(0);
