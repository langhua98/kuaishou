// ─── audio.js ─────────────────────────────────────────────────────────────────
// 音乐 + 音效系统（assets/sounds/，MC 原版音效转 mp3，iOS Safari 不支持 ogg）。
//
// 架构：
//   背景音乐 — HTMLAudioElement 流式循环播放（calm1，C418），不占解码内存
//   音效     — Web Audio API：XHR 预载 + decodeAudioData，
//              播放时随机选变体 + 随机音高（0.85–1.05，MC 同款手感）
//
// iOS 解锁：AudioContext 必须由用户手势激活 → startGame（开始按钮）里调
//   unlockAudio()，恢复 ctx 并启动音乐。
//
// 对外接口：
//   initAudio()        — 创建 ctx 并异步预载所有音效（启动时调，不阻塞）
//   unlockAudio()      — 用户手势内调用：resume ctx + 播放音乐
//   digSound(blockId)  — 破坏/放置音效（按方块材质选 dig 组）
//   stepSound(blockId) — 脚步声（按脚下方块材质选 step 组）
//   splashSound()      — 入水水花

var _actx = null, _sfxBuf = {}, _musicEl = null, _musicIdx = 0;
var _MUSIC_TRACKS = [
  'assets/sounds/music_calm1.mp3',
  'assets/sounds/music_forest.mp3',
  'assets/sounds/music_town.mp3',
];

// 音效组 → 变体文件名（assets/sounds/*.mp3）
var _SFX = {
  dig_grass:    ['dig_grass1', 'dig_grass2'],
  dig_stone:    ['dig_stone1', 'dig_stone2'],
  dig_wood:     ['dig_wood1', 'dig_wood2'],
  dig_sand:     ['dig_sand1', 'dig_sand2'],
  step_grass:   ['step_grass1', 'step_grass2', 'step_grass3'],
  step_stone:   ['step_stone1', 'step_stone2', 'step_stone3'],
  step_wood:    ['step_wood1', 'step_wood2'],
  step_sand:    ['step_sand1', 'step_sand2'],
  splash:       ['random_splash'],
  // 战斗音效（combat_fx.js battleSfx 使用）
  atk_swing:    ['atk_swing1', 'atk_swing2'],
  atk_clang:    ['atk_clang1', 'atk_clang2'],
  atk_hit:      ['atk_hit1', 'atk_hit2'],
  atk_bow:      ['atk_bow'],
  atk_draw:     ['atk_draw'],
  // 塔攻击 / 敌方单位 / UI
  tower_magic:  ['rpg_magic1', 'rpg_spell'],
  enemy_hurt:   ['enemy_hurt1', 'enemy_hurt2', 'enemy_hurt3'],
  enemy_death:  ['enemy_death1', 'enemy_death2', 'fps_enemy_destroy'],
  ui_click:     ['rpg_interface1', 'rpg_interface2', 'rpg_interface3'],
  ui_place:     ['ui_placement-a', 'ui_placement-b'],
  ui_remove:    ['ui_removal-a']
};

// 方块 ID → 材质名（dig_/step_ 前缀拼接）
var _MAT = [
  null,    // 0  AIR
  'grass', // 1  GRASS
  'grass', // 2  DIRT
  'stone', // 3  STONE
  'sand',  // 4  SAND
  'wood',  // 5  WOOD
  'grass', // 6  LEAVES
  null,    // 7  WATER
  'stone', // 8  RED_WALL
  'stone', // 9  GOLD_ROOF
  'stone', // 10 WHITE_STONE
  'stone', // 11 GRAY_BRICK
  'stone', // 12 GRAY_ROOF
  'wood',  // 13 RED_PILLAR
  'wood',  // 14 PLANKS
  'stone', // 15 COBBLE
  'sand',  // 16 MUD_BRICK
  'stone', // 17 TERRITORY_STONE
  'stone', // 18 ICE
  'grass', // 19 SNOW
  'stone', // 20 IRON_ORE
  'stone', // 21 GLASS
  'stone', // 22 OBSIDIAN
  'sand',  // 23 GRAVEL
  'sand',  // 24 RED_SAND
  'wood',  // 25 TNT
  'wood',  // 26 PUMPKIN
  'stone', // 27 COAL_ORE
];

function initAudio() {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;   // 极旧浏览器：静默降级
  _actx = new AC();

  // 预载所有音效变体
  Object.keys(_SFX).forEach(function (group) {
    _SFX[group].forEach(function (name) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'assets/sounds/' + name + '.mp3', true);
      xhr.responseType = 'arraybuffer';
      xhr.onload = function () {
        if (xhr.status !== 200) return;
        _actx.decodeAudioData(xhr.response, function (buf) {
          _sfxBuf[name] = buf;
        }, function () {});
      };
      xhr.send();
    });
  });

  // 背景音乐：顺序播放 3 首曲目，循环
  function _loadTrack(idx) {
    var el = new Audio(_MUSIC_TRACKS[idx % _MUSIC_TRACKS.length]);
    el.volume = 0.35;
    el.preload = 'auto';
    el.addEventListener('ended', function () {
      _musicIdx = (idx + 1) % _MUSIC_TRACKS.length;
      _musicEl = null;
      _loadTrack(_musicIdx);
      if (_actx) {
        var p = _musicEl.play();
        if (p && p.catch) p.catch(function () {});
      }
    });
    _musicEl = el;
  }
  _loadTrack(0);
}

// 用户手势内调用（iOS 音频解锁）
function unlockAudio() {
  if (_actx && _actx.state === 'suspended') _actx.resume();
  if (_musicEl && _musicEl.paused) {
    var p = _musicEl.play();
    if (p && p.catch) p.catch(function () {});  // 自动播放被拒：静默
  }
}

// 播放一组音效：随机变体 + 随机音高
function _playSfx(group, vol, pitchLo, pitchHi) {
  if (!_actx || _actx.state !== 'running') return;
  var names = _SFX[group];
  if (!names) return;
  var buf = _sfxBuf[names[(Math.random() * names.length) | 0]];
  if (!buf) return;
  var src  = _actx.createBufferSource();
  var gain = _actx.createGain();
  src.buffer = buf;
  src.playbackRate.value = pitchLo + Math.random() * (pitchHi - pitchLo);
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(_actx.destination);
  src.start(0);
}

function digSound(blockId) {
  var m = _MAT[blockId];
  if (m) _playSfx('dig_' + m, 0.7, 0.85, 1.05);
}

function stepSound(blockId) {
  var m = _MAT[blockId];
  if (m) _playSfx('step_' + m, 0.3, 0.9, 1.1);
}

function splashSound() {
  _playSfx('splash', 0.6, 0.9, 1.1);
}

function placeSound() {
  _playSfx('ui_place', 0.55, 0.9, 1.1);
}

function removeSound(blockId) {
  // 破坏音用材质特定音效；若无材质则用通用移除音
  var m = _MAT[blockId];
  if (m) _playSfx('dig_' + m, 0.7, 0.85, 1.05);
  else _playSfx('ui_remove', 0.6, 0.9, 1.1);
}

function uiClickSound() {
  _playSfx('ui_click', 0.45, 0.95, 1.05);
}
