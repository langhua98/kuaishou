// ─── renderer.js ──────────────────────────────────────────────────────────────
// Three.js 渲染器、场景、摄像机、灯光、天空穹顶。
//
// 天空策略：
//   大球（radius=170，BackSide 渲染）+ 顶点色渐变，
//   地平线 #8ec5f5 → 天顶 #1a5fc7，雾色与地平线一致，
//   远处地形自然淡入天空色，无明显边界。
//
// 光照策略（对玩家模型 MeshLambertMaterial 有效，地形用 MeshBasicMaterial 不受影响）：
//   HemisphereLight — 天空蓝/地面绿，比单一环境光更有立体感
//   DirectionalLight — 模拟太阳，暖黄色，给玩家模型投射方向高光

var renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none';
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = null;                             // 由天空穹顶接管
scene.fog = new THREE.Fog(0x8ec5f5, 55, 105);       // 雾色=地平线色，无缝融合

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
// FPS/TPS 摄像机必须用 YXZ 欧拉顺序：先偏航（世界 Y）再俯仰（本地 X）再横滚，
// 这样 rotation.set(pitch, yaw, roll) 与 raycast 的 forward 公式严格一致
camera.rotation.order = 'YXZ';

// ── 天空穹顶 ───────────────────────────────────────────────────────────────────
(function () {
  var geo = new THREE.SphereGeometry(170, 16, 9);
  var posArr = geo.attributes.position.array;
  var colArr = new Float32Array(posArr.length);
  // 地平线色 (0.557, 0.773, 0.961) → 天顶色 (0.102, 0.373, 0.780)
  for (var i = 0; i < geo.attributes.position.count; i++) {
    var yNorm = posArr[i * 3 + 1] / 170;             // -1..1
    var t     = Math.max(0, Math.min(1, (yNorm + 0.2) / 1.2));
    colArr[i * 3]     = 0.557 - t * 0.455;
    colArr[i * 3 + 1] = 0.773 - t * 0.400;
    colArr[i * 3 + 2] = 0.961 - t * 0.181;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  scene.add(new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false })
  ));
}());

// ── 灯光 ──────────────────────────────────────────────────────────────────────
// 半球光：天空（浅蓝）→ 地面（暗绿），为玩家模型提供自然环境光
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4a6741, 1.2));

// 太阳平行光：暖黄，从右上方斜射
var sun = new THREE.DirectionalLight(0xfff4e0, 0.55);
sun.position.set(2, 5, 1);
scene.add(sun);

// ── 窗口缩放 ──────────────────────────────────────────────────────────────────
window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
