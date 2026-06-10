import {
  WebGLRenderer, Scene, Fog, PerspectiveCamera,
  BufferGeometry, BufferAttribute, Mesh,
  MeshLambertMaterial, AmbientLight, DirectionalLight,
  Vector3, Euler, Color
} from 'three'
import { createNoise2D } from 'simplex-noise'

// ─── Signal that the bundle started executing ─────────────────────────────────
window._ok = true

// ─── Helper to show loading progress ─────────────────────────────────────────
var _lf = document.getElementById('loading-fill')
var _lt = document.getElementById('loading-text')
function setProgress(pct, msg) {
  if (_lf) _lf.style.width = pct + '%'
  if (_lt) _lt.textContent = msg
}
function nextFrame() { return new Promise(function(r) { requestAnimationFrame(r) }) }

// ─── Constants ────────────────────────────────────────────────────────────────
var CHUNK_W = 16, CHUNK_H = 64, CHUNK_D = 16
var SEA_LEVEL = 12, TERRAIN_AMP = 14, TERRAIN_SCALE = 0.04
var GRAVITY = 28, JUMP_V = 10, PLAYER_H = 1.7, PLAYER_R = 0.3
var MOVE_SPEED = 5, FLY_SPEED = 8

var AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, WOOD=5, LEAVES=6, WATER=7

var BLOCK_COLOR = {}
BLOCK_COLOR[GRASS]  = [0x5db35d, 0x8B5E3C, 0x7a7a4a]
BLOCK_COLOR[DIRT]   = [0x8B5E3C, 0x8B5E3C, 0x8B5E3C]
BLOCK_COLOR[STONE]  = [0x888888, 0x888888, 0x888888]
BLOCK_COLOR[SAND]   = [0xd4c87a, 0xd4c87a, 0xd4c87a]
BLOCK_COLOR[WOOD]   = [0x5c3d1e, 0x5c3d1e, 0x7a5230]
BLOCK_COLOR[LEAVES] = [0x2d6e2d, 0x2d6e2d, 0x2d6e2d]
BLOCK_COLOR[WATER]  = [0x3366cc, 0x3366cc, 0x3366cc]

var BLOCK_NAMES = ['', '草地', '泥土', '石头', '沙子', '木头', '树叶', '水']

// ─── Renderer & Scene (created in boot to catch errors) ───────────────────────
var renderer, scene, camera, mat

function initRenderer() {
  renderer = new WebGLRenderer({ antialias: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  document.body.appendChild(renderer.domElement)

  scene = new Scene()
  scene.background = new Color(0x87ceeb)
  scene.fog = new Fog(0x87ceeb, 40, 80)

  camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.rotation.order = 'YXZ'

  scene.add(new AmbientLight(0xffffff, 0.6))
  var sun = new DirectionalLight(0xffffff, 0.8)
  sun.position.set(30, 60, 20)
  scene.add(sun)

  mat = new MeshLambertMaterial({ vertexColors: true })

  window.addEventListener('resize', function() {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })
}

// ─── World ────────────────────────────────────────────────────────────────────
var noise2D = createNoise2D()
var chunks = {}

function chunkKey(cx, cz) { return cx + ',' + cz }
function getChunk(cx, cz) { return chunks[chunkKey(cx, cz)] }

function worldToChunk(wx, wz) {
  return [Math.floor(wx / CHUNK_W), Math.floor(wz / CHUNK_D)]
}

function getBlock(wx, wy, wz) {
  if (wy < 0) return STONE
  if (wy >= CHUNK_H) return AIR
  var cx = Math.floor(wx / CHUNK_W)
  var cz = Math.floor(wz / CHUNK_D)
  var ch = getChunk(cx, cz)
  if (!ch) return AIR
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D
  return ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H]
}

function setBlock(wx, wy, wz, id) {
  if (wy < 0 || wy >= CHUNK_H) return
  var cx = Math.floor(wx / CHUNK_W)
  var cz = Math.floor(wz / CHUNK_D)
  var ch = getChunk(cx, cz)
  if (!ch) return
  var lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W
  var lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D
  ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id
  rebuildChunk(cx, cz)
  if (lx === 0)         rebuildChunk(cx-1, cz)
  if (lx === CHUNK_W-1) rebuildChunk(cx+1, cz)
  if (lz === 0)         rebuildChunk(cx, cz-1)
  if (lz === CHUNK_D-1) rebuildChunk(cx, cz+1)
}

function generateTerrain(cx, cz) {
  var data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D)
  for (var lx = 0; lx < CHUNK_W; lx++) {
    for (var lz = 0; lz < CHUNK_D; lz++) {
      var wx = cx * CHUNK_W + lx
      var wz = cz * CHUNK_D + lz
      var n = noise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE)
      var h = Math.floor(SEA_LEVEL + n * TERRAIN_AMP)
      for (var y = 0; y <= h && y < CHUNK_H; y++) {
        var id
        if (y === h)       id = (h <= SEA_LEVEL + 1) ? SAND : GRASS
        else if (y >= h-3) id = DIRT
        else               id = STONE
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id
      }
      for (var y2 = h + 1; y2 <= SEA_LEVEL; y2++) {
        data[lx + y2 * CHUNK_W + lz * CHUNK_W * CHUNK_H] = WATER
      }
    }
  }
  return data
}

