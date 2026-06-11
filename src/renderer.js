// ─── renderer.js ──────────────────────────────────────────────────────────────
// Three.js 渲染器、场景、摄像机、灯光初始化。
//
// 摄像机旋转约定（YXZ 欧拉顺序）：
//   rotation.y = player.yaw   — 左右转向（yaw 减小 = 向右转）
//   rotation.x = player.pitch — 仰俯（pitch 增大 = 抬头）
// 这与原始 viewMatrix 中 forward=(-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)) 完全一致。
//
// 光照策略：环境光（0.85）提供基础亮度，微弱平行光（0.3）强调方向感。
// 区块网格使用 MeshBasicMaterial + 烘焙顶点色，不受场景灯光影响。

var renderer = new THREE.WebGLRenderer({ antialias: false }); // 移动端关闭抗锯齿
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none';
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);      // 天空蓝
scene.fog = new THREE.Fog(0x87ceeb, 50, 90);       // 远处淡出，与天空同色

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';                     // 先偏航再俯仰，标准 FPS 顺序

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
var sun = new THREE.DirectionalLight(0xfff0c8, 0.3);
sun.position.set(1, 2, 1);
scene.add(sun);

window.addEventListener('resize', function () {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
