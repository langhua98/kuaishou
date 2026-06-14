// ─── furniture.js ─────────────────────────────────────────────────────────────
// 家具系统：KayKit Furniture Bits（CC0）GLTF 模型放置/管理/存档。
// 家具为 Three.js Group（非体素方块），放置在世界坐标，不占区块格。

var FURNITURE_DEFS = [
  { id: 101, name: '椅子',   file: 'chair_A',            scale: 1.0 },
  { id: 102, name: '桌子',   file: 'table_medium',       scale: 1.0 },
  { id: 103, name: '单人床', file: 'bed_single_A',       scale: 1.0 },
  { id: 104, name: '沙发',   file: 'couch',              scale: 1.0 },
  { id: 105, name: '书架',   file: 'shelf_A_big',        scale: 1.0 },
  { id: 106, name: '柜子',   file: 'cabinet_medium',     scale: 1.0 },
  { id: 107, name: '落地灯', file: 'lamp_standing',      scale: 1.0 },
  { id: 108, name: '地毯',   file: 'rug_rectangle_A',    scale: 1.0 },
  { id: 109, name: '扶手椅', file: 'armchair',           scale: 1.0 },
  { id: 110, name: '长桌',   file: 'table_medium_long',  scale: 1.0 },
];

var _furnitureGltf = {};      // file → gltf
var _furniturePlaced = [];    // 所有已放置家具记录
var _furnitureSeq = 1;
var _furnitureLoaded = false;

// 加载所有家具 GLTF（首次放置或启动时调）
function loadFurnitureModels(onDone) {
  if (_furnitureLoaded) { if (onDone) onDone(); return; }
  var names = [], seen = {}, i;
  for (i = 0; i < FURNITURE_DEFS.length; i++) {
    var fn = FURNITURE_DEFS[i].file;
    if (!seen[fn]) { seen[fn] = 1; names.push(fn); }
  }
  var done = 0, total = names.length;
  if (total === 0) { _furnitureLoaded = true; if (onDone) onDone(); return; }
  names.forEach(function (name) {
    gltfLoader.load('assets/models/furniture/' + name + '.glb', function (g) {
      _furnitureGltf[name] = g;
      if (++done === total) { _furnitureLoaded = true; if (onDone) onDone(); }
    }, undefined, function () {
      if (++done === total) { _furnitureLoaded = true; if (onDone) onDone(); }
    });
  });
}

// 在世界坐标放置一件家具（wx/wy/wz = 方块坐标，yaw 可选）
function placeFurniture(typeId, wx, wy, wz, yaw) {
  var def = null, i;
  for (i = 0; i < FURNITURE_DEFS.length; i++) {
    if (FURNITURE_DEFS[i].id === typeId) { def = FURNITURE_DEFS[i]; break; }
  }
  if (!def) return null;
  var g = _furnitureGltf[def.file];
  if (!g) return null;

  if (yaw === undefined) {
    yaw = (typeof player !== 'undefined') ? player.yaw + Math.PI : 0;
  }

  var group = new THREE.Group();
  var model = g.scene.clone(true);
  model.scale.setScalar(def.scale);
  // 脚底对齐：量缩放后世界包围盒，把模型底面归零到 group 原点（防止悬空/陷地）
  model.updateMatrixWorld(true);
  var bbox = new THREE.Box3().setFromObject(model);
  model.position.y = -bbox.min.y;
  group.add(model);
  group.position.set(wx + 0.5, wy, wz + 0.5);
  group.rotation.y = yaw;
  scene.add(group);

  // 落地灯：加点光源（暖黄，照亮半径 8m）
  if (typeId === FURNITURE_LAMP) {
    var ptLight = new THREE.PointLight(0xfff0c0, 1.8, 8);
    ptLight.position.set(0, 1.6, 0);   // 灯罩位置
    group.add(ptLight);
  }

  var entry = {
    id: _furnitureSeq++, typeId: typeId,
    x: wx, y: wy, z: wz, yaw: yaw,
    group: group
  };
  _furniturePlaced.push(entry);
  return entry;
}

// 按记录 id 移除家具
function removeFurnitureById(fid) {
  for (var i = _furniturePlaced.length - 1; i >= 0; i--) {
    if (_furniturePlaced[i].id === fid) {
      scene.remove(_furniturePlaced[i].group);
      _furniturePlaced.splice(i, 1);
      return true;
    }
  }
  return false;
}

// 序列化供 save.js 调用
function serializeFurniture() {
  return _furniturePlaced.map(function (f) {
    return { typeId: f.typeId, x: f.x, y: f.y, z: f.z, yaw: f.yaw };
  });
}

// 反序列化（读档时调用，需先 loadFurnitureModels）
function deserializeFurniture(arr) {
  if (!arr || !arr.length) return;
  arr.forEach(function (f) {
    placeFurniture(f.typeId, f.x, f.y, f.z, f.yaw);
  });
}