// Face definitions: dir, corners, colorIndex(0=top,1=bottom,2=side)
var FACES = [
  { dir:[1,0,0],  corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], ci:2 },
  { dir:[-1,0,0], corners:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]], ci:2 },
  { dir:[0,1,0],  corners:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]], ci:0 },
  { dir:[0,-1,0], corners:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], ci:1 },
  { dir:[0,0,1],  corners:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]], ci:2 },
  { dir:[0,0,-1], corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], ci:2 },
]

function buildMesh(cx, cz, data) {
  var pos = [], col = [], idx = [], vi = 0
  for (var lx = 0; lx < CHUNK_W; lx++) {
    for (var y = 0; y < CHUNK_H; y++) {
      for (var lz = 0; lz < CHUNK_D; lz++) {
        var id = data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H]
        if (id === AIR) continue
        var wx = cx * CHUNK_W + lx
        var wz = cz * CHUNK_D + lz
        var cs = BLOCK_COLOR[id]
        if (!cs) continue
        for (var f = 0; f < 6; f++) {
          var face = FACES[f]
          var d = face.dir
          var nb = getBlock(wx+d[0], y+d[1], wz+d[2])
          // Only draw face if neighbour is transparent/air
          // Water: only show top face
          if (id === WATER && f !== 2) continue
          if (nb !== AIR && nb !== WATER) continue
          var hex = cs[face.ci]
          var r = ((hex >> 16) & 0xff) / 255
          var g = ((hex >> 8)  & 0xff) / 255
          var b = (hex & 0xff) / 255
          var corners = face.corners
          for (var c = 0; c < 4; c++) {
            var oc = corners[c]
            pos.push(wx+oc[0], y+oc[1], wz+oc[2])
            col.push(r, g, b)
          }
          idx.push(vi,vi+1,vi+2, vi,vi+2,vi+3)
          vi += 4
        }
      }
    }
  }
  if (pos.length === 0) return null
  var geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  geo.setAttribute('color',    new BufferAttribute(new Float32Array(col), 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function rebuildChunk(cx, cz) {
  var ch = getChunk(cx, cz)
  if (!ch) return
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null }
  var geo = buildMesh(cx, cz, ch.data)
  if (geo) { ch.mesh = new Mesh(geo, mat); scene.add(ch.mesh) }
}

function createChunk(cx, cz) {
  var key = chunkKey(cx, cz)
  if (chunks[key]) return
  chunks[key] = { data: generateTerrain(cx, cz), mesh: null }
}

// ─── Player ───────────────────────────────────────────────────────────────────
var player = {
  pos: new Vector3(8, SEA_LEVEL + TERRAIN_AMP + 4, 8),
  vel: new Vector3(),
  yaw: 0, pitch: 0,
  onGround: false,
  flying: false,
  jumpQueued: false,
  breakQueued: false,
  placeQueued: false,
  selectedSlot: 0,
  inventory: [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, WATER],
}

function resolveCollision(pos, vel) {
  var hw = PLAYER_R, hh = PLAYER_H
  var minX = pos.x - hw, maxX = pos.x + hw
  var minY = pos.y,       maxY = pos.y + hh
  var minZ = pos.z - hw, maxZ = pos.z + hw
  for (var bx = Math.floor(minX); bx <= Math.floor(maxX); bx++) {
    for (var by = Math.floor(minY); by <= Math.floor(maxY); by++) {
      for (var bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
        var bid = getBlock(bx, by, bz)
        if (bid === AIR || bid === WATER) continue
        var ox = Math.min(pos.x+hw-bx, bx+1-(pos.x-hw))
        var oy = Math.min(pos.y+hh-by, by+1-pos.y)
        var oz = Math.min(pos.z+hw-bz, bz+1-(pos.z-hw))
        if (ox <= 0 || oy <= 0 || oz <= 0) continue
        if (oy < ox && oy < oz) {
          if (pos.y + hh/2 < by + 0.5) { pos.y -= oy; vel.y = Math.min(vel.y, 0) }
          else { pos.y += oy; vel.y = Math.max(vel.y, 0); player.onGround = true }
        } else if (ox < oz) {
          pos.x += (pos.x < bx+0.5) ? -ox : ox; vel.x = 0
        } else {
          pos.z += (pos.z < bz+0.5) ? -oz : oz; vel.z = 0
        }
      }
    }
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
var joy = { active:false, id:-1, cx:0, cy:0, dx:0, dy:0 }
var look = { active:false, id:-1, lx:0, ly:0 }

var joyZone  = document.getElementById('joy-zone')
var joyThumb = document.getElementById('joy-thumb')
var joyBase  = document.getElementById('joy-base')
var lookZone = document.getElementById('look-zone')
var coordEl  = document.getElementById('coords')

joyZone.addEventListener('touchstart', function(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i]
    if (joy.active) continue
    joy.active = true; joy.id = t.identifier
    var r = joyBase.getBoundingClientRect()
    joy.cx = r.left + r.width/2; joy.cy = r.top + r.height/2
    joy.dx = 0; joy.dy = 0
  }
}, { passive:false })

joyZone.addEventListener('touchmove', function(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i]
    if (t.identifier !== joy.id) continue
    var MAX = 40
    joy.dx = Math.max(-MAX, Math.min(MAX, t.clientX - joy.cx))
    joy.dy = Math.max(-MAX, Math.min(MAX, t.clientY - joy.cy))
    joyThumb.style.transform = 'translate(calc(-50% + '+joy.dx+'px),calc(-50% + '+joy.dy+'px))'
  }
}, { passive:false })

