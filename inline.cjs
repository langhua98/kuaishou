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
  'src/textures.js',  // atlasTexture + BTEX（需在 mesh.js 之前）
  'src/mesh.js',
  'src/physics.js',
  'src/raycast.js',
  'src/controls.js',
  'src/ui.js',
  'src/audio.js',    // 音乐 + 音效（需在 game.js 之前：game.js 调用其函数）
  'src/models.js',      // GLTF 玩家模型 + NPC（需在 game.js 之前）
  'src/structures.js',  // 开源中式建筑数据 + placeStructures()（需在 game.js 之前）
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
