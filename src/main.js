import {
  WebGLRenderer, Scene, Fog, PerspectiveCamera,
  BufferGeometry, BufferAttribute, Mesh,
  MeshLambertMaterial, AmbientLight, DirectionalLight,
  Vector3, Euler, Color, Raycaster
} from 'three'
import { createNoise2D } from 'simplex-noise'

window._ok = true

// ─── Constants ───────────────────────────────────────────────────────────────
const CHUNK_W = 16, CHUNK_H = 64, CHUNK_D = 16
const SEA_LEVEL = 12, TERRAIN_AMP = 14, TERRAIN_SCALE = 0.04
const GRAVITY = 28, JUMP_V = 10, PLAYER_H = 1.7, PLAYER_R = 0.3
const MOVE_SPEED = 5, FLY_SPEED = 8

// Block IDs
const AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, WOOD=5, LEAVES=6, WATER=7

// Block face colors [top, bottom, side] as 0xRRGGBB
const BLOCK_COLOR = {
  [GRASS]:  [0x5db35d, 0x8B5E3C, 0x7a7a4a],
  [DIRT]:   [0x8B5E3C, 0x8B5E3C, 0x8B5E3C],
  [STONE]:  [0x888888, 0x888888, 0x888888],
  [SAND]:   [0xd4c87a, 0xd4c87a, 0xd4c87a],
  [WOOD]:   [0x5c3d1e, 0x5c3d1e, 0x7a5230],
  [LEAVES]: [0x2d6e2d, 0x2d6e2d, 0x2d6e2d],
  [WATER]:  [0x3366cc, 0x3366cc, 0x3366cc],
}
const BLOCK_NAMES = ['', '草地', '泥土', '石头', '沙子', '木头', '树叶', '水']
const TRANSPARENT = new Set([AIR, WATER])
const PASSABLE    = new Set([AIR, WATER])

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const loadEl  = document.getElementById('loading')
const fillEl  = document.getElementById('loading-fill')
const textEl  = document.getElementById('loading-text')
const menuEl  = document.getElementById('menu')
const uiEl    = document.getElementById('ui')
const coordEl = document.getElementById('coords')

function setProgress(pct, msg) {
  if (fillEl) fillEl.style.width = pct + '%'
  if (textEl) textEl.textContent = msg
}

function nextFrame() {
  return new Promise(r => requestAnimationFrame(r))
}

// ─── Renderer & Scene ─────────────────────────────────────────────────────────
const renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const scene = new Scene()
scene.background = new Color(0x87ceeb)
scene.fog = new Fog(0x87ceeb, 40, 80)

const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100)
camera.rotation.order = 'YXZ'

scene.add(new AmbientLight(0xffffff, 0.6))
const sun = new DirectionalLight(0xffffff, 0.8)
sun.position.set(30, 60, 20)
scene.add(sun)

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
})

// ─── World ────────────────────────────────────────────────────────────────────
const noise2D = createNoise2D()
const chunks  = new Map()   // key: "cx,cz"

function chunkKey(cx, cz) { return cx + ',' + cz }

function getChunk(cx, cz) { return chunks.get(chunkKey(cx, cz)) }

function worldToChunk(wx, wz) {
  return [Math.floor(wx / CHUNK_W), Math.floor(wz / CHUNK_D)]
}

function getBlock(wx, wy, wz) {
  if (wy < 0 || wy >= CHUNK_H) return wy < 0 ? STONE : AIR
  const [cx, cz] = worldToChunk(wx, wz)
  const ch = getChunk(cx, cz)
  if (!ch) return AIR
  const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W
  const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D
  return ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H]
}

