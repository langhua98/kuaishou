import {
  WebGLRenderer, Scene, Fog, PerspectiveCamera,
  MeshLambertMaterial, BufferGeometry, Float32BufferAttribute, Mesh,
  AmbientLight, DirectionalLight, Vector3, Color, Euler
} from 'three'
import { createNoise2D } from 'simplex-noise'

// Tell inline diagnostic script that module started executing
window._jsStarted = true

// ─── Config ───────────────────────────────────────────────────────────────────
const CHUNK   = 16
const RDIST   = 3
const SEA     = 40
const GRAVITY = 22
const JUMP_V  = 9
const MOVE_SP = 5
const FLY_SP  = 10
const PH = 1.8, PW = 0.5

const B = { AIR:0,GRASS:1,DIRT:2,STONE:3,SAND:4,WOOD:5,LEAVES:6,SNOW:7,GRAVEL:8 }

const FACE_COLOR = {
  [B.GRASS]:  [[.33,.55,.24],[.51,.35,.22],[.51,.35,.22]],
  [B.DIRT]:   [[.51,.35,.22],[.51,.35,.22],[.51,.35,.22]],
  [B.STONE]:  [[.47,.46,.45],[.47,.46,.45],[.47,.46,.45]],
  [B.SAND]:   [[.84,.80,.61],[.84,.80,.61],[.84,.80,.61]],
  [B.WOOD]:   [[.76,.63,.39],[.43,.29,.14],[.76,.63,.39]],
  [B.LEAVES]: [[.20,.43,.16],[.20,.43,.16],[.20,.43,.16]],
  [B.SNOW]:   [[.92,.94,.98],[.51,.35,.22],[.51,.35,.22]],
  [B.GRAVEL]: [[.43,.41,.39],[.43,.41,.39],[.43,.41,.39]],
}
const BRIGHT = [1.0, 0.75, 0.75, 0.75, 0.75, 0.5]

const FACES = [
  { d:[1,0,0],  c:[[1,0,0],[1,1,0],[1,0,1],[1,1,1]], ci:1 },
  { d:[-1,0,0], c:[[0,1,0],[0,0,0],[0,1,1],[0,0,1]], ci:2 },
  { d:[0,1,0],  c:[[0,1,1],[1,1,1],[0,1,0],[1,1,0]], ci:0 },
  { d:[0,-1,0], c:[[0,0,0],[1,0,0],[0,0,1],[1,0,1]], ci:5 },
  { d:[0,0,1],  c:[[0,0,1],[1,0,1],[0,1,1],[1,1,1]], ci:3 },
  { d:[0,0,-1], c:[[1,0,0],[0,0,0],[1,1,0],[0,1,0]], ci:4 },
]

// ─── Loading UI helpers ───────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading')
const loadFill  = document.getElementById('loading-fill')
const loadText  = document.getElementById('loading-text')
const menuEl    = document.getElementById('menu')
const guiEl     = document.getElementById('game-ui')

function setProgress(pct, text) {
  loadFill.style.width = pct + '%'
  if (text) loadText.textContent = text
}
const nextFrame = () => new Promise(r => requestAnimationFrame(r))
const wait      = ms => new Promise(r => setTimeout(r, ms))

// Show errors on-screen so iOS users can report them
window.onerror = (_m, _s, _l, _c, err) => {
  setProgress(0, '错误: ' + (err?.message || _m))
  loadFill.style.background = '#f44'
}

// ─── World Storage ────────────────────────────────────────────────────────────
const world  = new Map()
const meshes = new Map()
const loaded = new Set()
const dirty  = new Set()

const wk = (x,y,z) => `${x},${y},${z}`
const ck  = (cx,cy,cz) => `${cx},${cy},${cz}`

function getBlock(x,y,z) { return world.get(wk(x|0,y|0,z|0)) ?? 0 }
function setBlock(x,y,z,id) {
  x=x|0; y=y|0; z=z|0
  if (id===0) world.delete(wk(x,y,z)); else world.set(wk(x,y,z),id)
  const cx=Math.floor(x/CHUNK), cy=Math.floor(y/CHUNK), cz=Math.floor(z/CHUNK)
  dirty.add(ck(cx,cy,cz))
  if (x%CHUNK===0)        dirty.add(ck(cx-1,cy,cz))
  if (x%CHUNK===CHUNK-1)  dirty.add(ck(cx+1,cy,cz))
}

