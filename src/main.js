import { createNoise2D } from 'simplex-noise'
import { Engine } from 'noa-engine'

// ─── Global Error Display ─────────────────────────────────────────────────────
function showError(msg) {
  const fill = document.getElementById('loading-fill')
  const text = document.getElementById('loading-text')
  if (fill) { fill.style.width = '100%'; fill.style.background = '#ef4444' }
  if (text) { text.textContent = '❌ ' + msg; text.style.color = '#ef4444' }
  console.error('[Game Error]', msg)
}

window.onerror = (msg, _src, _line, _col, err) => showError(err?.message || msg)
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || String(e.reason)))

// ─── WebGL Check ──────────────────────────────────────────────────────────────
const _testCanvas = document.createElement('canvas')
const _gl = _testCanvas.getContext('webgl2') || _testCanvas.getContext('webgl') || _testCanvas.getContext('experimental-webgl')
if (!_gl) { showError('此设备不支持 WebGL，无法运行游戏'); throw new Error('no WebGL') }

// ─── Noise Functions ─────────────────────────────────────────────────────────
const noise2D  = createNoise2D()
const noise2D2 = createNoise2D()
const noise2D3 = createNoise2D()
const treeNoise = createNoise2D()

function getHeight(wx, wz) {
  let h = 64
  h += noise2D(wx / 120, wz / 120) * 28
  h += noise2D2(wx / 50,  wz / 50)  * 12
  h += noise2D3(wx / 20,  wz / 20)  * 5
  return Math.round(h)
}

// ─── Block IDs ────────────────────────────────────────────────────────────────
const SEA = 62
const BLOCK = { AIR:0, GRASS:1, DIRT:2, STONE:3, SAND:4, WOOD:5, LEAVES:6, SNOW_GRASS:7, GRAVEL:8 }

// ─── Procedural Textures ─────────────────────────────────────────────────────
function makeCanvas(fn) {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = c.getContext('2d')
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 16; y++) {
      const [r, g, b] = fn(x, y)
      ctx.fillStyle = `rgb(${Math.min(255,Math.max(0,r|0))},${Math.min(255,Math.max(0,g|0))},${Math.min(255,Math.max(0,b|0))})`
      ctx.fillRect(x, y, 1, 1)
    }
  return c.toDataURL()
}
const v = (r, g, b, a = 18) => { const d = (Math.random()-.5)*a; return [r+d, g+d, b+d] }

const TEX = {
  grass_top:  makeCanvas(() => v(86,140,60)),
  grass_side: makeCanvas((x,y) => y<4 ? v(86,140,60) : v(130,90,55)),
  dirt:       makeCanvas(() => v(130,90,55)),
  stone:      makeCanvas(() => v(120,118,115)),
  sand:       makeCanvas(() => v(215,205,155)),
  wood_top:   makeCanvas(() => v(195,160,100)),
  wood_side:  makeCanvas(() => v(110,75,35)),
  leaves:     makeCanvas(() => v(50,110,40)),
  snow_top:   makeCanvas(() => v(235,240,250)),
  snow_side:  makeCanvas((x,y) => y<3 ? v(235,240,250) : v(130,90,55)),
  gravel:     makeCanvas(() => v(110,105,100,30)),
}

// ─── Engine Init ──────────────────────────────────────────────────────────────
let noa
try {
  noa = new Engine({
    debug: false,
    showFPS: false,
    chunkSize: 24,
    chunkAddDistance: [2, 1.5],      // smaller = loads faster on mobile
    chunkRemoveDistance: [3, 2.5],
    blockTestDistance: 7,
    playerHeight: 1.8,
    playerWidth: 0.6,
    playerAutoStep: 1,
    useAO: true,
    AOmultipliers: [0.93, 0.75, 0.5],
    reverseAOmultiplier: 1.0,
  })
} catch (e) {
  showError('引擎初始化失败: ' + e.message)
  throw e
}

// Style the noa canvas so it sits behind our UI
const noaCanvas = noa.container.canvas
if (noaCanvas) {
  noaCanvas.style.cssText = 'position:fixed!important;top:0!important;left:0!important;width:100%!important;height:100%!important;z-index:1!important;display:block!important;touch-action:none;'
}