function setBlock(wx, wy, wz, id) {
  if (wy < 0 || wy >= CHUNK_H) return
  const [cx, cz] = worldToChunk(wx, wz)
  const ch = getChunk(cx, cz)
  if (!ch) return
  const lx = ((wx % CHUNK_W) + CHUNK_W) % CHUNK_W
  const lz = ((wz % CHUNK_D) + CHUNK_D) % CHUNK_D
  ch.data[lx + wy * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id
  rebuildChunk(cx, cz)
  // Rebuild neighbours if on edge
  if (lx === 0)          rebuildChunk(cx-1, cz)
  if (lx === CHUNK_W-1)  rebuildChunk(cx+1, cz)
  if (lz === 0)          rebuildChunk(cx, cz-1)
  if (lz === CHUNK_D-1)  rebuildChunk(cx, cz+1)
}

function generateTerrain(cx, cz) {
  const data = new Uint8Array(CHUNK_W * CHUNK_H * CHUNK_D)
  for (let lx = 0; lx < CHUNK_W; lx++) {
    for (let lz = 0; lz < CHUNK_D; lz++) {
      const wx = cx * CHUNK_W + lx
      const wz = cz * CHUNK_D + lz
      const n = noise2D(wx * TERRAIN_SCALE, wz * TERRAIN_SCALE)
      const h = Math.floor(SEA_LEVEL + n * TERRAIN_AMP)
      for (let y = 0; y <= h && y < CHUNK_H; y++) {
        let id
        if (y === h)      id = (h <= SEA_LEVEL + 1) ? SAND : GRASS
        else if (y >= h-3) id = DIRT
        else               id = STONE
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = id
      }
      // Water fill up to sea level
      for (let y = h + 1; y <= SEA_LEVEL; y++) {
        data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H] = WATER
      }
    }
  }
  return data
}

// Greedy-ish face-culled mesh builder
function buildMesh(cx, cz, data) {
  const positions = [], colors = [], indices = []
  let vi = 0

  // Face directions: +X,-X,+Y,-Y,+Z,-Z
  const FACES = [
    { dir:[1,0,0],  corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]], which:2 },
    { dir:[-1,0,0], corners:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]], which:2 },
    { dir:[0,1,0],  corners:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]], which:0 },
    { dir:[0,-1,0], corners:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]], which:1 },
    { dir:[0,0,1],  corners:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]], which:2 },
    { dir:[0,0,-1], corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]], which:2 },
  ]

  for (let lx = 0; lx < CHUNK_W; lx++) {
    for (let y = 0; y < CHUNK_H; y++) {
      for (let lz = 0; lz < CHUNK_D; lz++) {
        const id = data[lx + y * CHUNK_W + lz * CHUNK_W * CHUNK_H]
        if (id === AIR) continue

        const wx = cx * CHUNK_W + lx
        const wz = cz * CHUNK_D + lz
        const colorSet = BLOCK_COLOR[id]
        if (!colorSet) continue

        for (let f = 0; f < 6; f++) {
          const face = FACES[f]
          const [dx, dy, dz] = face.dir
          const nb = getBlock(wx+dx, y+dy, wz+dz)
          if (!TRANSPARENT.has(nb) && !(id === WATER && nb === AIR)) continue
          // For water: only show top face to sky (skip sides for perf)
          if (id === WATER && f !== 2) continue

          const hex = colorSet[face.which]
          const r = ((hex >> 16) & 0xff) / 255
          const g = ((hex >> 8)  & 0xff) / 255
          const b = (hex & 0xff) / 255

          for (const [ox, oy, oz] of face.corners) {
            positions.push(wx+ox, y+oy, wz+oz)
            colors.push(r, g, b)
          }
          indices.push(vi,vi+1,vi+2, vi,vi+2,vi+3)
          vi += 4
        }
      }
    }
  }

  if (positions.length === 0) return null

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geo.setAttribute('color',    new BufferAttribute(new Float32Array(colors), 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

const mat = new MeshLambertMaterial({ vertexColors: true })

function rebuildChunk(cx, cz) {
  const ch = getChunk(cx, cz)
  if (!ch) return
  if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); ch.mesh = null }
  const geo = buildMesh(cx, cz, ch.data)
  if (geo) { ch.mesh = new Mesh(geo, mat); scene.add(ch.mesh) }
}

