// ─── crops.js ─────────────────────────────────────────────────────────────────
// 农场种植系统：种子放置 → 多阶段生长（浮动倒计时）→ 收获
// 使用 Quaternius Ultimate Crops Pack（CC0）转换的 GLB 模型

// ── 作物道具 ID ───────────────────────────────────────────────────────────────
var CROP_WHEAT       = 201;
var CROP_CARROT      = 202;
var CROP_APPLE       = 203;
var CROP_BAMBOO      = 204;
var CROP_BEET        = 205;
var CROP_BUSHBERRIES = 206;
var CROP_CACTUS      = 207;
var CROP_CORN        = 208;
var CROP_FLOWER      = 209;
var CROP_LETTUCE     = 210;
var CROP_MUSHROOM    = 211;
var CROP_ORANGE      = 212;
var CROP_PALMTREE    = 213;
var CROP_PUMPKIN_CROP = 214;
var CROP_RICE        = 215;
var CROP_TOMATO      = 216;
var CROP_WATERMELON  = 217;

BCOL[201]=[0.89,0.82,0.22,0.89,0.82,0.22,0.89,0.82,0.22]; BNAMES[201]='🌾小麦';
BCOL[202]=[0.91,0.48,0.14,0.91,0.48,0.14,0.91,0.48,0.14]; BNAMES[202]='🥕胡萝卜';
BCOL[203]=[0.54,0.75,0.30,0.54,0.75,0.30,0.54,0.75,0.30]; BNAMES[203]='🍎苹果树';
BCOL[204]=[0.35,0.60,0.25,0.35,0.60,0.25,0.35,0.60,0.25]; BNAMES[204]='🎋竹子';
BCOL[205]=[0.72,0.14,0.35,0.72,0.14,0.35,0.72,0.14,0.35]; BNAMES[205]='🫚甜菜';
BCOL[206]=[0.25,0.20,0.60,0.25,0.20,0.60,0.25,0.20,0.60]; BNAMES[206]='🫐浆果';
BCOL[207]=[0.30,0.62,0.30,0.30,0.62,0.30,0.30,0.62,0.30]; BNAMES[207]='🌵仙人掌';
BCOL[208]=[0.95,0.85,0.25,0.95,0.85,0.25,0.95,0.85,0.25]; BNAMES[208]='🌽玉米';
BCOL[209]=[0.95,0.45,0.65,0.95,0.45,0.65,0.95,0.45,0.65]; BNAMES[209]='🌸花朵';
BCOL[210]=[0.35,0.70,0.28,0.35,0.70,0.28,0.35,0.70,0.28]; BNAMES[210]='🥬生菜';
BCOL[211]=[0.82,0.55,0.20,0.82,0.55,0.20,0.82,0.55,0.20]; BNAMES[211]='🍄蘑菇';
BCOL[212]=[0.92,0.58,0.18,0.92,0.58,0.18,0.92,0.58,0.18]; BNAMES[212]='🍊橙树';
BCOL[213]=[0.28,0.58,0.22,0.28,0.58,0.22,0.28,0.58,0.22]; BNAMES[213]='🌴棕榈树';
BCOL[214]=[0.84,0.46,0.08,0.84,0.46,0.08,0.84,0.46,0.08]; BNAMES[214]='🎃南瓜';
BCOL[215]=[0.75,0.80,0.30,0.75,0.80,0.30,0.75,0.80,0.30]; BNAMES[215]='🌾水稻';
BCOL[216]=[0.90,0.22,0.18,0.90,0.22,0.18,0.90,0.22,0.18]; BNAMES[216]='🍅番茄';
BCOL[217]=[0.22,0.68,0.22,0.22,0.68,0.22,0.22,0.68,0.22]; BNAMES[217]='🍉西瓜';