// ─── Materials & Blocks ───────────────────────────────────────────────────────
const mat = (name, url, opts={}) => noa.registry.registerMaterial(name, { textureURL: url, ...opts })
mat('grass_top',  TEX.grass_top)
mat('grass_side', TEX.grass_side)
mat('dirt',       TEX.dirt)
mat('stone',      TEX.stone)
mat('sand',       TEX.sand)
mat('wood_top',   TEX.wood_top)
mat('wood_side',  TEX.wood_side)
mat('leaves',     TEX.leaves,  { alpha: 0.85 })
mat('snow_top',   TEX.snow_top)
mat('snow_side',  TEX.snow_side)
mat('gravel',     TEX.gravel)

noa.registry.registerBlock(BLOCK.GRASS,      { material: ['grass_top','dirt','grass_side'] })
noa.registry.registerBlock(BLOCK.DIRT,       { material: 'dirt' })
noa.registry.registerBlock(BLOCK.STONE,      { material: 'stone' })
noa.registry.registerBlock(BLOCK.SAND,       { material: 'sand' })
noa.registry.registerBlock(BLOCK.WOOD,       { material: ['wood_top','wood_top','wood_side'] })
noa.registry.registerBlock(BLOCK.LEAVES,     { material: 'leaves', opaque: false })
noa.registry.registerBlock(BLOCK.SNOW_GRASS, { material: ['snow_top','dirt','snow_side'] })
noa.registry.registerBlock(BLOCK.GRAVEL,     { material: 'gravel' })

// ─── World Generation ────────────────────────────────────────────────────────
function placeTree(data, lx, ly, lz, shape) {
  const [sx, sy, sz] = shape
  const trunk = 4 + (Math.random()*2|0)
  const R = 2
  for (let t = 0; t < trunk; t++) {
    const wy = ly + t
    if (wy >= 0 && wy < sy) data.set(lx, wy, lz, BLOCK.WOOD)
  }
  for (let dx = -R; dx <= R; dx++)
    for (let dz = -R; dz <= R; dz++)
      for (let dy = -1; dy <= 2; dy++) {
        if (Math.abs(dx)+Math.abs(dz)+Math.abs(dy) > R+1) continue
        const [xi,yi,zi] = [lx+dx, ly+trunk+dy, lz+dz]
        if (xi<0||xi>=sx||yi<0||yi>=sy||zi<0||zi>=sz) continue
        if (data.get(xi,yi,zi)===BLOCK.AIR) data.set(xi,yi,zi,BLOCK.LEAVES)
      }
}

// Flag: show menu once world starts loading
let worldStarted = false

noa.world.on('worldDataNeeded', (id, data, x, y, z) => {
  // Signal that noa is actually running
  if (!worldStarted) {
    worldStarted = true
    onWorldReady()
  }

  const [sx, sy, sz] = data.shape
  try {
    for (let i = 0; i < sx; i++) {
      for (let k = 0; k < sz; k++) {
        const wx = x+i, wz = z+k
        const h = getHeight(wx, wz)
        const beach = h <= SEA+2, mount = h > SEA+30
        for (let j = 0; j < sy; j++) {
          const wy = y+j
          let b = BLOCK.AIR
          if      (wy === 0) b = BLOCK.STONE
          else if (wy < h-4) b = BLOCK.STONE
          else if (wy < h)   b = beach ? BLOCK.SAND : BLOCK.DIRT
          else if (wy === h) b = beach ? BLOCK.SAND : mount ? BLOCK.SNOW_GRASS : BLOCK.GRASS
          data.set(i, j, k, b)
        }
        if (!beach && !mount && treeNoise(wx*0.3, wz*0.3) > 0.72) {
          const ly = h+1-y
          if (ly >= 0 && ly < sy) placeTree(data, i, ly, k, [sx,sy,sz])
        }
      }
    }
  } catch(e) {
    showError('地形生成错误: ' + e.message)
  }
  noa.world.setChunkData(id, data)
})

// ─── Player Start ─────────────────────────────────────────────────────────────
noa.ents.setPosition(noa.playerEntity, [0, getHeight(0,0)+5, 0])

// ─── Day/Night ────────────────────────────────────────────────────────────────
let dayTime = 0.25
noa.on('tick', dt => {
  dayTime = (dayTime + dt/(20*60*1000)) % 1
  const sun = Math.sin(dayTime*Math.PI*2)
  const br = Math.max(0.05, sun)
  const scene = noa.rendering.getScene()
  if (scene?.clearColor) {
    const night = dayTime > 0.5
    scene.clearColor.set(night?0.02:br*0.35+0.05, night?0.05:br*0.55+0.08, night?0.12:br*0.9+0.1, 1)
  }
  const lights = scene?.lights
  if (lights?.length) lights[0].intensity = br*1.2
})

