// ─── furniture.js ─────────────────────────────────────────────────────────────
// 家具系统：KayKit Furniture Bits（CC0）GLTF 模型放置/管理/存档。
// 家具为 Three.js Group（非体素方块），放置在世界坐标，不占区块格。

var FURNITURE_DEFS = [
  { id: 101, name: '椅子',     file: 'chair_A',               scale: 1.0 },
  { id: 102, name: '桌子',     file: 'table_medium',          scale: 1.0 },
  { id: 103, name: '单人床',   file: 'bed_single_A',          scale: 1.0 },
  { id: 104, name: '沙发',     file: 'couch',                 scale: 1.0 },
  { id: 105, name: '书架',     file: 'shelf_A_big',           scale: 1.0 },
  { id: 106, name: '柜子',     file: 'cabinet_medium',        scale: 1.0 },
  { id: 107, name: '落地灯',   file: 'lamp_standing',         scale: 1.0 },
  { id: 108, name: '地毯',     file: 'rug_rectangle_A',       scale: 1.0 },
  { id: 109, name: '扶手椅',   file: 'armchair',              scale: 1.0 },
  { id: 110, name: '长桌',     file: 'table_medium_long',     scale: 1.0 },
  { id: 111, name: '抱枕椅',   file: 'armchair_pillows',      scale: 1.0 },
  { id: 112, name: '双人床',   file: 'bed_double_A',          scale: 1.0 },
  { id: 113, name: '单人床B',  file: 'bed_single_B',          scale: 1.0 },
  { id: 114, name: '小柜子',   file: 'cabinet_small',         scale: 1.0 },
  { id: 115, name: '仙人掌',   file: 'cactus_medium_A',       scale: 1.0 },
  { id: 116, name: '小仙人掌', file: 'cactus_small_A',        scale: 1.0 },
  { id: 117, name: '椅子B',    file: 'chair_B',               scale: 1.0 },
  { id: 118, name: '凳子',     file: 'chair_stool',           scale: 1.0 },
  { id: 119, name: '抱枕沙发', file: 'couch_pillows',         scale: 1.0 },
  { id: 120, name: '台灯',     file: 'lamp_table',            scale: 1.0 },
  { id: 121, name: '椭圆毯',   file: 'rug_oval_A',            scale: 1.0 },
  { id: 122, name: '矩形毯B',  file: 'rug_rectangle_B',       scale: 1.0 },
  { id: 123, name: '小书架',   file: 'shelf_A_small',         scale: 1.0 },
  { id: 124, name: '展示架',   file: 'shelf_B_large',         scale: 1.0 },
  { id: 125, name: '小展示架', file: 'shelf_B_small',         scale: 1.0 },
  { id: 126, name: '茶几',     file: 'table_low',             scale: 1.0 },
  { id: 127, name: '小方桌',   file: 'table_small',           scale: 1.0 },
];

var _furnitureGltf = {};      // file → gltf
var _furniturePlaced = [];    // 所有已放置家具记录
var _furnitureSeq = 1;
var _furnitureLoaded = false;
var _furnitureSolid = {};     // "x,y,z" → 引用计数（>0 则该格视为实心碰撞）

// 摆放幽灵预览状态
var _furnitureGhost = null;   // 当前半透明幽灵 Group（或 null）
var _ghostTypeId    = 0;      // 幽灵对应的 typeId（变化才重建克隆）
var _ghostYaw       = 0;      // 用户控制的朝向，由旋转按钮改

// 更新家具占据格实心集合（引用计数，支持多件家具共格）
function _markFurnitureSolid(entry, on) {
  if (!entry || !entry.cells) return;
  for (var i = 0; i < entry.cells.length; i++) {
    var k = entry.cells[i];
    if (on) {
      _furnitureSolid[k] = (_furnitureSolid[k] || 0) + 1;
    } else {
      _furnitureSolid[k] = (_furnitureSolid[k] || 0) - 1;
      if (_furnitureSolid[k] <= 0) delete _furnitureSolid[k];
    }
  }
}

// 工具：是否家具道具 / 是否可互动家具 / 是否灯具
function isFurnitureId(id) { return id >= 101 && id <= 127; }
function isInteractive(id) {
  // 椅/凳/扶手椅/沙发类 → 坐；床类 → 休息；灯类 → 开关
  return id === 101 || id === 103 || id === 104 || id === 107 || id === 109 ||
         id === 111 || id === 112 || id === 113 || id === 117 || id === 118 ||
         id === 119 || id === 120;
}
function isFurnitureLamp(id) { return id === FURNITURE_LAMP || id === FURNITURE_LAMP_TABLE; }
function isFurnitureBed(id)  { return id === FURNITURE_BED  || id === FURNITURE_BED_DOUBLE || id === FURNITURE_BED_B; }

function _furnitureDefById(typeId) {
  for (var i = 0; i < FURNITURE_DEFS.length; i++) {
    if (FURNITURE_DEFS[i].id === typeId) return FURNITURE_DEFS[i];
  }
  return null;
}

