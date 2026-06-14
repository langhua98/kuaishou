// ─── crops.js ─────────────────────────────────────────────────────────────────
// 农场种植系统：种子放置 → 多阶段生长 → 收获
// 使用 Quaternius Ultimate Crops Pack（CC0）转换的 GLB 模型

// 作物道具 ID（在 constants.js 中定义 BCOL/BNAMES，这里只声明常量）
var CROP_WHEAT  = 201;
var CROP_CARROT = 202;

BCOL[CROP_WHEAT]  = [0.89,0.82,0.22, 0.89,0.82,0.22, 0.89,0.82,0.22];
BCOL[CROP_CARROT] = [0.91,0.48,0.14, 0.91,0.48,0.14, 0.91,0.48,0.14];
BNAMES[CROP_WHEAT]  = '🌾小麦';
BNAMES[CROP_CARROT] = '🥕胡萝卜';

// growTime: 整棵作物从种下到成熟的总秒数（4个阶段均分）
var CROP_DEFS = {};
CROP_DEFS[CROP_WHEAT]  = { stages: ['Wheat_1','Wheat_2','Wheat_3','Wheat_4'], growTime: 60,  scale: 0.95 };
CROP_DEFS[CROP_CARROT] = { stages: ['Carrot_1','Carrot_2','Carrot_3','Carrot_4'], growTime: 90, scale: 0.70 };

var _cropGltf   = {};  // filename → THREE.Group (raw scene, 用于 clone)
var _cropPlaced = {};  // "wx,wy,wz" → { typeId, stage, elapsed, group }

function _loadCropModel(filename, cb) {
  if (_cropGltf[filename]) { cb(); return; }
  gltfLoader.load('assets/models/crops/' + filename + '.glb', function (g) {
    _cropGltf[filename] = g.scene;
    cb();
  });
}

function _makeCropModel(typeId, filename) {
  var src = _cropGltf[filename];
  if (!src) return null;
  var def = CROP_DEFS[typeId];
  var model = src.clone(true);
  model.scale.setScalar(def.scale);
  model.updateMatrixWorld(true);
  var bb = new THREE.Box3().setFromObject(model);
  model.position.y = -bb.min.y;
  return model;
}

function _setCropStageModel(key, entry) {
  if (entry.group && scene) { scene.remove(entry.group); entry.group = null; }
  var def = CROP_DEFS[entry.typeId];
  var filename = def.stages[entry.stage];
  var parts = key.split(',');
  var wx = +parts[0], wy = +parts[1], wz = +parts[2];

  _loadCropModel(filename, function () {
    if (!_cropPlaced[key]) return;  // was removed while loading
    var model = _makeCropModel(entry.typeId, filename);
    if (!model) return;
    model.position.x = wx + 0.5;
    model.position.z = wz + 0.5;
    model.position.y += wy;
    entry.group = model;
    if (scene) scene.add(model);
  });
}

function plantCrop(typeId, wx, wy, wz) {
  if (!CROP_DEFS[typeId]) return;
  var key = wx + ',' + wy + ',' + wz;
  if (_cropPlaced[key]) return;
  var entry = { typeId: typeId, stage: 0, elapsed: 0, group: null };
  _cropPlaced[key] = entry;
  _setCropStageModel(key, entry);
}

function updateCrops(dt) {
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var entry = _cropPlaced[key];
    var def = CROP_DEFS[entry.typeId];
    if (entry.stage >= def.stages.length - 1) continue;
    entry.elapsed += dt;
    var stageDur = def.growTime / (def.stages.length - 1);
    while (entry.elapsed >= stageDur && entry.stage < def.stages.length - 1) {
      entry.elapsed -= stageDur;
      entry.stage++;
      _setCropStageModel(key, entry);
    }
  }
}

// Returns nearest mature-crop key within radius, or null
function nearestMatureCrop(px, py, pz, radius) {
  var best = null, bestD = radius * radius;
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var e = _cropPlaced[key];
    if (e.stage < CROP_DEFS[e.typeId].stages.length - 1) continue;  // not mature
    var parts = key.split(',');
    var dx = +parts[0] + 0.5 - px, dy = +parts[1] - py, dz = +parts[2] + 0.5 - pz;
    var d2 = dx*dx + dy*dy*0.5 + dz*dz;
    if (d2 < bestD) { bestD = d2; best = key; }
  }
  return best;
}

// Remove crop at (wx,wy,wz), returns typeId if mature else 0
function harvestCrop(wx, wy, wz) {
  var key = wx + ',' + wy + ',' + wz;
  var entry = _cropPlaced[key];
  if (!entry) return 0;
  var def = CROP_DEFS[entry.typeId];
  var mature = (entry.stage >= def.stages.length - 1);
  if (entry.group && scene) scene.remove(entry.group);
  delete _cropPlaced[key];
  return mature ? entry.typeId : 0;
}

function isCropSeed(id) { return !!CROP_DEFS[id]; }

function serializeCrops() {
  var arr = [];
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var e = _cropPlaced[key];
    arr.push([key, e.typeId, e.stage, Math.round(e.elapsed * 100) / 100]);
  }
  return arr;
}

function deserializeCrops(arr) {
  if (!arr) return;
  for (var i = 0; i < arr.length; i++) {
    var item = arr[i];
    var key = item[0];
    var entry = { typeId: item[1], stage: item[2], elapsed: item[3] || 0, group: null };
    _cropPlaced[key] = entry;
    _setCropStageModel(key, entry);
  }
}
