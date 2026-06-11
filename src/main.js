// v15: Three.js minimal test — rotating cube
window._ok = true;
window._step = 1;

var loadEl   = document.getElementById('loading');
var loadFill = document.getElementById('loading-fill');
var loadText = document.getElementById('loading-text');

function setProgress(pct, msg) {
  if (loadFill) loadFill.style.width = pct + '%';
  if (loadText) loadText.textContent = msg;
}

setProgress(20, 'Three.js 检测中...');
window._step = 2;

if (typeof THREE === 'undefined') {
  setProgress(0, '错误: THREE 未定义 | step:' + window._step);
  throw new Error('THREE undefined');
}

setProgress(50, '创建场景...');
window._step = 3;

var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;';
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.5, 2, 4);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
var sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 7);
scene.add(sun);

var cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshLambertMaterial({ color: 0x4ade80 })
);
scene.add(cube);

var ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshLambertMaterial({ color: 0x2d5016 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
scene.add(ground);

window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window._step = 4;
setProgress(100, 'Three.js OK — v15');

if (loadEl) loadEl.style.display = 'none';

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.008;
  cube.rotation.y += 0.012;
  renderer.render(scene, camera);
}
animate();