// ─── Hotbar ───────────────────────────────────────────────────────────────────
const HOTBAR = [
  { id:BLOCK.GRASS,      label:'草地', color:'#5a8a38' },
  { id:BLOCK.DIRT,       label:'泥土', color:'#7a5833' },
  { id:BLOCK.STONE,      label:'石头', color:'#787470' },
  { id:BLOCK.SAND,       label:'沙子', color:'#d4c87a' },
  { id:BLOCK.WOOD,       label:'木头', color:'#5a3a1a' },
  { id:BLOCK.LEAVES,     label:'树叶', color:'#2d6e1e' },
  { id:BLOCK.GRAVEL,     label:'砾石', color:'#6a6560' },
  { id:BLOCK.SNOW_GRASS, label:'雪地', color:'#e8edf5' },
]
let selectedSlot = 0
const hotbarEl = document.getElementById('hotbar')

HOTBAR.forEach((item, i) => {
  const slot = document.createElement('div')
  slot.className = 'slot' + (i===0?' active':'')
  slot.id = `slot-${i}`
  slot.innerHTML = `<div class="slot-icon" style="background:${item.color};border:1px solid rgba(255,255,255,0.2)"></div><div class="slot-label">${item.label}</div>`
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
  if (n >= 1 && n <= HOTBAR.length) selectSlot(n-1)
  if (e.key==='f'||e.key==='F') toggleFly()
  if (e.key==='Escape') menuEl.style.display = menuEl.style.display==='none' ? 'flex' : 'none'
})
document.addEventListener('wheel', e => selectSlot(selectedSlot+(e.deltaY>0?1:-1)), { passive:true })

// ─── Block Interaction (Desktop) ──────────────────────────────────────────────
noa.inputs.bind('break', 'mouse-button-1')
noa.inputs.bind('place', 'mouse-button-3')
noa.inputs.down.on('break', () => {
  const r = noa.targetedBlock
  if (r) noa.setBlock(0, r.position[0], r.position[1], r.position[2])
})
noa.inputs.down.on('place', () => {
  const r = noa.targetedBlock
  if (r) noa.setBlock(HOTBAR[selectedSlot].id, r.adjacent[0], r.adjacent[1], r.adjacent[2])
})

// ─── Flying ───────────────────────────────────────────────────────────────────
let flying = false
function toggleFly() {
  flying = !flying
  document.getElementById('btn-fly')?.classList.toggle('active', flying)
  const body = noa.ents.getPhysicsBody(noa.playerEntity)
  if (body) body.gravityMultiplier = flying ? 0 : 1
}
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

// ─── Coords HUD ───────────────────────────────────────────────────────────────
const coordsEl = document.getElementById('coords')
noa.on('tick', () => {
  const p = noa.ents.getPosition(noa.playerEntity)
  if (p) coordsEl.textContent = `X:${p[0]|0} Y:${p[1]|0} Z:${p[2]|0}${flying?' ✈':''}`
})

// ─── MOBILE TOUCH CONTROLS ────────────────────────────────────────────────────
const JOY_R = 45
const joyZone  = document.getElementById('joy-zone')
const joyBase  = document.getElementById('joy-base')
const joyThumb = document.getElementById('joy-thumb')

let joyTouch = null, joyX = 0, joyY = 0
let joyBaseX = 0, joyBaseY = 0

joyZone.addEventListener('touchstart', e => {
  e.preventDefault()
  const t = e.changedTouches[0]
  joyTouch = t.identifier
  const rect = joyBase.getBoundingClientRect()
  joyBaseX = rect.left + rect.width/2
  joyBaseY = rect.top  + rect.height/2
  updateJoy(t.clientX, t.clientY)
}, { passive:false })

joyZone.addEventListener('touchmove', e => {
  e.preventDefault()
  for (const t of e.changedTouches) if (t.identifier===joyTouch) updateJoy(t.clientX, t.clientY)
}, { passive:false })

joyZone.addEventListener('touchend', e => {
  e.preventDefault()
  for (const t of e.changedTouches) if (t.identifier===joyTouch) {
    joyTouch=null; joyX=0; joyY=0
    joyThumb.style.transform='translate(-50%,-50%)'
  }
}, { passive:false })