// ─── Terrain ─────────────────────────────────────────────────────────────────
const n1=createNoise2D(), n2=createNoise2D(), n3=createNoise2D(), nt=createNoise2D()

function height(wx,wz) {
  return Math.round(SEA + n1(wx/120,wz/120)*20 + n2(wx/50,wz/50)*10 + n3(wx/20,wz/20)*4)
}

function genChunk(cx,cy,cz) {
  const ox=cx*CHUNK, oy=cy*CHUNK, oz=cz*CHUNK
  for (let i=0; i<CHUNK; i++) for (let k=0; k<CHUNK; k++) {
    const wx=ox+i, wz=oz+k, h=height(wx,wz)
    const beach=h<=SEA+2, mount=h>SEA+25
    for (let j=0; j<CHUNK; j++) {
      const wy=oy+j
      let b=B.AIR
      if      (wy<h-4) b=B.STONE
      else if (wy<h)   b=beach?B.SAND:B.DIRT
      else if (wy===h) b=beach?B.SAND:mount?B.SNOW:B.GRASS
      if (b) world.set(wk(wx,wy,wz),b)
    }
    if (!beach&&!mount&&nt(wx*.3,wz*.3)>.72) {
      const tr=4+(Math.random()*2|0)
      for (let t=0; t<tr; t++) world.set(wk(wx,h+1+t,wz),B.WOOD)
      for (let dx=-2; dx<=2; dx++) for (let dz=-2; dz<=2; dz++) for (let dy=-1; dy<=2; dy++) {
        if (Math.abs(dx)+Math.abs(dz)+Math.abs(dy)>3) continue
        const bk=wk(wx+dx,h+1+tr+dy,wz+dz)
        if (!world.has(bk)) world.set(bk,B.LEAVES)
      }
    }
  }
}

// ─── Mesh Builder ─────────────────────────────────────────────────────────────
const sharedMat = new MeshLambertMaterial({ vertexColors:true })

function buildMesh(cx,cy,cz) {
  const ox=cx*CHUNK, oy=cy*CHUNK, oz=cz*CHUNK
  const pos=[],norm=[],col=[],idx=[]
  for (let i=0; i<CHUNK; i++) for (let j=0; j<CHUNK; j++) for (let k=0; k<CHUNK; k++) {
    const wx=ox+i, wy=oy+j, wz=oz+k, bid=getBlock(wx,wy,wz)
    if (!bid) continue
    const fc=FACE_COLOR[bid]||[[.5,.5,.5],[.5,.5,.5],[.5,.5,.5]]
    for (const {d,c,ci} of FACES) {
      const nb=getBlock(wx+d[0],wy+d[1],wz+d[2])
      if (nb&&nb!==B.LEAVES) continue
      const ndx=pos.length/3
      const fci=ci===0?0:ci===5?2:1
      const [r,g,b]=fc[fci]
      const br=BRIGHT[ci]
      for (const v of c) {
        pos.push(wx+v[0],wy+v[1],wz+v[2])
        norm.push(d[0],d[1],d[2])
        col.push(r*br,g*br,b*br)
      }
      idx.push(ndx,ndx+1,ndx+2,ndx+2,ndx+1,ndx+3)
    }
  }
  if (!pos.length) return null
  const geo=new BufferGeometry()
  geo.setAttribute('position',new Float32BufferAttribute(pos,3))
  geo.setAttribute('normal',  new Float32BufferAttribute(norm,3))
  geo.setAttribute('color',   new Float32BufferAttribute(col,3))
  geo.setIndex(idx)
  geo.computeBoundingSphere()
  return new Mesh(geo,sharedMat)
}

// ─── Renderer & Scene ─────────────────────────────────────────────────────────
let renderer
try {
  renderer = new WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false,
  })
} catch(e) {
  setProgress(0, '不支持 WebGL，请升级浏览器')
  loadFill.style.background = '#f44'
  throw e
}

renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.setSize(innerWidth, innerHeight)
renderer.domElement.style.cssText =
  'position:fixed;inset:0;width:100%!important;height:100%!important;z-index:1;display:block;touch-action:none;'
document.body.insertBefore(renderer.domElement, document.body.firstChild)

renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault()
  setProgress(0, 'WebGL 上下文丢失，请刷新')
  loadFill.style.background = '#f44'
  loadingEl.style.display = 'flex'
})

