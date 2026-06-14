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
// targetH: 成熟模型目标高度（格），加载 _4 时自动计算 scale = targetH / bbox.height
// scale: 运行时自动填入（初始 null → 首次加载 _4 后写入）
var CROP_DEFS = {};
CROP_DEFS[CROP_WHEAT]       ={stages:['Wheat_1','Wheat_2','Wheat_3','Wheat_4'],        growTime:60,  targetH:0.90, scale:null};
CROP_DEFS[CROP_CARROT]      ={stages:['Carrot_1','Carrot_2','Carrot_3','Carrot_4'],    growTime:90,  targetH:0.80, scale:null};
CROP_DEFS[CROP_APPLE]       ={stages:['Apple_1','Apple_2','Apple_3','Apple_4'],        growTime:120, targetH:3.50, scale:null};
CROP_DEFS[CROP_BAMBOO]      ={stages:['Bamboo_1','Bamboo_2','Bamboo_3','Bamboo_4'],    growTime:90,  targetH:3.20, scale:null};
CROP_DEFS[CROP_BEET]        ={stages:['Beet_1','Beet_2','Beet_3','Beet_4'],            growTime:60,  targetH:0.85, scale:null};
CROP_DEFS[CROP_BUSHBERRIES] ={stages:['BushBerries_1','BushBerries_2','BushBerries_3','BushBerries_4'], growTime:75, targetH:1.20, scale:null};
CROP_DEFS[CROP_CACTUS]      ={stages:['Cactus_1','Cactus_2','Cactus_3','Cactus_4'],   growTime:90,  targetH:1.30, scale:null};
CROP_DEFS[CROP_CORN]        ={stages:['Corn_1','Corn_2','Corn_3','Corn_4'],            growTime:80,  targetH:1.40, scale:null};
CROP_DEFS[CROP_FLOWER]      ={stages:['Flower_1','Flower_2','Flower_3','Flower_4'],   growTime:45,  targetH:0.75, scale:null};
CROP_DEFS[CROP_LETTUCE]     ={stages:['Lettuce_1','Lettuce_2','Lettuce_3','Lettuce_4'],growTime:60, targetH:0.80, scale:null};
CROP_DEFS[CROP_MUSHROOM]    ={stages:['Mushroom_1','Mushroom_2','Mushroom_3','Mushroom_4'],growTime:60,targetH:0.85,scale:null};
CROP_DEFS[CROP_ORANGE]      ={stages:['Orange_1','Orange_2','Orange_3','Orange_4'],    growTime:120, targetH:3.20, scale:null};
CROP_DEFS[CROP_PALMTREE]    ={stages:['PalmTree_1','PalmTree_2','PalmTree_3','PalmTree_4'],growTime:150,targetH:3.80,scale:null};
CROP_DEFS[CROP_PUMPKIN_CROP]={stages:['Pumpkin_1','Pumpkin_2','Pumpkin_3','Pumpkin_4'],growTime:90, targetH:1.10, scale:null};
CROP_DEFS[CROP_RICE]        ={stages:['Rice_1','Rice_2','Rice_3','Rice_4'],            growTime:70,  targetH:0.95, scale:null};
CROP_DEFS[CROP_TOMATO]      ={stages:['Tomato_1','Tomato_2','Tomato_3','Tomato_4'],   growTime:80,  targetH:1.10, scale:null};
CROP_DEFS[CROP_WATERMELON]  ={stages:['Watermelon_1','Watermelon_2','Watermelon_3','Watermelon_4'],growTime:90,targetH:1.00,scale:null};

var _cropGltf   = {};  // filename → THREE.Group (raw scene, 用于 clone)
var _cropPlaced = {};  // "wx,wy,wz" → { typeId, stage, elapsed, group }

