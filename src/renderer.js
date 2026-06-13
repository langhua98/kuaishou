// ─── renderer.js ──────────────────────────────────────────────────────────────
// Three.js 渲染器、场景、摄像机。
// 天空穹顶、太阳/月亮、云、灯光、雾的动态控制全部在 sky.js（昼夜+天气系统）。

var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none';
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = null;                             // 由天空穹顶接管
scene.fog = new THREE.Fog(0x8ec5f5, 55, 105);       // 颜色/距离每帧由 sky.js 更新

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
// FPS/TPS 摄像机必须用 YXZ 欧拉顺序：先偏航（世界 Y）再俯仰（本地 X）再横滚，
// 这样 rotation.set(pitch, yaw, roll) 与 raycast 的 forward 公式严格一致
camera.rotation.order = 'YXZ';

// ── 窗口缩放 ──────────────────────────────────────────────────────────────────
function _onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', _onResize);
// iOS Safari：地址栏动态显隐只触发 visualViewport resize，不触发 window resize
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', _onResize);
}