const scene  = new Scene()
const fogClr = new Color(0x87ceeb)
const fog    = new Fog(0x87ceeb, 40, RDIST*CHUNK*1.6)
scene.fog    = fog

const camera = new PerspectiveCamera(70, innerWidth/innerHeight, 0.1, 300)

scene.add(new AmbientLight(0xffffff, 0.5))
const sun = new DirectionalLight(0xfff5d0, 1.0)
sun.position.set(100,200,50)
scene.add(sun)

window.addEventListener('resize',()=>{
  renderer.setSize(innerWidth,innerHeight)
  camera.aspect=innerWidth/innerHeight
  camera.updateProjectionMatrix()
})

// ─── Player ───────────────────────────────────────────────────────────────────
const spawnH = height(0,0)
const player = {
  pos: new Vector3(0, spawnH+3, 0),
  vel: new Vector3(),
  yaw: 0, pitch: 0,
  onGround: false, flying: false,
}

// ─── Chunk Manager ────────────────────────────────────────────────────────────
function loadAround(px,py,pz) {
  const cx0=Math.floor(px/CHUNK), cy0=Math.floor(py/CHUNK), cz0=Math.floor(pz/CHUNK)
  for (let cx=cx0-RDIST; cx<=cx0+RDIST; cx++)
  for (let cy=Math.max(0,cy0-2); cy<=cy0+3; cy++)
  for (let cz=cz0-RDIST; cz<=cz0+RDIST; cz++) {
    const key=ck(cx,cy,cz)
    if (loaded.has(key)) continue
    loaded.add(key)
    genChunk(cx,cy,cz)
    const m=buildMesh(cx,cy,cz)
    if (m) { scene.add(m); meshes.set(key,m) }
  }
}

let rebuildBudget=0
function rebuildDirty() {
  if (!dirty.size||rebuildBudget>0) return
  rebuildBudget=2
  const key=[...dirty][0]; dirty.delete(key)
  const [cx,cy,cz]=key.split(',').map(Number)
  const old=meshes.get(key)
  if (old) { scene.remove(old); old.geometry.dispose(); meshes.delete(key) }
  if (loaded.has(key)) { const m=buildMesh(cx,cy,cz); if(m){scene.add(m);meshes.set(key,m)} }
}

// ─── Physics ─────────────────────────────────────────────────────────────────
function solid(x,y,z) { const b=getBlock(x,y,z); return b&&b!==B.LEAVES }
function collides(pos) {
  const hw=PW/2
  for (let x=Math.floor(pos.x-hw); x<=Math.floor(pos.x+hw); x++)
  for (let y=Math.floor(pos.y);    y<=Math.floor(pos.y+PH);  y++)
  for (let z=Math.floor(pos.z-hw); z<=Math.floor(pos.z+hw); z++)
    if (solid(x,y,z)) return true
  return false
}
function stepPlayer(dt) {
  if (!player.flying) player.vel.y-=GRAVITY*dt
  const p=player.pos, v=player.vel
  p.x+=v.x*dt; if(collides(p)){p.x-=v.x*dt;v.x=0}
  p.y+=v.y*dt
  if (collides(p)) {
    if (v.y<0) player.onGround=true
    p.y-=v.y*dt; v.y=0
  } else player.onGround=false
  p.z+=v.z*dt; if(collides(p)){p.z-=v.z*dt;v.z=0}
  v.x*=0.75; v.z*=0.75
  if (player.flying) v.y*=0.75
}

// ─── Raycaster ───────────────────────────────────────────────────────────────
function raycast(origin,dir,maxD) {
  let x=Math.floor(origin.x), y=Math.floor(origin.y), z=Math.floor(origin.z)
  const sx=dir.x>0?1:-1, sy=dir.y>0?1:-1, sz=dir.z>0?1:-1
  const tdx=Math.abs(1/dir.x), tdy=Math.abs(1/dir.y), tdz=Math.abs(1/dir.z)
  let tmx=(dir.x>0?Math.ceil(origin.x)-origin.x:origin.x-Math.floor(origin.x))*tdx
  let tmy=(dir.y>0?Math.ceil(origin.y)-origin.y:origin.y-Math.floor(origin.y))*tdy
  let tmz=(dir.z>0?Math.ceil(origin.z)-origin.z:origin.z-Math.floor(origin.z))*tdz
  let lx=x,ly=y,lz=z,t=0
  while (t<maxD) {
    if (solid(x,y,z)) return {hit:[x,y,z],prev:[lx,ly,lz]}
    lx=x;ly=y;lz=z
    if      (tmx<tmy&&tmx<tmz){x+=sx;t=tmx;tmx+=tdx}
    else if (tmy<tmz)          {y+=sy;t=tmy;tmy+=tdy}
    else                       {z+=sz;t=tmz;tmz+=tdz}
  }
  return null
}