function joyEnd(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === joy.id) {
      joy.active = false; joy.dx = 0; joy.dy = 0
      joyThumb.style.transform = 'translate(-50%,-50%)'
    }
  }
}
joyZone.addEventListener('touchend',    joyEnd, { passive:false })
joyZone.addEventListener('touchcancel', joyEnd, { passive:false })

lookZone.addEventListener('touchstart', function(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i]
    if (look.active) continue
    look.active = true; look.id = t.identifier
    look.lx = t.clientX; look.ly = t.clientY
  }
}, { passive:false })

lookZone.addEventListener('touchmove', function(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    var t = e.changedTouches[i]
    if (t.identifier !== look.id) continue
    player.yaw   -= (t.clientX - look.lx) * 0.004
    player.pitch -= (t.clientY - look.ly) * 0.004
    player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch))
    look.lx = t.clientX; look.ly = t.clientY
  }
}, { passive:false })

function lookEnd(e) {
  e.preventDefault()
  for (var i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === look.id) look.active = false
  }
}
lookZone.addEventListener('touchend',    lookEnd, { passive:false })
lookZone.addEventListener('touchcancel', lookEnd, { passive:false })

function tapBtn(id, fn) {
  var el = document.getElementById(id)
  if (el) el.addEventListener('touchstart', function(e) { e.preventDefault(); fn() }, { passive:false })
}
tapBtn('b-jump', function() { player.jumpQueued = true })
tapBtn('b-brk',  function() { player.breakQueued = true })
tapBtn('b-plc',  function() { player.placeQueued = true })
tapBtn('b-fly',  function() {
  player.flying = !player.flying
  player.vel.y = 0
  var el = document.getElementById('b-fly')
  if (el) el.classList.toggle('on', player.flying)
})