// ── 作物定义 ──────────────────────────────────────────────────────────────────
// scale: 统一缩放（使最大阶段约 0.85 块高），不设则自动按阶段高度缩放
// growTime: 从种下到成熟总秒数（均分 stages.length-1 个阶段）
var CROP_DEFS = {};
CROP_DEFS[CROP_WHEAT]       ={stages:['Wheat_1','Wheat_2','Wheat_3','Wheat_4'],        growTime:60,  scale:0.95};
CROP_DEFS[CROP_CARROT]      ={stages:['Carrot_1','Carrot_2','Carrot_3','Carrot_4'],    growTime:90,  scale:0.70};
CROP_DEFS[CROP_APPLE]       ={stages:['Apple_1','Apple_2','Apple_3','Apple_4'],        growTime:120, scale:0.50};
CROP_DEFS[CROP_BAMBOO]      ={stages:['Bamboo_1','Bamboo_2','Bamboo_3','Bamboo_4'],    growTime:90,  scale:0.60};
CROP_DEFS[CROP_BEET]        ={stages:['Beet_1','Beet_2','Beet_3','Beet_4'],            growTime:60,  scale:0.90};
CROP_DEFS[CROP_BUSHBERRIES] ={stages:['BushBerries_1','BushBerries_2','BushBerries_3','BushBerries_4'], growTime:75, scale:0.70};
CROP_DEFS[CROP_CACTUS]      ={stages:['Cactus_1','Cactus_2','Cactus_3','Cactus_4'],   growTime:90,  scale:0.65};
CROP_DEFS[CROP_CORN]        ={stages:['Corn_1','Corn_2','Corn_3','Corn_4'],            growTime:80,  scale:0.70};
CROP_DEFS[CROP_FLOWER]      ={stages:['Flower_1','Flower_2','Flower_3','Flower_4'],   growTime:45,  scale:1.00};
CROP_DEFS[CROP_LETTUCE]     ={stages:['Lettuce_1','Lettuce_2','Lettuce_3','Lettuce_4'],growTime:60, scale:1.00};
CROP_DEFS[CROP_MUSHROOM]    ={stages:['Mushroom_1','Mushroom_2','Mushroom_3','Mushroom_4'],growTime:60,scale:0.90};
CROP_DEFS[CROP_ORANGE]      ={stages:['Orange_1','Orange_2','Orange_3','Orange_4'],    growTime:120, scale:0.50};
CROP_DEFS[CROP_PALMTREE]    ={stages:['PalmTree_1','PalmTree_2','PalmTree_3','PalmTree_4'],growTime:150,scale:0.40};
CROP_DEFS[CROP_PUMPKIN_CROP]={stages:['Pumpkin_1','Pumpkin_2','Pumpkin_3','Pumpkin_4'],growTime:90, scale:0.75};
CROP_DEFS[CROP_RICE]        ={stages:['Rice_1','Rice_2','Rice_3','Rice_4'],            growTime:70,  scale:0.80};
CROP_DEFS[CROP_TOMATO]      ={stages:['Tomato_1','Tomato_2','Tomato_3','Tomato_4'],   growTime:80,  scale:0.80};
CROP_DEFS[CROP_WATERMELON]  ={stages:['Watermelon_1','Watermelon_2','Watermelon_3','Watermelon_4'],growTime:90,scale:0.70};

var _cropGltf   = {};  // filename → THREE.Group (raw scene, 用于 clone)
var _cropPlaced = {};  // "wx,wy,wz" → { typeId, stage, elapsed, group }

// ── 浮动倒计时标签 ────────────────────────────────────────────────────────────
var _timerEl = null;
var _timerT  = 0;   // 刷新节流计时器

function _ensureTimerEl() {
  if (_timerEl) return;
  _timerEl = document.createElement('div');
  _timerEl.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:150;overflow:hidden';
  document.body.appendChild(_timerEl);
}

function _updateCropTimers() {
  if (!_timerEl || !camera) return;
  _timerEl.innerHTML = '';
  var W = window.innerWidth, H = window.innerHeight;
  var v = new THREE.Vector3();
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var entry = _cropPlaced[key];
    var def = CROP_DEFS[entry.typeId];
    var parts = key.split(',');
    v.set(+parts[0] + 0.5, +parts[1] + 1.4, +parts[2] + 0.5);
    v.project(camera);
    if (v.z > 1 || v.z < -1) continue;  // behind camera
    var sx = (v.x * 0.5 + 0.5) * W;
    var sy = (-v.y * 0.5 + 0.5) * H;
    if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 20) continue;  // off screen

    var maxStage = def.stages.length - 1;
    var text, bg;
    if (entry.stage >= maxStage) {
      text = '✅ 成熟';
      bg = 'rgba(40,180,60,.80)';
    } else {
      var stageDur = def.growTime / maxStage;
      var rem = Math.ceil(stageDur - entry.elapsed);
      text = '阶段 ' + (entry.stage + 1) + '/' + maxStage + ' · ' + rem + 's';
      bg = 'rgba(0,0,0,.55)';
    }

    var lbl = document.createElement('div');
    lbl.textContent = text;
    lbl.style.cssText =
      'position:absolute;left:' + Math.round(sx) + 'px;top:' + Math.round(sy) + 'px;' +
      'background:' + bg + ';color:#fff;font-size:11px;font-family:monospace;' +
      'padding:2px 6px;border-radius:10px;white-space:nowrap;' +
      'transform:translateX(-50%);user-select:none';
    _timerEl.appendChild(lbl);
  }
}