function updateJoy(cx, cy) {
  const dx=cx-joyBaseX, dy=cy-joyBaseY
  const dist=Math.sqrt(dx*dx+dy*dy)
  const clamp=Math.min(dist,JOY_R)
  const angle=Math.atan2(dy,dx)
  joyX=(clamp/JOY_R)*Math.cos(angle)
  joyY=(clamp/JOY_R)*Math.sin(angle)
  joyThumb.style.transform=`translate(calc(-50% + ${Math.cos(angle)*clamp}px),calc(-50% + ${Math.sin(angle)*clamp}px))`
}

const DEAD = 0.25
noa.on('tick', () => {
  if (joyTouch===null) {
    noa.inputs.state.forward=false; noa.inputs.state.backward=false
    noa.inputs.state.left=false;    noa.inputs.state.right=false
    return
  }
  noa.inputs.state.forward  = joyY < -DEAD
  noa.inputs.state.backward = joyY >  DEAD
  noa.inputs.state.left     = joyX < -DEAD
  noa.inputs.state.right    = joyX >  DEAD
})

// Camera look zone
const lookZone = document.getElementById('look-zone')
let lookTouch=null, lookLastX=0, lookLastY=0
const LOOK_SENS = 0.004

lookZone.addEventListener('touchstart', e => {
  e.preventDefault()
  const t=e.changedTouches[0]; lookTouch=t.identifier; lookLastX=t.clientX; lookLastY=t.clientY
}, { passive:false })

lookZone.addEventListener('touchmove', e => {
  e.preventDefault()
  for (const t of e.changedTouches) {
    if (t.identifier!==lookTouch) continue
    const dx=t.clientX-lookLastX, dy=t.clientY-lookLastY
    lookLastX=t.clientX; lookLastY=t.clientY
    noa.camera.heading += dx*LOOK_SENS
    noa.camera.pitch   += dy*LOOK_SENS
    const MAX_P=Math.PI/2-0.05
    noa.camera.pitch=Math.max(-MAX_P,Math.min(MAX_P,noa.camera.pitch))
  }
}, { passive:false })

lookZone.addEventListener('touchend', e => {
  e.preventDefault()
  for (const t of e.changedTouches) if (t.identifier===lookTouch) lookTouch=null
}, { passive:false })

// Action buttons
function onBtn(id, fn) {
  document.getElementById(id)?.addEventListener('touchstart', e => { e.preventDefault(); fn() }, { passive:false })
}
onBtn('btn-jump', () => {
  const body=noa.ents.getPhysicsBody(noa.playerEntity)
  if (!body) return
  if (flying) body.velocity[1]=8
  else if (body.onGround) body.velocity[1]=8
})
onBtn('btn-fly',   toggleFly)
onBtn('btn-break', () => { const r=noa.targetedBlock; if (r) noa.setBlock(0,r.position[0],r.position[1],r.position[2]) })
onBtn('btn-place', () => { const r=noa.targetedBlock; if (r) noa.setBlock(HOTBAR[selectedSlot].id,r.adjacent[0],r.adjacent[1],r.adjacent[2]) })

// Hotbar swipe
let swipeStartX=0
hotbarEl.addEventListener('touchstart', e => { swipeStartX=e.touches[0].clientX }, { passive:true })
hotbarEl.addEventListener('touchend',   e => {
  const dx=e.changedTouches[0].clientX-swipeStartX
  if (Math.abs(dx)>30) selectSlot(selectedSlot+(dx<0?1:-1))
}, { passive:true })

// ─── Loading Screen Logic ─────────────────────────────────────────────────────
const loadingEl   = document.getElementById('loading')
const loadingFill = document.getElementById('loading-fill')
const loadingText = document.getElementById('loading-text')
const menuEl      = document.getElementById('menu')
const gameUiEl    = document.getElementById('game-ui')

// Animate the progress bar while waiting for first chunk
let prog=0
const iv = setInterval(() => {
  prog=Math.min(prog+Math.random()*8, 90)
  loadingFill.style.width=prog+'%'
}, 200)

// Fallback: if world never starts in 15s, show error
const fallbackTimer = setTimeout(() => {
  showError('加载超时，请刷新页面重试')
}, 15000)

function onWorldReady() {
  clearInterval(iv)
  clearTimeout(fallbackTimer)
  loadingFill.style.width='100%'
  loadingText.textContent='世界生成完毕！'
  setTimeout(() => {
    loadingEl.style.display='none'
    menuEl.style.display='flex'
  }, 500)
}

window.startGame = function() {
  menuEl.style.display='none'
  gameUiEl.style.display='block'
  // Pointer lock only on desktop
  if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    try { noa.container.setPointerLock(true) } catch(e) {}
  }
  try { screen.orientation?.lock?.('landscape') } catch(e) {}
}