// ─── Hotbar ───────────────────────────────────────────────────────────────────
function buildHotbar() {
  var hbar = document.getElementById('hotbar')
  if (!hbar) return
  hbar.innerHTML = ''
  player.inventory.forEach(function(id, i) {
    var slot = document.createElement('div')
    slot.className = 'slot' + (i === player.selectedSlot ? ' on' : '')
    slot.id = 'slot-' + i
    var cs = BLOCK_COLOR[id]
    var hex = '#' + cs[0].toString(16).padStart(6,'0')
    slot.innerHTML = '<div class="slot-ic" style="background:'+hex+'"></div><div class="slot-lbl">'+BLOCK_NAMES[id]+'</div>'
    slot.addEventListener('touchstart', function(e) {
      e.preventDefault()
      var prev = document.getElementById('slot-'+player.selectedSlot)
      if (prev) prev.classList.remove('on')
      player.selectedSlot = i
      slot.classList.add('on')
    }, { passive:false })
    hbar.appendChild(slot)
  })
}

// ─── Raycasting ───────────────────────────────────────────────────────────────
function raycastBlock(maxDist) {
  var sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw)
  var sinP = Math.sin(player.pitch), cosP = Math.cos(player.pitch)
  var dx = -sinY * cosP, dy = sinP, dz = -cosY * cosP
  var ox = player.pos.x, oy = player.pos.y + PLAYER_H * 0.85, oz = player.pos.z
  var prev = null
  for (var d = 0; d < maxDist; d += 0.05) {
    var bx = Math.floor(ox + dx*d)
    var by = Math.floor(oy + dy*d)
    var bz = Math.floor(oz + dz*d)
    var id = getBlock(bx, by, bz)
    if (id !== AIR && id !== WATER) return { x:bx, y:by, z:bz, prev:prev }
    prev = { x:bx, y:by, z:bz }
  }
  return null
}

// ─── Dynamic chunk loading ────────────────────────────────────────────────────
var lastCX = null, lastCZ = null
var RENDER_DIST = 3

function updateChunks() {
  var cx = Math.floor(player.pos.x / CHUNK_W)
  var cz = Math.floor(player.pos.z / CHUNK_D)
  if (cx === lastCX && cz === lastCZ) return
  lastCX = cx; lastCZ = cz
  for (var dx = -RENDER_DIST; dx <= RENDER_DIST; dx++)
    for (var dz = -RENDER_DIST; dz <= RENDER_DIST; dz++)
      createChunk(cx+dx, cz+dz)
  for (var dx2 = -RENDER_DIST; dx2 <= RENDER_DIST; dx2++)
    for (var dz2 = -RENDER_DIST; dz2 <= RENDER_DIST; dz2++)
      rebuildChunk(cx+dx2, cz+dz2)
  // Unload far chunks
  var keys = Object.keys(chunks)
  for (var k = 0; k < keys.length; k++) {
    var parts = keys[k].split(',')
    var kcx = parseInt(parts[0]), kcz = parseInt(parts[1])
    if (Math.abs(kcx-cx) > RENDER_DIST+1 || Math.abs(kcz-cz) > RENDER_DIST+1) {
      var ch = chunks[keys[k]]
      if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose() }
      delete chunks[keys[k]]
    }
  }
}

// ─── Game loop ────────────────────────────────────────────────────────────────
var lastTime = 0

