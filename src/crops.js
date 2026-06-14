// ─── crops.js ─────────────────────────────────────────────────────────────────
// 农场种植系统：种子放置 → 多阶段生长（3D浮动倒计时）→ 收获
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
var _cropPlaced = {};  // "wx,wy,wz" → { typeId, stage, elapsed, group, sprite }

// ── 3D Billboard 倒计时标签 ───────────────────────────────────────────────────
function _makeTimerSprite(text, isMature) {
  var c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  var ctx = c.getContext('2d');
  ctx.fillStyle = isMature ? 'rgba(40,180,60,0.90)' : 'rgba(0,0,0,0.70)';
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(4, 12, 248, 40, 14);
    ctx.fill();
  } else {
    ctx.fillRect(4, 12, 248, 40);
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  var tex = new THREE.CanvasTexture(c);
  var mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  var sp = new THREE.Sprite(mat);
  sp.scale.set(2.0, 0.5, 1);
  return sp;
}

function _getSpriteText(entry) {
  var def = CROP_DEFS[entry.typeId];
  var maxStage = def.stages.length - 1;
  if (entry.stage >= maxStage) return { text: '✅ 成熟', mature: true };
  var stageDur = def.growTime / maxStage;
  var rem = Math.ceil(stageDur - entry.elapsed);
  var stageName = entry.stage === 0 ? '🌱幼苗' : '🌿生长';
  return { text: stageName + ' · ' + rem + 's', mature: false };
}

function _updateEntrySprite(key, entry) {
  var def = CROP_DEFS[entry.typeId];
  var parts = key.split(',');
  var wx = +parts[0], wy = +parts[1], wz = +parts[2];
  var labelY = wy + def.targetH + 0.6;

  var info = _getSpriteText(entry);

  if (entry.sprite) {
    // 复用 sprite，只重绘纹理
    var mat = entry.sprite.material;
    var c = mat.map.image;
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = info.mature ? 'rgba(40,180,60,0.90)' : 'rgba(0,0,0,0.70)';
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(4, 12, 248, 40, 14);
      ctx.fill();
    } else {
      ctx.fillRect(4, 12, 248, 40);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(info.text, 128, 32);
    mat.map.needsUpdate = true;
    entry.sprite.position.set(wx + 0.5, labelY, wz + 0.5);
  } else {
    var sp = _makeTimerSprite(info.text, info.mature);
    sp.position.set(wx + 0.5, labelY, wz + 0.5);
    entry.sprite = sp;
    if (scene) scene.add(sp);
  }
}

function _removeEntrySprite(entry) {
  if (!entry.sprite) return;
  if (scene) scene.remove(entry.sprite);
  entry.sprite.material.map.dispose();
  entry.sprite.material.dispose();
  entry.sprite = null;
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

// 保留原始GLTF每mesh颜色，只换材质类型为Lambert（避免PBR sRGB暗色问题）
function _makeCropModel(typeId, filename) {
  var src = _cropGltf[filename];
  if (!src) return null;
  var def = CROP_DEFS[typeId];
  var model = src.clone(true);

  var sc = def.scale || (def.targetH > 1.5 ? 0.50 : 0.85);
  model.scale.setScalar(sc);

  model.traverse(function (child) {
    if (!child.isMesh) return;
    var origColor = (child.material && child.material.color)
      ? child.material.color.clone()
      : new THREE.Color(1, 1, 1);
    child.material = new THREE.MeshLambertMaterial({ color: origColor });
  });
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
  var entry = { typeId: typeId, stage: 0, elapsed: 0, group: null, sprite: null };
  _cropPlaced[key] = entry;
  _setCropStageModel(key, entry);
  _updateEntrySprite(key, entry);
}

var _timerT = 0;

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

  if (doTimer) {
    for (var k in _cropPlaced) {
      if (_cropPlaced.hasOwnProperty(k)) _updateEntrySprite(k, _cropPlaced[k]);
    }
  }
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
  _removeEntrySprite(entry);
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
    var entry = { typeId: item[1], stage: item[2], elapsed: item[3] || 0, group: null, sprite: null };
    _cropPlaced[key] = entry;
    _setCropStageModel(key, entry);
    _updateEntrySprite(key, entry);
  }
}