// ─── Hotbar ───────────────────────────────────────────────────────────────────
const SLOTS=[
  {id:B.GRASS, label:'草地',  color:'#5a8a38'},
  {id:B.DIRT,  label:'泥土',  color:'#7a5833'},
  {id:B.STONE, label:'石头',  color:'#787470'},
  {id:B.SAND,  label:'沙子',  color:'#d4c87a'},
  {id:B.WOOD,  label:'木头',  color:'#5a3a1a'},
  {id:B.LEAVES,label:'树叶',  color:'#2d6e1e'},
  {id:B.GRAVEL,label:'砾石',  color:'#6a6560'},
  {id:B.SNOW,  label:'雪地',  color:'#e8edf5'},
]
let sel=0
const hbar=document.getElementById('hotbar')
SLOTS.forEach((s,i)=>{
  const el=document.createElement('div')
  el.className='slot'+(i===0?' active':'')
  el.id=`slot-${i}`
  el.innerHTML=`<div class="slot-icon" style="background:${s.color};border:1px solid rgba(255,255,255,.2)"></div><div class="slot-label">${s.label}</div>`
  el.addEventListener('pointerdown',()=>pick(i))
  hbar.appendChild(el)
})
function pick(i) {
  document.getElementById(`slot-${sel}`)?.classList.remove('active')
  sel=((i%SLOTS.length)+SLOTS.length)%SLOTS.length
  document.getElementById(`slot-${sel}`)?.classList.add('active')
}
document.addEventListener('keydown',e=>{ const n=+e.key; if(n>=1&&n<=8) pick(n-1) })
document.addEventListener('wheel',e=>pick(sel+(e.deltaY>0?1:-1)),{passive:true})

// ─── Fly ─────────────────────────────────────────────────────────────────────
function toggleFly(){
  player.flying=!player.flying
  document.getElementById('btn-fly')?.classList.toggle('active',player.flying)
}
document.addEventListener('keydown',e=>{ if(e.code==='KeyF') toggleFly() })

// ─── Desktop Controls ─────────────────────────────────────────────────────────
let locked=false
renderer.domElement.addEventListener('click',()=>{ if(gameStarted) renderer.domElement.requestPointerLock?.() })
document.addEventListener('pointerlockchange',()=>{ locked=document.pointerLockElement===renderer.domElement })
document.addEventListener('mousemove',e=>{
  if(!locked) return
  player.yaw  -=e.movementX*.002
  player.pitch =Math.max(-1.55,Math.min(1.55,player.pitch-e.movementY*.002))
})
document.addEventListener('mousedown',e=>{
  if(!locked) return
  const d=new Vector3(); camera.getWorldDirection(d)
  const r=raycast(camera.position,d,8); if(!r) return
  if(e.button===0) setBlock(r.hit[0],r.hit[1],r.hit[2],0)
  if(e.button===2) setBlock(r.prev[0],r.prev[1],r.prev[2],SLOTS[sel].id)
})
document.addEventListener('contextmenu',e=>e.preventDefault())
document.addEventListener('keydown',e=>{
  if(e.code==='Space'&&!player.flying&&player.onGround) player.vel.y=JUMP_V
  if(e.code==='Escape') menuEl.style.display=menuEl.style.display==='none'?'flex':'none'
})

// ─── Mobile Joystick ─────────────────────────────────────────────────────────
const JR=45
const jz =document.getElementById('joy-zone')
const jth=document.getElementById('joy-thumb')
const jb =document.getElementById('joy-base')
let jt=null,jx=0,jy=0,jbx=0,jby=0