function tick(now) {
  requestAnimationFrame(tick)
  var dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now

  var fwdX = -Math.sin(player.yaw), fwdZ = -Math.cos(player.yaw)
  var rgtX =  Math.cos(player.yaw), rgtZ = -Math.sin(player.yaw)
  var MAX_JOY = 40
  var jx = joy.dx / MAX_JOY
  var jy = joy.dy / MAX_JOY
  var spd = player.flying ? FLY_SPEED : MOVE_SPEED

  player.vel.x = (-jy * fwdX + jx * rgtX) * spd
  player.vel.z = (-jy * fwdZ + jx * rgtZ) * spd

  if (player.flying) {
    player.vel.y *= 0.8
  } else {
    player.vel.y -= GRAVITY * dt
    if (player.jumpQueued && player.onGround) player.vel.y = JUMP_V
  }
  player.jumpQueued = false
  player.onGround = false

  player.pos.x += player.vel.x * dt
  player.pos.y += player.vel.y * dt
  player.pos.z += player.vel.z * dt
  resolveCollision(player.pos, player.vel)

  if (player.breakQueued) {
    player.breakQueued = false
    var hit = raycastBlock(6)
    if (hit) setBlock(hit.x, hit.y, hit.z, AIR)
  }
  if (player.placeQueued) {
    player.placeQueued = false
    var hit2 = raycastBlock(6)
    if (hit2 && hit2.prev) {
      var px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z)
      var p = hit2.prev
      if (!(p.x===px && (p.y===py||p.y===py+1) && p.z===pz))
        setBlock(p.x, p.y, p.z, player.inventory[player.selectedSlot])
    }
  }

  camera.position.set(player.pos.x, player.pos.y + PLAYER_H * 0.85, player.pos.z)
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')
  coordEl.textContent = 'X:'+Math.floor(player.pos.x)+' Y:'+Math.floor(player.pos.y)+' Z:'+Math.floor(player.pos.z)

  updateChunks()
  renderer.render(scene, camera)
}

// ─── Start game ───────────────────────────────────────────────────────────────
window.startGame = function() {
  var menuEl = document.getElementById('menu')
  var uiEl   = document.getElementById('ui')
  if (menuEl) menuEl.style.display = 'none'
  if (uiEl)   uiEl.style.display   = 'block'
  buildHotbar()
  lastTime = performance.now()
  requestAnimationFrame(tick)
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  var loadEl = document.getElementById('loading')
  var menuEl = document.getElementById('menu')

  try {
    setProgress(10, '步骤1: 初始化渲染器…')
    await nextFrame()

    initRenderer()

    setProgress(20, '步骤2: 测试WebGL…')
    await nextFrame()
    renderer.render(scene, camera)

    setProgress(30, '步骤3: 生成地形…')
    await nextFrame()

    var sx = Math.floor(player.pos.x / CHUNK_W)
    var sz = Math.floor(player.pos.z / CHUNK_D)

    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        createChunk(sx+dx, sz+dz)
      }
    }

    setProgress(60, '步骤4: 构建网格…')
    await nextFrame()

    for (var dx2 = -2; dx2 <= 2; dx2++) {
      for (var dz2 = -2; dz2 <= 2; dz2++) {
        rebuildChunk(sx+dx2, sz+dz2)
      }
      var pct = 60 + (dx2+2) * 6
      setProgress(pct, '构建网格 '+(dx2+3)+'/5…')
      await nextFrame()
    }

    setProgress(90, '步骤5: 定位出生点…')
    await nextFrame()

    for (var y = CHUNK_H - 1; y >= 0; y--) {
      var bid = getBlock(Math.floor(player.pos.x), y, Math.floor(player.pos.z))
      if (bid !== AIR && bid !== WATER) { player.pos.y = y + 1; break }
    }

    setProgress(100, '完成！')
    await nextFrame()
    await nextFrame()

    if (loadEl) loadEl.style.display = 'none'
    if (menuEl) menuEl.style.display = 'flex'

  } catch(e) {
    setProgress(0, '加载失败: ' + (e.message || String(e)))
    if (_lf) { _lf.style.width = '100%'; _lf.style.background = '#f44' }
    console.error('boot error:', e)
  }
}

boot()