function createChunk(cx, cz) {
  if (getChunk(cx, cz)) return
  const data = generateTerrain(cx, cz)
  chunks.set(chunkKey(cx, cz), { data, mesh: null })
}

function loadChunksAround(cx, cz, r) {
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      createChunk(cx+dx, cz+dz)
    }
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      rebuildChunk(cx+dx, cz+dz)
    }
}

// ─── Player ───────────────────────────────────────────────────────────────────
const player = {
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
  const hw = PLAYER_R, hh = PLAYER_H
  const minX = pos.x - hw, maxX = pos.x + hw
  const minY = pos.y,       maxY = pos.y + hh
  const minZ = pos.z - hw, maxZ = pos.z + hw

  // Collect overlapping solid blocks
  for (let bx = Math.floor(minX); bx <= Math.floor(maxX); bx++) {
    for (let by = Math.floor(minY); by <= Math.floor(maxY); by++) {
      for (let bz = Math.floor(minZ); bz <= Math.floor(maxZ); bz++) {
        if (PASSABLE.has(getBlock(bx, by, bz))) continue
        // Overlap amounts
        const ox = Math.min(pos.x+hw - bx, bx+1 - (pos.x-hw))
        const oy = Math.min(pos.y+hh - by, by+1 - pos.y)
        const oz = Math.min(pos.z+hw - bz, bz+1 - (pos.z-hw))
        if (ox <= 0 || oy <= 0 || oz <= 0) continue
        // Push out along smallest overlap axis
        if (oy < ox && oy < oz) {
          if (pos.y + hh/2 < by + 0.5) { pos.y -= oy; vel.y = Math.min(vel.y, 0); player.onGround = false }
          else { pos.y += oy; vel.y = Math.max(vel.y, 0); player.onGround = true }
        } else if (ox < oz) {
          pos.x += (pos.x < bx + 0.5) ? -ox : ox; vel.x = 0
        } else {
          pos.z += (pos.z < bz + 0.5) ? -oz : oz; vel.z = 0
        }
      }
    }
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
const joy = { active: false, id: -1, cx: 0, cy: 0, dx: 0, dy: 0 }
const look = { active: false, id: -1, lx: 0, ly: 0 }

const joyZone  = document.getElementById('joy-zone')
const joyThumb = document.getElementById('joy-thumb')
const joyBase  = document.getElementById('joy-base')
const lookZone = document.getElementById('look-zone')

function joyPos() {
  const r = joyBase.getBoundingClientRect()
  return { cx: r.left + r.width/2, cy: r.top + r.height/2 }
}

joyZone.addEventListener('touchstart', e => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (joy.active) continue
    joy.active = true; joy.id = t.identifier
    const p = joyPos(); joy.cx = p.cx; joy.cy = p.cy
    joy.dx = 0; joy.dy = 0
  }
}, { passive: false })

joyZone.addEventListener('touchmove', e => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue
    const MAX = 40
    joy.dx = Math.max(-MAX, Math.min(MAX, t.clientX - joy.cx))
    joy.dy = Math.max(-MAX, Math.min(MAX, t.clientY - joy.cy))
    joyThumb.style.transform = 'translate(calc(-50% + '+joy.dx+'px), calc(-50% + '+joy.dy+'px))'
  }
}, { passive: false })

function joyEnd(e) {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue
    joy.active = false; joy.dx = 0; joy.dy = 0
    joyThumb.style.transform = 'translate(-50%,-50%)'
  }
}
joyZone.addEventListener('touchend',    joyEnd, { passive: false })
joyZone.addEventListener('touchcancel', joyEnd, { passive: false })