// ── 浮动倒计时标签 ────────────────────────────────────────────────────────────
var _timerEl = null;
var _timerT  = 0;

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

  // 1. 收集所有可见作物（背面剔除 + 屏幕外剔除）
  var candidates = [];
  for (var key in _cropPlaced) {
    if (!_cropPlaced.hasOwnProperty(key)) continue;
    var entry = _cropPlaced[key];
    var def = CROP_DEFS[entry.typeId];
    var parts = key.split(',');
    var wx = +parts[0], wy = +parts[1], wz = +parts[2];

    // 用玩家坐标计算距离（player 是全局变量）
    var dx = wx + 0.5 - (player ? player.x : 0);
    var dy = wy     - (player ? player.y : 0);
    var dz = wz + 0.5 - (player ? player.z : 0);
    var dist2 = dx*dx + dy*dy*0.25 + dz*dz;

    v.set(wx + 0.5, wy + 1.8, wz + 0.5);
    v.project(camera);
    if (v.z > 1 || v.z < -1) continue;
    var sx = (v.x * 0.5 + 0.5) * W;
    var sy = (-v.y * 0.5 + 0.5) * H;
    if (sx < -90 || sx > W + 90 || sy < -24 || sy > H + 24) continue;

    var maxStage = def.stages.length - 1;
    var text, bg;
    if (entry.stage >= maxStage) {
      text = '✅ 成熟';
      bg = 'rgba(40,180,60,.80)';
    } else {
      var stageDur = def.growTime / maxStage;
      var rem = Math.ceil(stageDur - entry.elapsed);
      var stageName = entry.stage === 0 ? '🌱幼苗' : '🌿生长';
      text = stageName + ' · ' + rem + 's';
      bg = 'rgba(0,0,0,.62)';
    }
    candidates.push({ sx: sx, sy: sy, text: text, bg: bg, dist2: dist2 });
  }

  // 2. 距离排序（近优先）
  candidates.sort(function (a, b) { return a.dist2 - b.dist2; });

  // 3. 去重叠：逐个检查，与已接受标签距离太近则跳过
  var accepted = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var overlap = false;
    for (var j = 0; j < accepted.length; j++) {
      var a = accepted[j];
      if (Math.abs(c.sx - a.sx) < 88 && Math.abs(c.sy - a.sy) < 24) {
        overlap = true; break;
      }
    }
    if (overlap) continue;
    accepted.push(c);
    var lbl = document.createElement('div');
    lbl.textContent = c.text;
    lbl.style.cssText =
      'position:absolute;left:' + Math.round(c.sx) + 'px;top:' + Math.round(c.sy) + 'px;' +
      'background:' + c.bg + ';color:#fff;font-size:11px;font-family:monospace;' +
      'padding:2px 6px;border-radius:10px;white-space:nowrap;' +
      'transform:translateX(-50%);user-select:none';
    _timerEl.appendChild(lbl);
  }
}

// ── GLB 加载 ──────────────────────────────────────────────────────────────────
function _loadCropModel(filename, cb) {
  if (_cropGltf[filename]) { cb(); return; }
  gltfLoader.load('assets/models/crops/' + filename + '.glb', function (g) {
    _cropGltf[filename] = g.scene;

    // 成熟阶段（_4）加载时根据 BBox 计算 def.scale = targetH / 模型高度
    if (filename.slice(-2) === '_4') {
      var bb = new THREE.Box3().setFromObject(g.scene);
      var h = bb.max.y - bb.min.y;
      if (h > 0.01) {
        for (var tid in CROP_DEFS) {
          if (!CROP_DEFS.hasOwnProperty(tid)) continue;
          var d = CROP_DEFS[tid];
          if (d.stages && d.stages[d.stages.length - 1] === filename) {
            d.scale = d.targetH / h;
            break;
          }
        }
      }
    }
    cb();
  });
}

// 所有阶段统一使用 BCOL[typeId] 颜色的 Lambert 材质，解决 obj2gltf 颜色空间问题
function _makeCropModel(typeId, filename) {
  var src = _cropGltf[filename];
  if (!src) return null;
  var def = CROP_DEFS[typeId];
  var model = src.clone(true);

  // 动态 scale：_4 加载后才有值；早期阶段用 targetH 推算一个近似值
  var sc = def.scale || (def.targetH > 1.5 ? 0.50 : 0.85);
  model.scale.setScalar(sc);

  // 用 BCOL 颜色替换所有材质（绕过 obj2gltf 颜色空间问题）
  var bc = BCOL[typeId];
  if (bc) {
    var col = new THREE.Color(bc[0], bc[1], bc[2]);
    model.traverse(function (child) {
      if (!child.isMesh) return;
      child.material = new THREE.MeshLambertMaterial({ color: col });
    });
  }
  return model;
}

function _setCropStageModel(key, entry) {
  if (entry.group && scene) { scene.remove(entry.group); entry.group = null; }
  var def = CROP_DEFS[entry.typeId];
  var filename = def.stages[entry.stage];
  var parts = key.split(',');
  var wx = +parts[0], wy = +parts[1], wz = +parts[2];

  _loadCropModel(filename, function () {
    if (!_cropPlaced[key]) return;
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
