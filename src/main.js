import { createNoise2D } from 'simplex-noise'
import { Engine } from 'noa-engine'

// ─── Terrain Noise ────────────────────────────────────────────────────────────
const noise2D = createNoise2D()
const noise2D2 = createNoise2D()
const noise2D3 = createNoise2D()

function getHeight(wx, wz) {
  let h = 64
  h += noise2D(wx / 120, wz / 120) * 28
  h += noise2D2(wx / 50, wz / 50) * 12
  h += noise2D3(wx / 20, wz / 20) * 5
  return Math.round(h)
}

// ─── Block Definitions ───────────────────────────────────────────────────────
const SEA = 62

const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3,
  SAND: 4, WOOD: 5, LEAVES: 6,
  SNOW_GRASS: 7, GRAVEL: 8,
}

// Procedural canvas texture
function makeCanvas(fn) {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d')
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 16; y++) {
      const [r, g, b] = fn(x, y)
      ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`
      ctx.fillRect(x, y, 1, 1)
    }
  return c.toDataURL()
}

function v(r, g, b, amt = 18) {
  const d = (Math.random() - 0.5) * amt
  return [r + d, g + d, b + d]
}

const TEX = {
  grass_top:  makeCanvas(() => v(86, 140, 60)),
  grass_side: makeCanvas((x, y) => y < 4 ? v(86, 140, 60) : v(130, 90, 55)),
  dirt:       makeCanvas(() => v(130, 90, 55)),
  stone:      makeCanvas(() => v(120, 118, 115)),
  sand:       makeCanvas(() => v(215, 205, 155)),
  wood_top:   makeCanvas(() => v(195, 160, 100)),
  wood_side:  makeCanvas(() => v(110, 75, 35)),
  leaves:     makeCanvas(() => v(50, 110, 40)),
  snow_top:   makeCanvas(() => v(235, 240, 250)),
  snow_side:  makeCanvas((x, y) => y < 3 ? v(235, 240, 250) : v(130, 90, 55)),
  gravel:     makeCanvas(() => v(110, 105, 100, 30)),
}

// ─── Engine Init ─────────────────────────────────────────────────────────────
const noa = new Engine({
  debug: false,
  showFPS: false,
  chunkSize: 24,
  chunkAddDistance: [3, 2.5],
  chunkRemoveDistance: [4, 3.5],
  blockTestDistance: 7,
  playerHeight: 1.8,
  playerWidth: 0.6,
  playerAutoStep: 1,
  useAO: true,
  AOmultipliers: [0.93, 0.75, 0.5],
  reverseAOmultiplier: 1.0,
  manuallyControlChunkLoading: false,
})

// ─── Register Materials & Blocks ─────────────────────────────────────────────
function mat(name, url, opts = {}) {
  noa.registry.registerMaterial(name, { textureURL: url, ...opts })
}

mat('grass_top',  TEX.grass_top)
mat('grass_side', TEX.grass_side)
mat('dirt',       TEX.dirt)
mat('stone',      TEX.stone)
mat('sand',       TEX.sand)
mat('wood_top',   TEX.wood_top)
mat('wood_side',  TEX.wood_side)
mat('leaves',     TEX.leaves,    { alpha: 0.85 })
mat('snow_top',   TEX.snow_top)
mat('snow_side',  TEX.snow_side)
mat('gravel',     TEX.gravel)

// [top, bottom, side] or single material
noa.registry.registerBlock(BLOCK.GRASS,      { material: ['grass_top', 'dirt', 'grass_side'] })
noa.registry.registerBlock(BLOCK.DIRT,       { material: 'dirt' })
noa.registry.registerBlock(BLOCK.STONE,      { material: 'stone' })
noa.registry.registerBlock(BLOCK.SAND,       { material: 'sand' })
noa.registry.registerBlock(BLOCK.WOOD,       { material: ['wood_top', 'wood_top', 'wood_side'] })
noa.registry.registerBlock(BLOCK.LEAVES,     { material: 'leaves', opaque: false })
noa.registry.registerBlock(BLOCK.SNOW_GRASS, { material: ['snow_top', 'dirt', 'snow_side'] })
noa.registry.registerBlock(BLOCK.GRAVEL,     { material: 'gravel' })

// ─── World Generation ────────────────────────────────────────────────────────
const treeNoise = createNoise2D()

function placeTree(data, lx, ly, lz, bx, by, bz, shape) {
  const [sx, sy, sz] = shape
  const TRUNK = 4 + (Math.random() * 2 | 0)
  const LEAF_R = 2

  // trunk
  for (let t = 0; t < TRUNK; t++) {
    const wy = ly + t
    if (wy >= 0 && wy < sy) data.set(lx, wy, lz, BLOCK.WOOD)
  }
  // leaf crown
  for (let dx = -LEAF_R; dx <= LEAF_R; dx++) {
    for (let dz = -LEAF_R; dz <= LEAF_R; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) > LEAF_R + 1) continue
        const xi = lx + dx, yi = ly + TRUNK + dy, zi = lz + dz
        if (xi < 0 || xi >= sx || yi < 0 || yi >= sy || zi < 0 || zi >= sz) continue
        if (data.get(xi, yi, zi) === BLOCK.AIR) data.set(xi, yi, zi, BLOCK.LEAVES)
      }
    }
  }
}

noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
  const [sx, sy, sz] = data.shape

  for (let i = 0; i < sx; i++) {
    for (let k = 0; k < sz; k++) {
      const wx = x + i
      const wz = z + k
      const h = getHeight(wx, wz)
      const isBeach = h <= SEA + 2
      const isMountain = h > SEA + 30

      for (let j = 0; j < sy; j++) {
        const wy = y + j
        let block = BLOCK.AIR

        if (wy === 0) {
          block = BLOCK.STONE
        } else if (wy < h - 4) {
          block = BLOCK.STONE
        } else if (wy < h) {
          block = isBeach ? BLOCK.SAND : BLOCK.DIRT
        } else if (wy === h) {
          if (isBeach) block = BLOCK.SAND
          else if (isMountain) block = BLOCK.SNOW_GRASS
          else block = BLOCK.GRASS
        }

        data.set(i, j, k, block)
      }

      // Tree placement
      if (!isBeach && !isMountain) {
        const tn = treeNoise(wx * 0.3, wz * 0.3)
        if (tn > 0.72) {
          const ly = h + 1 - y
          if (ly >= 0 && ly < sy) {
            placeTree(data, i, ly, k, wx, h + 1, wz, [sx, sy, sz])
          }
        }
      }
    }
  }

  noa.world.setChunkData(id, data)
})

// ─── Player Start ─────────────────────────────────────────────────────────────
const spawnH = getHeight(0, 0)
noa.ents.setPosition(noa.playerEntity, [0, spawnH + 5, 0])

// ─── Day/Night Cycle ─────────────────────────────────────────────────────────
let dayTime = 0.25 // start at morning
const DAY_SPEED = 1 / (20 * 60 * 1000) // 20-min full day in ms

noa.on('tick', dt => {
  dayTime = (dayTime + DAY_SPEED * dt) % 1
  const sun = Math.sin(dayTime * Math.PI * 2)
  const brightness = Math.max(0.05, sun)

  const scene = noa.rendering.getScene()
  if (scene.clearColor) {
    const night = dayTime > 0.5
    scene.clearColor.set(
      night ? 0.02 : brightness * 0.35 + 0.05,
      night ? 0.05 : brightness * 0.55 + 0.08,
      night ? 0.12 : brightness * 0.9 + 0.1,
      1
    )
  }
  const lights = scene.lights
  if (lights && lights.length > 0) {
    lights[0].intensity = brightness * 1.2
  }
})

// ─── Hotbar Setup ─────────────────────────────────────────────────────────────
const HOTBAR = [
  { id: BLOCK.GRASS,   label: '草地' },
  { id: BLOCK.DIRT,    label: '泥土' },
  { id: BLOCK.STONE,   label: '石头' },
  { id: BLOCK.SAND,    label: '沙子' },
  { id: BLOCK.WOOD,    label: '木头' },
  { id: BLOCK.LEAVES,  label: '树叶' },
  { id: BLOCK.GRAVEL,  label: '砾石' },
  { id: BLOCK.SNOW_GRASS, label: '雪地' },
]
const COLORS = ['#5a8a38','#7a5833','#787470','#d4c87a','#5a3a1a','#2d6e1e','#6a6560','#e8edf5']

let selectedSlot = 0
const hotbarEl = document.getElementById('hotbar')

HOTBAR.forEach((item, i) => {
  const slot = document.createElement('div')
  slot.className = 'slot' + (i === 0 ? ' active' : '')
  slot.id = `slot-${i}`

  const icon = document.createElement('div')
  icon.className = 'slot-icon'
  icon.style.background = COLORS[i]
  icon.style.border = '1px solid rgba(255,255,255,0.2)'

  const lbl = document.createElement('div')
  lbl.textContent = item.label
  lbl.style.fontSize = '8px'
  lbl.style.color = '#ddd'

  const num = document.createElement('div')
  num.className = 'slot-num'
  num.textContent = i + 1

  slot.appendChild(icon)
  slot.appendChild(lbl)
  slot.appendChild(num)
  slot.addEventListener('pointerdown', () => selectSlot(i))
  hotbarEl.appendChild(slot)
})

function selectSlot(i) {
  document.getElementById(`slot-${selectedSlot}`)?.classList.remove('active')
  selectedSlot = ((i % HOTBAR.length) + HOTBAR.length) % HOTBAR.length
  document.getElementById(`slot-${selectedSlot}`)?.classList.add('active')
}

document.addEventListener('keydown', e => {
  const n = parseInt(e.key)
  if (n >= 1 && n <= HOTBAR.length) selectSlot(n - 1)
  if (e.key === 'f' || e.key === 'F') toggleFly()
})

document.addEventListener('wheel', e => {
  selectSlot(selectedSlot + (e.deltaY > 0 ? 1 : -1))
}, { passive: true })

// ─── Block Interaction ────────────────────────────────────────────────────────
noa.inputs.bind('break',  'mouse-button-1')
noa.inputs.bind('place',  'mouse-button-3')

noa.inputs.down.on('break', () => {
  const res = noa.targetedBlock
  if (res) noa.setBlock(0, res.position[0], res.position[1], res.position[2])
})

noa.inputs.down.on('place', () => {
  const res = noa.targetedBlock
  if (res) {
    const [x, y, z] = res.adjacent
    noa.setBlock(HOTBAR[selectedSlot].id, x, y, z)
  }
})

// ─── Flying Mode ─────────────────────────────────────────────────────────────
let flying = false
function toggleFly() {
  flying = !flying
  const body = noa.ents.getPhysicsBody(noa.playerEntity)
  if (body) {
    body.gravityMultiplier = flying ? 0 : 1
    body.airDrag = flying ? 5 : 0
  }
}

// Up/down while flying
noa.inputs.bind('flyUp',   'Space')
noa.inputs.bind('flyDown', 'ShiftLeft')
noa.on('tick', () => {
  if (!flying) return
  const body = noa.ents.getPhysicsBody(noa.playerEntity)
  if (!body) return
  if (noa.inputs.state.flyUp)   body.velocity[1] =  8
  if (noa.inputs.state.flyDown) body.velocity[1] = -8
  if (!noa.inputs.state.flyUp && !noa.inputs.state.flyDown) body.velocity[1] = 0
})

// ─── Coordinates HUD ─────────────────────────────────────────────────────────
const coordsEl = document.getElementById('coords')
noa.on('tick', () => {
  const pos = noa.ents.getPosition(noa.playerEntity)
  if (pos) {
    coordsEl.textContent = `X: ${pos[0]|0}  Y: ${pos[1]|0}  Z: ${pos[2]|0}` +
      (flying ? '  ✈ 飞行' : '')
  }
})

// ─── Loading & Menu ───────────────────────────────────────────────────────────
const loadingEl  = document.getElementById('loading')
const loadingFill = document.getElementById('loading-fill')
const loadingText = document.getElementById('loading-text')
const menuEl     = document.getElementById('menu')
const hudEl      = document.getElementById('hud')
const playBtn    = document.getElementById('play-btn')

let loadProgress = 0
const loadInterval = setInterval(() => {
  loadProgress = Math.min(loadProgress + Math.random() * 15, 95)
  loadingFill.style.width = loadProgress + '%'
}, 200)

setTimeout(() => {
  clearInterval(loadInterval)
  loadingFill.style.width = '100%'
  loadingText.textContent = '世界生成完毕！'
  setTimeout(() => {
    loadingEl.style.display = 'none'
    menuEl.style.display = 'flex'
  }, 600)
}, 2500)

playBtn.addEventListener('click', () => {
  menuEl.style.display = 'none'
  hudEl.style.display = 'block'
  noa.container.setPointerLock(true)
})

// Re-show menu on ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const locked = document.pointerLockElement !== null
    if (!locked) {
      menuEl.style.display = menuEl.style.display === 'none' ? 'flex' : 'none'
    }
  }
})
