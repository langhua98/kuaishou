// ─── vehicles.js ──────────────────────────────────────────────────────────────
// 载具系统：放置/驾驶汽车（轿车/越野车/皮卡）
// GLB 文件放在 assets/models/vehicles/（可选，无文件时退化为彩色方块）

var VEH_CAR    = 301;  // 🚗轿车   → KayKit car_sedan
var VEH_TAXI   = 302;  // 🚕出租车 → KayKit car_taxi
var VEH_POLICE = 303;  // 🚓警车   → KayKit car_police

BNAMES[VEH_CAR]    = '🚗轿车';
BNAMES[VEH_TAXI]   = '🚕出租车';
BNAMES[VEH_POLICE] = '🚓警车';
BCOL[VEH_CAR]    = [0.20,0.40,0.90, 0.20,0.40,0.90, 0.20,0.40,0.90];
BCOL[VEH_TAXI]   = [0.95,0.80,0.10, 0.95,0.80,0.10, 0.95,0.80,0.10];
BCOL[VEH_POLICE] = [0.20,0.25,0.55, 0.20,0.25,0.55, 0.20,0.25,0.55];

// gltf = assets/models/vehicles/ 下的 KayKit City Builder Bits 模型（CC0）
// w/h/d = 占位方块半尺寸（格），仅在模型未加载时使用。
_VEHICLE_DEFS[VEH_CAR]    = { name:'🚗轿车',   gltf:'car_sedan.gltf',  speed:16, turnSpd:2.0, color:0x3366cc, w:0.45, h:0.30, d:0.85, scaleW:1.0 };
_VEHICLE_DEFS[VEH_TAXI]   = { name:'🚕出租车', gltf:'car_taxi.gltf',   speed:15, turnSpd:1.9, color:0xf2cc1a, w:0.45, h:0.32, d:0.85, scaleW:1.0 };
_VEHICLE_DEFS[VEH_POLICE] = { name:'🚓警车',   gltf:'car_police.gltf', speed:17, turnSpd:2.0, color:0x33408c, w:0.45, h:0.31, d:0.85, scaleW:1.0 };

// placed vehicles: key → { typeId, key, cx, cy, cz, yaw, group }
// cx/cy/cz = world-space center (float), updated every frame while mounted
var _vehiclePlaced = {};
var _mountedVehicle = null;  // entry object from _vehiclePlaced, or null

function isVehicleId(id) { return id >= 301 && id <= 303; }

// 用基本几何体拼一辆车：底盘 + 车厢 + 4 轮。返回 Group（脚部对齐 y=0）。
function _buildCarMesh(def) {
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshLambertMaterial({ color: def.color });
  var darkMat = new THREE.MeshLambertMaterial({ color: 0x222228 });
  var glassMat = new THREE.MeshLambertMaterial({ color: 0x88bbdd });

  var W = def.w * 2, H = def.h * 2, D = def.d * 2;
  var wheelR = def.h * 0.45;

  // 底盘（主车身）
  var chassis = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.6, D), bodyMat);
  chassis.position.y = wheelR + H * 0.3;
  g.add(chassis);

  // 车厢（驾驶室，略窄略短，靠后）
  var cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, H * 0.55, D * 0.5), glassMat);
  cabin.position.set(0, wheelR + H * 0.6 + H * 0.275, -D * 0.05);
  g.add(cabin);

  // 4 个轮子（圆柱，横向放置）
  var wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, W * 0.18, 12);
  var wx2 = W * 0.5 + W * 0.02, wz2 = D * 0.32;
  var offs = [[wx2, wz2], [-wx2, wz2], [wx2, -wz2], [-wx2, -wz2]];
  for (var i = 0; i < offs.length; i++) {
    var wh = new THREE.Mesh(wheelGeo, darkMat);
    wh.rotation.z = Math.PI / 2;
    wh.position.set(offs[i][0], wheelR, offs[i][1]);
    g.add(wh);
  }
  return g;
}