jz.addEventListener('touchstart',e=>{
  e.preventDefault()
  const t=e.changedTouches[0]; jt=t.identifier
  const r=jb.getBoundingClientRect(); jbx=r.left+r.width/2; jby=r.top+r.height/2
  joyMove(t.clientX,t.clientY)
},{passive:false})
jz.addEventListener('touchmove',e=>{
  e.preventDefault()
  for(const t of e.changedTouches) if(t.identifier===jt) joyMove(t.clientX,t.clientY)
},{passive:false})
jz.addEventListener('touchend',e=>{
  e.preventDefault()
  for(const t of e.changedTouches) if(t.identifier===jt){jt=null;jx=0;jy=0;jth.style.transform='translate(-50%,-50%)'}
},{passive:false})
function joyMove(cx,cy){
  const dx=cx-jbx, dy=cy-jby, dist=Math.sqrt(dx*dx+dy*dy), cl=Math.min(dist,JR), a=Math.atan2(dy,dx)
  jx=(cl/JR)*Math.cos(a); jy=(cl/JR)*Math.sin(a)
  jth.style.transform=`translate(calc(-50% + ${Math.cos(a)*cl}px),calc(-50% + ${Math.sin(a)*cl}px))`
}

// ─── Mobile Look ─────────────────────────────────────────────────────────────
const lz=document.getElementById('look-zone')
let lt=null,llx=0,lly=0
lz.addEventListener('touchstart',e=>{
  e.preventDefault()
  const t=e.changedTouches[0]; lt=t.identifier; llx=t.clientX; lly=t.clientY
},{passive:false})
lz.addEventListener('touchmove',e=>{
  e.preventDefault()
  for(const t of e.changedTouches){
    if(t.identifier!==lt) continue
    player.yaw  -=(t.clientX-llx)*.004
    player.pitch =Math.max(-1.55,Math.min(1.55,player.pitch-(t.clientY-lly)*.004))
    llx=t.clientX; lly=t.clientY
  }
},{passive:false})
lz.addEventListener('touchend',e=>{
  e.preventDefault()
  for(const t of e.changedTouches) if(t.identifier===lt) lt=null
},{passive:false})

// ─── Mobile Buttons ───────────────────────────────────────────────────────────
function onBtn(id,fn){
  document.getElementById(id)?.addEventListener('touchstart',e=>{e.preventDefault();fn()},{passive:false})
}
onBtn('btn-jump', ()=>{
  if(player.flying) player.vel.y=FLY_SP
  else if(player.onGround) player.vel.y=JUMP_V
})
onBtn('btn-fly',   toggleFly)
onBtn('btn-break', ()=>{
  const d=new Vector3(); camera.getWorldDirection(d)
  const r=raycast(camera.position,d,8); if(r) setBlock(r.hit[0],r.hit[1],r.hit[2],0)
})
onBtn('btn-place', ()=>{
  const d=new Vector3(); camera.getWorldDirection(d)
  const r=raycast(camera.position,d,8); if(r) setBlock(r.prev[0],r.prev[1],r.prev[2],SLOTS[sel].id)
})

// Hotbar swipe
let swx=0
hbar.addEventListener('touchstart',e=>{swx=e.touches[0].clientX},{passive:true})
hbar.addEventListener('touchend',e=>{
  if(Math.abs(e.changedTouches[0].clientX-swx)>30) pick(sel+(e.changedTouches[0].clientX<swx?1:-1))
},{passive:true})

// ─── Game Loop ────────────────────────────────────────────────────────────────
const euler=new Euler(0,0,0,'YXZ')
let gameStarted=false, last=performance.now()
let dayTime=0.25

const keys={}
document.addEventListener('keydown',e=>{ keys[e.code]=true })
document.addEventListener('keyup',  e=>{ keys[e.code]=false })

const coordEl=document.getElementById('coords')