lookZone.addEventListener('touchstart', e => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (look.active) continue
    look.active = true; look.id = t.identifier
    look.lx = t.clientX; look.ly = t.clientY
  }
}, { passive: false })

lookZone.addEventListener('touchmove', e => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (t.identifier !== look.id) continue
    const dx = t.clientX - look.lx
    const dy = t.clientY - look.ly
    look.lx = t.clientX; look.ly = t.clientY
    player.yaw   -= dx * 0.004
    player.pitch -= dy * 0.004
    player.pitch = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, player.pitch))
  }
}, { passive: false })

function lookEnd(e) {
  e.preventDefault()
  for (const t of e.changedTouches) { if (t.identifier === look.id) look.active = false }
}
lookZone.addEventListener('touchend',    lookEnd, { passive: false })
lookZone.addEventListener('touchcancel', lookEnd, { passive: false })

function tapBtn(id, fn) {
  const el = document.getElementById(id)
  if (!el) return
  el.addEventListener('touchstart', e => { e.preventDefault(); fn() }, { passive: false })
}

tapBtn('b-jump', () => { player.jumpQueued = true })
tapBtn('b-brk',  () => { player.breakQueued = true })
tapBtn('b-plc',  () => { player.placeQueued = true })
tapBtn('b-fly',  () => {
  player.flying = !player.flying
  player.vel.y = 0
  document.getElementById('b-fly').classList.toggle('on', player.flying)
})

// ─── Hotbar ───────────────────────────────────────────────────────────────────
const hbar = document.getElementById('hotbar')
function buildHotbar() {
  hbar.innerHTML = ''
  player.inventory.forEach((id, i) => {
    const slot = document.createElement('div')
    slot.className = 'slot' + (i === player.selectedSlot ? ' on' : '')
    slot.id = 'slot-' + i
    const c = BLOCK_COLOR[id]
    const hex = '#' + (c[0]).toString(16).padStart(6,'0')
    slot.innerHTML = '<div class="slot-ic" style="background:'+hex+'"></div><div class="slot-lbl">'+BLOCK_NAMES[id]+'</div>'
    slot.addEventListener('touchstart', e => {
      e.preventDefault()
      document.getElementById('slot-'+player.selectedSlot).classList.remove('on')
      player.selectedSlot = i
      slot.classList.add('on')
    }, { passive: false })
    hbar.appendChild(slot)
  })
}

// ─── Raycasting ───────────────────────────────────────────────────────────────
function raycastBlock(maxDist) {
  const dir = new Vector3(0, 0, -1)
  dir.applyEuler(new Euler(player.pitch, player.yaw, 0, 'YXZ'))
  const pos = player.pos.clone().add(new Vector3(0, PLAYER_H * 0.85, 0))
  let prev = null
  for (let d = 0; d < maxDist; d += 0.05) {
    const x = Math.floor(pos.x + dir.x * d)
    const y = Math.floor(pos.y + dir.y * d)
    const z = Math.floor(pos.z + dir.z * d)
    const id = getBlock(x, y, z)
    if (id !== AIR && id !== WATER) return { x, y, z, prev }
    prev = { x, y, z }
  }
  return null
}

// ─── Dynamic chunk loading ────────────────────────────────────────────────────
let lastCX = null, lastCZ = null
const RENDER_DIST = 3

function updateChunks() {
  const [cx, cz] = worldToChunk(player.pos.x, player.pos.z)
  if (cx === lastCX && cz === lastCZ) return
  lastCX = cx; lastCZ = cz
  // Generate missing chunks (no rebuild yet)
  for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++)
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++)
      createChunk(cx+dx, cz+dz)
  // Rebuild ring by ring so inner chunks are solid first
  for (let dx = -RENDER_DIST; dx <= RENDER_DIST; dx++)
    for (let dz = -RENDER_DIST; dz <= RENDER_DIST; dz++)
      rebuildChunk(cx+dx, cz+dz)
  // Remove far chunks
  for (const [key, ch] of chunks) {
    const [kcx, kcz] = key.split(',').map(Number)
    if (Math.abs(kcx-cx) > RENDER_DIST+1 || Math.abs(kcz-cz) > RENDER_DIST+1) {
      if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose() }
      chunks.delete(key)
    }
  }
}