// 克隆并脚底对齐模型（placeFurniture 与幽灵共用）
function _cloneFurnitureModel(def) {
  var g = _furnitureGltf[def.file];
  if (!g) return null;
  var model = g.scene.clone(true);
  model.scale.setScalar(def.scale);
  model.updateMatrixWorld(true);
  var bbox = new THREE.Box3().setFromObject(model);
  model.position.y = -bbox.min.y;
  model.userData.fHeight = bbox.max.y - bbox.min.y;  // 模型高度（灯泡/光源定位用）
  return model;
}

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
  var def = _furnitureDefById(typeId);
  if (!def) return null;
  var model = _cloneFurnitureModel(def);
  if (!model) return null;

  if (yaw === undefined) {
    yaw = (typeof player !== 'undefined') ? player.yaw + Math.PI : 0;
  }

  var group = new THREE.Group();
  group.add(model);
  group.position.set(wx + 0.5, wy, wz + 0.5);
  group.rotation.y = yaw;
  scene.add(group);

  // 落地灯 / 台灯：伪造暖光（发光灯泡 + 地面暖光圈 + 点光源）
  var glow = null;
  if (isFurnitureLamp(typeId)) {
    // 灯泡/光源高度跟随模型实际高度的 85%（落地灯高、台灯矮，灯泡都落在灯罩处）
    var lampH = model.userData.fHeight || 2.0;
    var bulbY = lampH * 0.85;
    glow = new THREE.Group();
    // 发光灯泡（BasicMaterial 不受昼夜亮度影响，夜里自然醒目）
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0 })
    );
    bulb.position.set(0, bulbY, 0);
    glow.add(bulb);
    // 地面暖光圈（半透明叠加，像一圈光池）
    var pool = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.18, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    glow.add(pool);
    // 点光源（作用于受光的家具/角色模型）
    var ptLight = new THREE.PointLight(0xfff0c0, 1.8, 8);
    ptLight.position.set(0, bulbY, 0);
    glow.add(ptLight);
    group.add(glow);
  }

  // 计算旋转后世界 AABB 占据格（地毯/极扁家具不阻挡）
  group.updateMatrixWorld(true);
  var wbox = new THREE.Box3().setFromObject(group);
  var cells = [];
  var _hgt = wbox.max.y - wbox.min.y;
  var _isRug = (typeId === FURNITURE_RUG || typeId === FURNITURE_RUG_OVAL || typeId === FURNITURE_RUG_B);
  if (!_isRug && _hgt >= 0.4) {
    for (var _cx = Math.floor(wbox.min.x); _cx <= Math.floor(wbox.max.x - 0.001); _cx++)
      for (var _cz = Math.floor(wbox.min.z); _cz <= Math.floor(wbox.max.z - 0.001); _cz++)
        for (var _cy = Math.floor(wbox.min.y); _cy <= Math.floor(wbox.max.y - 0.001); _cy++)
          cells.push(_cx + ',' + _cy + ',' + _cz);
  }

  var entry = {
    id: _furnitureSeq++, typeId: typeId,
    x: wx, y: wy, z: wz, yaw: yaw,
    group: group, glow: glow, on: true, cells: cells
  };
  _furniturePlaced.push(entry);
  _markFurnitureSolid(entry, true);
  return entry;
}

// 开关落地灯（切换暖光子组显隐 + 状态）
function toggleLamp(entry) {
  if (!entry) return;
  entry.on = !entry.on;
  if (entry.glow) entry.glow.visible = entry.on;
}

// ── 摆放幽灵预览 ────────────────────────────────────────────────────────────────
// 选中家具时显示半透明幽灵，跟随准星，🔄 按钮旋转，📦 确认放置
function rotateFurnitureGhost() {
  _ghostYaw += Math.PI / 2;
  if (_ghostYaw >= Math.PI * 2) _ghostYaw -= Math.PI * 2;
}

function disposeFurnitureGhost() {
  if (!_furnitureGhost) return;
  scene.remove(_furnitureGhost);
  _furnitureGhost.traverse(function (o) {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
  });
  _furnitureGhost = null;
  _ghostTypeId = 0;
}

// 每帧调用：typeId 变化才重建克隆，否则只更新位置/朝向
function updateFurnitureGhost(typeId, wx, wy, wz, yaw, visible) {
  if (!visible || !typeId) {
    if (_furnitureGhost) _furnitureGhost.visible = false;
    return;
  }
  var def = _furnitureDefById(typeId);
  if (!def || !_furnitureGltf[def.file]) {
    // 模型未就绪 → 隐藏，待 GLB 加载完下帧自然出现
    if (_furnitureGhost) _furnitureGhost.visible = false;
    return;
  }
  if (typeId !== _ghostTypeId) {
    disposeFurnitureGhost();
    var model = _cloneFurnitureModel(def);
    if (!model) return;
    // 克隆每个 mesh 材质后改半透明（不能共享，否则污染真实家具材质）
    model.traverse(function (o) {
      if (o.isMesh && o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.45;
        o.material.depthWrite = false;
      }
    });
    var grp = new THREE.Group();
    grp.add(model);
    scene.add(grp);
    _furnitureGhost = grp;
    _ghostTypeId = typeId;
  }
  _furnitureGhost.position.set(wx + 0.5, wy, wz + 0.5);
  _furnitureGhost.rotation.y = yaw;
  _furnitureGhost.visible = true;
}

// 按记录 id 移除家具
function removeFurnitureById(fid) {
  for (var i = _furniturePlaced.length - 1; i >= 0; i--) {
    if (_furniturePlaced[i].id === fid) {
      _markFurnitureSolid(_furniturePlaced[i], false);
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
    return { typeId: f.typeId, x: f.x, y: f.y, z: f.z, yaw: f.yaw, on: f.on };
  });
}

// 反序列化（读档时调用，需先 loadFurnitureModels）
function deserializeFurniture(arr) {
  if (!arr || !arr.length) return;
  arr.forEach(function (f) {
    var en = placeFurniture(f.typeId, f.x, f.y, f.z, f.yaw);
    if (en && f.on === false) toggleLamp(en);   // 旧档无 on → 默认开，向后兼容
  });
}