function nearestVehicle(px, py, pz, radius) {
  var best = null, bestD2 = radius * radius;
  for (var k in _vehiclePlaced) {
    var e = _vehiclePlaced[k];
    var dx = e.cx - px, dz = e.cz - pz;
    var d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = k; }
  }
  return best;
}

function placeVehicle(typeId, wx, wy, wz, yaw) {
  var def = _VEHICLE_DEFS[typeId];
  if (!def) return null;
  var key = wx + ',' + wy + ',' + wz;
  var grp = new THREE.Group();

  // Placeholder car shape (底盘+车厢+4轮) shown until / if GLB loads
  var body = _buildCarMesh(def);
  grp.add(body);

  grp.position.set(wx + 0.5, wy, wz + 0.5);
  grp.rotation.y = yaw || 0;
  scene.add(grp);

  var entry = { typeId: typeId, key: key, cx: wx + 0.5, cy: wy, cz: wz + 0.5,
                yaw: yaw || 0, group: grp };
  _vehiclePlaced[key] = entry;

  // Async load real KayKit model; keep textured material. Falls back to placeholder on error.
  if (typeof gltfLoader !== 'undefined' && def.gltf) {
    gltfLoader.load('assets/models/vehicles/' + def.gltf, function(gltf) {
      grp.remove(body);
      var model = gltf.scene;
      var bb = new THREE.Box3().setFromObject(model);
      var modelW = bb.max.x - bb.min.x;
      var s = (def.scaleW || 1.0) / (modelW > 0.01 ? modelW : 1);
      model.scale.setScalar(s);
      bb.setFromObject(model);
      model.position.y = -bb.min.y;          // 轮子落地
      model.rotation.y = Math.PI;            // KayKit 车头朝 +Z；游戏前进为 -Z，翻转 180°
      entry.model = model;
      grp.add(model);
    }, undefined, function() { /* asset not found – keep placeholder car shape */ });
  }
  return entry;
}

function mountVehicle(key) {
  var entry = _vehiclePlaced[key];
  if (!entry) return;
  _mountedVehicle = entry;
  // Force third-person so the driving chase-cam is used
  if (typeof viewFP !== 'undefined' && viewFP && typeof toggleView === 'function') toggleView();
  var sp = document.getElementById('speedo');
  if (sp) sp.classList.add('on');
}

function dismountVehicle() {
  _mountedVehicle = null;
  var sp = document.getElementById('speedo');
  if (sp) sp.classList.remove('on');
}

function updateVehicles(dt) {
  if (!_mountedVehicle) return;
  var def = _VEHICLE_DEFS[_mountedVehicle.typeId];
  if (!def) return;

  // Joystick input (same normalisation as game.js movement)
  var jx = joy.dx / JOY_R, jy = joy.dy / JOY_R;
  var jLen = Math.sqrt(jx * jx + jy * jy);
  if (jLen > 1) { jx /= jLen; jy /= jLen; }

  // Steering: joystick X rotates vehicle yaw
  _mountedVehicle.yaw -= jx * def.turnSpd * dt;
  player.yaw = _mountedVehicle.yaw;

  // Drive: joystick Y < 0 = forward (push up)
  var fwd = -jy;
  player.vx = -Math.sin(_mountedVehicle.yaw) * fwd * def.speed;
  player.vz = -Math.cos(_mountedVehicle.yaw) * fwd * def.speed;
}

// 在 resolveAABB 之后调用：把车模型同步到玩家的权威位置，并刷新速度表
function syncMountedVehicle() {
  if (!_mountedVehicle) return;
  var grp = _mountedVehicle.group;
  if (grp) {
    grp.position.set(player.x, player.y, player.z);
    grp.rotation.y = _mountedVehicle.yaw;
  }
  _mountedVehicle.cx = player.x;
  _mountedVehicle.cy = player.y;
  _mountedVehicle.cz = player.z;

  var spv = document.getElementById('speedo-val');
  if (spv) {
    var sp = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
    spv.textContent = Math.round(sp * 6);  // 格/秒 → km/h 风格数值
  }
}