// ─── Game loop ────────────────────────────────────────────────────────────────
let lastTime = 0

function tick(now) {
  requestAnimationFrame(tick)
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now

  // Movement
  const fwd = new Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw))
  const rgt = new Vector3( Math.cos(player.yaw), 0, -Math.sin(player.yaw))
  const MAX_JOY = 40
  const jx = joy.dx / MAX_JOY
  const jy = joy.dy / MAX_JOY
  const spd = player.flying ? FLY_SPEED : MOVE_SPEED

  const move = new Vector3()
  move.addScaledVector(fwd, -jy * spd)
  move.addScaledVector(rgt,  jx * spd)

  if (player.flying) {
    player.vel.x = move.x
    player.vel.z = move.z
    player.vel.y *= 0.8
  } else {
    player.vel.x = move.x
    player.vel.z = move.z
    player.vel.y -= GRAVITY * dt
    if (player.jumpQueued && player.onGround) { player.vel.y = JUMP_V }
  }
  player.jumpQueued = false

  player.onGround = false
  player.pos.addScaledVector(player.vel, dt)
  resolveCollision(player.pos, player.vel)

  // Break / Place
  if (player.breakQueued) {
    player.breakQueued = false
    const hit = raycastBlock(6)
    if (hit) setBlock(hit.x, hit.y, hit.z, AIR)
  }
  if (player.placeQueued) {
    player.placeQueued = false
    const hit = raycastBlock(6)
    if (hit && hit.prev) {
      const { x, y, z } = hit.prev
      const placeId = player.inventory[player.selectedSlot]
      // Don't place inside player
      const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z)
      if (!(x===px && (y===py||y===py+1) && z===pz))
        setBlock(x, y, z, placeId)
    }
  }

  // Camera
  camera.position.set(player.pos.x, player.pos.y + PLAYER_H * 0.85, player.pos.z)
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ')

  // Coords
  coordEl.textContent =
    'X:' + Math.floor(player.pos.x) +
    ' Y:' + Math.floor(player.pos.y) +
    ' Z:' + Math.floor(player.pos.z)

  updateChunks()
  renderer.render(scene, camera)
}

// ─── Start game ───────────────────────────────────────────────────────────────
window.startGame = function() {
  menuEl.style.display = 'none'
  uiEl.style.display = 'block'
  buildHotbar()
  lastTime = performance.now()
  requestAnimationFrame(tick)
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  setProgress(10, '初始化渲染器…')
  await nextFrame()

  try { renderer.render(scene, camera) } catch(e) {
    setProgress(0, 'WebGL 不支持: ' + e.message); return
  }

  setProgress(25, '生成地形…')
  await nextFrame()

  // Generate initial 3x3 chunks around spawn
  const [sx, sz] = worldToChunk(player.pos.x, player.pos.z)
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      createChunk(sx+dx, sz+dz)
    }
  }

  setProgress(50, '构建区块网格…')
  await nextFrame()

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      rebuildChunk(sx+dx, sz+dz)
    }
    setProgress(50 + (dx+2) * 8, '构建区块 ' + (dx+3) + '/5…')
    await nextFrame()
  }

  // Find spawn height
  for (let y = CHUNK_H - 1; y >= 0; y--) {
    if (!PASSABLE.has(getBlock(Math.floor(player.pos.x), y, Math.floor(player.pos.z)))) {
      player.pos.y = y + 1
      break
    }
  }

  setProgress(100, '完成！')
  await nextFrame()
  await nextFrame()

  loadEl.style.display = 'none'
  menuEl.style.display = 'flex'
}

boot()
