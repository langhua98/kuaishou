// Build: concatenate src/*.js files in order → inject into template.html → write index.html.
// GitHub Pages serves the main branch root directly, so index.html IS the deployed page.
//
// File order matters — later files depend on globals declared in earlier ones:
//   init.js       → window._ok/_step, DOM refs, setProgress
//   constants.js  → block IDs, BCOL, BNAMES, FACES, FSHADE, game constants
//   noise.js      → _perm, noise2D
//   world.js      → chunks, getBlock, setBlock, genTerrain
//   renderer.js   → renderer, scene, camera
//   mesh.js       → buildMesh, rebuildChunk, createChunk, removeChunk
//   physics.js    → resolveAABB
//   raycast.js    → raycast
//   controls.js   → joy, touch event handlers
//   ui.js         → buildHotbar
//   game.js       → player, tick, startGame, bootNext
const fs = require('fs')

const SRC_FILES = [
  'src/init.js',
  'src/constants.js',
  'src/noise.js',
  'src/world.js',
  'src/renderer.js',
  'src/sky.js',       // 昼夜+天气系统（需在 renderer.js 之后：用 scene/camera/noise2D）
  'src/textures.js',  // atlasTexture + BTEX（需在 mesh.js 之前）
  'src/mesh.js',
  'src/physics.js',
  'src/raycast.js',
  'src/controls.js',
  'src/ui.js',
  'src/audio.js',    // 音乐 + 音效（需在 game.js 之前：game.js 调用其函数）
  'src/models.js',      // GLTF 玩家模型 + NPC（需在 game.js 之前）
  // ── 军队战斗系统（依赖单向 ①→⑥，见 docs/battle-architecture.md）──
  'src/combat_data.js', // ① 配置：兵种表/调参/动画名
  'src/combat_core.js', // ② 单位：克隆/生成/动画/伤害（依赖 models.js 的 gltfLoader/_prepModel/_groundY）
  'src/combat_steer.js',// ③ 转向：避障/分离/地形跟随
  'src/combat_morale.js',// ③.5 士气：心理量/溃逃/连锁崩溃（被 core/ai 调用，函数全局，加载序灵活）
  'src/combat_fx.js',   // ④ 表现：箭矢/血条/音效/玩家HUD（combat_ai 调用其函数）
  'src/combat_ai.js',   // ⑤ 决策：FSM + combatUpdate 入口
  'src/combat_cmd.js',  // ⑥ 指挥：开战/命令按钮/波次胜负
  'src/combat_tower.js',// ⑦ 塔防：魔法塔/魔法弹/敌方攻塔（需在 combat_cmd 之后：placeTower 被 cmd 调用）
  'src/combat_particles.js',// ⑧ 粒子特效：spawnBurst/updateParticles（被 tower/ai 调用）
  'src/structures.js',  // 开源中式建筑数据 + placeStructures()（需在 game.js 之前）
  'src/furniture.js',  // 家具系统：KayKit GLTF 模型放置（需在 game.js 之前）
  'src/crops.js',      // 农场种植系统：种子/生长/收获（需在 game.js 之前）
  'src/vehicles.js',  // 载具系统：汽车/越野车/皮卡（需在 game.js 之前）
  'src/train.js',     // 高铁系统：固定轨道 + 自动往返列车（需在 game.js 之前）
  'src/save.js',        // 本地存档：玩家改动/位置/塔（需在 game.js 之前：loadGame/recordEdit 被 game 调用）
  'src/game.js',
]

let html = fs.readFileSync('template.html', 'utf8')

if (!html.includes('// GAME_JS_PLACEHOLDER')) {
  console.error('ERROR: placeholder not found in template.html')
  process.exit(1)
}

let js = SRC_FILES.map(function (f) {
  return '// ═══ ' + f + ' ═══\n' + fs.readFileSync(f, 'utf8')
}).join('\n\n')

// Escape closing script tags inside JS content to avoid breaking the HTML script block
js = js.replace(/<\/script/gi, '<\\/script')

html = html.replace('// GAME_JS_PLACEHOLDER', js)

fs.writeFileSync('index.html', html)

var srcKB   = (Buffer.byteLength(js,               'utf8') / 1024).toFixed(1)
var totalKB = (fs.statSync('index.html').size       / 1024).toFixed(1)
console.log('Done. game JS=' + srcKB + 'KB  index.html=' + totalKB + 'KB')
console.log('Files: ' + SRC_FILES.join(', '))