function loop() {
  requestAnimationFrame(loop)
  rebuildBudget=Math.max(0,rebuildBudget-1)
  if(!gameStarted) return

  const now=performance.now(), dt=Math.min((now-last)/1000,.1); last=now

  const fwd=new Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw))
  const rgt=new Vector3(-Math.cos(player.yaw),0, Math.sin(player.yaw))
  const sp=player.flying?FLY_SP:MOVE_SP
  let mx=0,mz=0

  if(keys['KeyW']||keys['ArrowUp'])   {mx+=fwd.x;mz+=fwd.z}
  if(keys['KeyS']||keys['ArrowDown']) {mx-=fwd.x;mz-=fwd.z}
  if(keys['KeyA']||keys['ArrowLeft']) {mx+=rgt.x;mz+=rgt.z}
  if(keys['KeyD']||keys['ArrowRight']){mx-=rgt.x;mz-=rgt.z}
  if(jt!==null){
    const DEAD=.25
    if(Math.abs(jy)>DEAD){mx+=fwd.x*(-jy);mz+=fwd.z*(-jy)}
    if(Math.abs(jx)>DEAD){mx+=rgt.x*(-jx);mz+=rgt.z*(-jx)}
  }
  const mlen=Math.sqrt(mx*mx+mz*mz)
  if(mlen>0){player.vel.x+=mx/mlen*sp*dt*8;player.vel.z+=mz/mlen*sp*dt*8}

  if(player.flying){
    if(keys['Space'])       player.vel.y=FLY_SP
    else if(keys['ShiftLeft']) player.vel.y=-FLY_SP
    else player.vel.y*=.8
  }

  stepPlayer(dt)

  camera.position.set(player.pos.x, player.pos.y+1.6, player.pos.z)
  euler.set(player.pitch,player.yaw,0)
  camera.quaternion.setFromEuler(euler)

  dayTime=(dayTime+dt/1200)%1
  const s=Math.sin(dayTime*Math.PI*2), br=Math.max(.05,s), night=dayTime>.5
  const sky=new Color(
    night?.02:br*.35+.13,
    night?.05:br*.55+.26,
    night?.12:br*.9+.43
  )
  renderer.setClearColor(sky)
  fog.color.copy(sky)
  sun.intensity=br*1.2

  loadAround(player.pos.x,player.pos.y,player.pos.z)
  rebuildDirty()

  coordEl.textContent=`X:${player.pos.x|0} Y:${player.pos.y|0} Z:${player.pos.z|0}${player.flying?' ✈':''}`
  renderer.render(scene,camera)
}
loop()

// ─── Async Loading ────────────────────────────────────────────────────────────
async function doLoad() {
  // Hard timeout: if stuck >10s, proceed to menu regardless
  const timeout = setTimeout(()=>{
    loadingEl.style.display='none'
    menuEl.style.display='flex'
  }, 10000)

  try {
    setProgress(5, '5% ▶ JS模块已加载，初始化引擎…')
    await nextFrame()
    await nextFrame()

    setProgress(15, '15% ▶ WebGL渲染器测试…')
    await nextFrame()
    // Render a test frame to verify WebGL works
    renderer.render(scene, camera)

    setProgress(25, '25% ▶ 计算地形高度…')
    await nextFrame()

    const sx=Math.floor(player.pos.x/CHUNK)
    const sy=Math.max(0, Math.floor((player.pos.y-2)/CHUNK))
    const sz=Math.floor(player.pos.z/CHUNK)

    // Pre-generate 3x3 XZ at player Y — 9 chunks total, fast on mobile
    const chunks=[]
    for (let cx=sx-1; cx<=sx+1; cx++)
      for (let cz=sz-1; cz<=sz+1; cz++)
        chunks.push([cx, sy, cz])

    setProgress(30, `30% ▶ 开始生成 ${chunks.length} 个地形区块…`)
    await nextFrame()

    for (let i=0; i<chunks.length; i++) {
      const [cx,cy,cz]=chunks[i]
      const key=ck(cx,cy,cz)
      if (!loaded.has(key)) {
        loaded.add(key)
        genChunk(cx,cy,cz)
        const m=buildMesh(cx,cy,cz)
        if (m) { scene.add(m); meshes.set(key,m) }
      }
      const pct = Math.round(30 + 65*(i+1)/chunks.length)
      setProgress(pct, `${pct}% ▶ 区块 ${i+1}/${chunks.length} 已生成`)
      // Yield every chunk so the browser can update the progress bar
      await nextFrame()
    }

    setProgress(100, '100% ▶ 世界生成完毕！')
    await wait(500)

    clearTimeout(timeout)
    loadingEl.style.display='none'
    menuEl.style.display='flex'
  } catch(e) {
    clearTimeout(timeout)
    const msg=e?.message||String(e)
    setProgress(0, '加载失败: '+msg)
    loadFill.style.background='#f44'
    console.error('doLoad error:', e)
  }
}

doLoad()

window.startGame=function(){
  menuEl.style.display='none'
  guiEl.style.display='block'
  gameStarted=true; last=performance.now()
  try{ screen.orientation?.lock?.('landscape') }catch(e){}
}
