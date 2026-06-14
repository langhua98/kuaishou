// ─── vehicles.js ──────────────────────────────────────────────────────────────
// 载具系统：放置/驾驶汽车（轿车/越野车/皮卡）
// GLB 文件放在 assets/models/vehicles/（可选，无文件时退化为彩色方块）

var VEH_CAR    = 301;
var VEH_SUV    = 302;
var VEH_PICKUP = 303;

BNAMES[VEH_CAR]    = '🚗轿车';
BNAMES[VEH_SUV]    = '🚙越野车';
BNAMES[VEH_PICKUP] = '🛻皮卡';
BCOL[VEH_CAR]    = [0.20,0.40,0.90, 0.20,0.40,0.90, 0.20,0.40,0.90];
BCOL[VEH_SUV]    = [0.20,0.70,0.30, 0.20,0.70,0.30, 0.20,0.70,0.30];
BCOL[VEH_PICKUP] = [0.80,0.50,0.10, 0.80,0.50,0.10, 0.80,0.50,0.10];

var _VEHICLE_DEFS = {};
_VEHICLE_DEFS[VEH_CAR]    = { name:'🚗轿车',   glb:'car_sedan.glb',  speed:16, turnSpd:2.0, color:0x3366cc, w:1.0, h:0.70, d:2.0 };
_VEHICLE_DEFS[VEH_SUV]    = { name:'🚙越野车', glb:'car_suv.glb',   speed:14, turnSpd:1.8, color:0x336633, w:1.1, h:0.90, d:2.2 };
_VEHICLE_DEFS[VEH_PICKUP] = { name:'🛻皮卡',   glb:'car_pickup.glb', speed:13, turnSpd:1.6, color:0xcc6600, w:1.1, h:0.90, d:2.4 };

// placed vehicles: key → { typeId, key, cx, cy, cz, yaw, group }
// cx/cy/cz = world-space center (float), updated every frame while mounted
var _vehiclePlaced = {};
var _mountedVehicle = null;  // entry object from _vehiclePlaced, or null

function isVehicleId(id) { return id >= 301 && id <= 303; }

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

  // Placeholder colored box shown until / if GLB loads
  var mat = new THREE.MeshLambertMaterial({ color: def.color });
  var body = new THREE.Mesh(new THREE.BoxGeometry(def.w * 2, def.h * 2, def.d * 2), mat);
  body.position.y = def.h;
  grp.add(body);

  grp.position.set(wx + 0.5, wy, wz + 0.5);
  grp.rotation.y = yaw || 0;
  scene.add(grp);

  var entry = { typeId: typeId, key: key, cx: wx + 0.5, cy: wy, cz: wz + 0.5,
                yaw: yaw || 0, group: grp };
  _vehiclePlaced[key] = entry;

  // Attempt async GLB load (silently fails if asset not present)
  if (typeof gltfLoader !== 'undefined') {
    gltfLoader.load('assets/models/vehicles/' + def.glb, function(gltf) {
      grp.remove(body);
      var model = gltf.scene;
      var bb = new THREE.Box3().setFromObject(model);
      var modelW = bb.max.x - bb.min.x;
      var s = (def.w * 2) / (modelW > 0.01 ? modelW : 1);
      model.scale.setScalar(s);
      bb.setFromObject(model);
      model.position.y = -bb.min.y;
      model.traverse(function(child) {
        if (child.isMesh) child.material = new THREE.MeshLambertMaterial({ color: def.color });
      });
      grp.add(model);
    }, undefined, function() { /* asset not found – keep placeholder box */ });
  }
  return entry;
}

function mountVehicle(key) {
  var entry = _vehiclePlaced[key];
  if (!entry) return;
  _mountedVehicle = entry;
  // Switch to third-person view when mounting
  if (typeof viewFP !== 'undefined' && viewFP && typeof toggleView === 'function') toggleView();
}

function dismountVehicle() {
  _mountedVehicle = null;
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

  // Sync 3-D model to player position (resolveAABB has run; player.x/y/z is authoritative)
  var grp = _mountedVehicle.group;
  if (grp) {
    grp.position.set(player.x, player.y, player.z);
    grp.rotation.y = _mountedVehicle.yaw;
  }
  _mountedVehicle.cx = player.x;
  _mountedVehicle.cy = player.y;
  _mountedVehicle.cz = player.z;
}