// ── GLB 加载 ──────────────────────────────────────────────────────────────────
function _loadCropModel(filename, cb) {
  if (_cropGltf[filename]) { cb(); return; }
  gltfLoader.load('assets/models/crops/' + filename + '.glb', function (g) {
    // obj2gltf 生成 MeshStandardMaterial（需 envMap），换成 Lambert 响应场景灯光
    g.scene.traverse(function (child) {
      if (!child.isMesh) return;
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      var newMats = mats.map(function (m) {
        return new THREE.MeshLambertMaterial({ color: m.color });
      });
      child.material = newMats.length === 1 ? newMats[0] : newMats;
    });
    _cropGltf[filename] = g.scene;
    cb();
  });
}

function _makeCropModel(typeId, filename) {
  var src = _cropGltf[filename];
  if (!src) return null;
  var def = CROP_DEFS[typeId];
  var model = src.clone(true);
  model.scale.setScalar(def.scale || 0.8);
  // 不做 Y 底部对齐——Quaternius 模型 Y=0 本身就是地面，
  // 根部负 Y 自然插入土里，叶子正 Y 伸出地面（如胡萝卜）
  return model;
}

function _setCropStageModel(key, entry) {
  if (entry.group && scene) { scene.remove(entry.group); entry.group = null; }
  var def = CROP_DEFS[entry.typeId];
  var filename = def.stages[entry.stage];
  var parts = key.split(',');
  var wx = +parts[0], wy = +parts[1], wz = +parts[2];

  _loadCropModel(filename, function () {
    if (!_cropPlaced[key]) return;  // 加载期间已被移除
    var model = _makeCropModel(entry.typeId, filename);
    if (!model) return;
    model.position.set(wx + 0.5, wy, wz + 0.5);
    entry.group = model;
    if (scene) scene.add(model);
  });
}

// ── 公开 API ──────────────────────────────────────────────────────────────────
function plantCrop(typeId, wx, wy, wz) {
  if (!CROP_DEFS[typeId]) return;
  var key = wx + ',' + wy + ',' + wz;
  if (_cropPlaced[key]) return;
  _ensureTimerEl();
  var entry = { typeId: typeId, stage: 0, elapsed: 0, group: null };
  _cropPlaced[key] = entry;
  _setCropStageModel(key, entry);
}

function updateCrops(dt) {
  _timerT += dt;
  var doTimer = (_timerT >= 0.5);
  if (doTimer) _timerT = 0;

  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var entry = _cropPlaced[key];
    var def = CROP_DEFS[entry.typeId];
    if (entry.stage < def.stages.length - 1) {
      entry.elapsed += dt;
      var stageDur = def.growTime / (def.stages.length - 1);
      while (entry.elapsed >= stageDur && entry.stage < def.stages.length - 1) {
        entry.elapsed -= stageDur;
        entry.stage++;
        _setCropStageModel(key, entry);
      }
    }
  }

  if (doTimer) _updateCropTimers();
}

// 返回 radius 范围内最近的成熟作物 key，否则返回 null
function nearestMatureCrop(px, py, pz, radius) {
  var best = null, bestD = radius * radius;
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var e = _cropPlaced[key];
    if (e.stage < CROP_DEFS[e.typeId].stages.length - 1) continue;
    var parts = key.split(',');
    var dx = +parts[0] + 0.5 - px, dy = +parts[1] - py, dz = +parts[2] + 0.5 - pz;
    var d2 = dx*dx + dy*dy*0.5 + dz*dz;
    if (d2 < bestD) { bestD = d2; best = key; }
  }
  return best;
}

// 移除并返回 typeId（成熟时）或 0（未成熟时）
function harvestCrop(wx, wy, wz) {
  var key = wx + ',' + wy + ',' + wz;
  var entry = _cropPlaced[key];
  if (!entry) return 0;
  var def = CROP_DEFS[entry.typeId];
  var mature = (entry.stage >= def.stages.length - 1);
  if (entry.group && scene) scene.remove(entry.group);
  delete _cropPlaced[key];
  _updateCropTimers();
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
  _ensureTimerEl();
  for (var i = 0; i < arr.length; i++) {
    var item = arr[i];
    var key = item[0];
    var entry = { typeId: item[1], stage: item[2], elapsed: item[3] || 0, group: null };
    _cropPlaced[key] = entry;
    _setCropStageModel(key, entry);
  }
}
