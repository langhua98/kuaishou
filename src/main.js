// v16: Full Minecraft clone — Three.js renderer, pure ES5 game logic
window._ok = true;
window._step = 1;

var loadEl  = document.getElementById('loading');
var loadFill= document.getElementById('loading-fill');
var loadText= document.getElementById('loading-text');
var menuEl  = document.getElementById('menu');
var uiEl    = document.getElementById('ui');
var coordEl = document.getElementById('coords');

function setProgress(pct, msg) {
  if (loadFill) loadFill.style.width = pct + '%';
  if (loadText) loadText.textContent = msg;
}

setProgress(5, 'Three.js 初始化...');
if (typeof THREE === 'undefined') { setProgress(0,'错误: THREE 未定义'); throw new Error('THREE'); }

window._step = 2;

// ── Renderer / Scene / Camera ─────────────────────────────────────────────
var renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none';
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 90);

var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.rotation.order = 'YXZ';

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
var sun = new THREE.DirectionalLight(0xfff0c8, 0.3);
sun.position.set(1, 2, 1);
scene.add(sun);

window.addEventListener('resize', function() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window._step = 3;
setProgress(10, '初始化世界...');

// ── Constants ────────────────────────────────────────────────────────────
var CHUNK_W=16, CHUNK_H=64, CHUNK_D=16;
var SEA=12, AMP=14, SCALE=0.04;
var GRAVITY=28, JUMP_V=10, PH=1.7, PR=0.3;
var MOVE_SPD=5, FLY_SPD=8;

var AIR=0,GRASS=1,DIRT=2,STONE=3,SAND=4,WOOD=5,LEAVES=6,WATER=7;

// BCOL[id]: [top_r,top_g,top_b, bot_r,bot_g,bot_b, side_r,side_g,side_b]
var BCOL=[null,
  [0.365,0.702,0.365, 0.545,0.369,0.235, 0.478,0.478,0.290],
  [0.545,0.369,0.235, 0.545,0.369,0.235, 0.545,0.369,0.235],
  [0.533,0.533,0.533, 0.533,0.533,0.533, 0.533,0.533,0.533],
  [0.831,0.784,0.478, 0.831,0.784,0.478, 0.831,0.784,0.478],
  [0.361,0.239,0.118, 0.361,0.239,0.118, 0.478,0.322,0.188],
  [0.176,0.431,0.176, 0.176,0.431,0.176, 0.176,0.431,0.176],
  [0.200,0.400,0.800, 0.200,0.400,0.800, 0.200,0.400,0.800]
];
var BNAMES=['','草地','泥土','石头','沙子','木头','树叶','水'];

// ── Perlin noise ──────────────────────────────────────────────────────────
var _perm=new Uint8Array(512);
(function(){var i,j,t;for(i=0;i<256;i++)_perm[i]=i;for(i=255;i>0;i--){j=Math.floor(Math.random()*(i+1));t=_perm[i];_perm[i]=_perm[j];_perm[j]=t;}for(i=0;i<256;i++)_perm[i+256]=_perm[i];}());
function _fade(t){return t*t*t*(t*(t*6-15)+10);}
function _lerp(a,b,t){return a+t*(b-a);}
function _grad(h,x,z){switch(h&3){case 0:return x+z;case 1:return -x+z;case 2:return x-z;default:return -x-z;}}
function noise2D(x,z){
  var ix=Math.floor(x)&255,iz=Math.floor(z)&255,fx=x-Math.floor(x),fz=z-Math.floor(z);
  var ux=_fade(fx),uz=_fade(fz);
  var aa=_perm[_perm[ix]+iz],ab=_perm[_perm[ix]+iz+1];
  var ba=_perm[_perm[ix+1]+iz],bb=_perm[_perm[ix+1]+iz+1];
  return _lerp(_lerp(_grad(aa,fx,fz),_grad(ba,fx-1,fz),ux),_lerp(_grad(ab,fx,fz-1),_grad(bb,fx-1,fz-1),ux),uz);
}

// ── World ─────────────────────────────────────────────────────────────────
var chunks={};
function ckey(cx,cz){return cx+','+cz;}
function gchunk(cx,cz){return chunks[ckey(cx,cz)];}

function getBlock(wx,wy,wz){
  if(wy<0)return STONE; if(wy>=CHUNK_H)return AIR;
  var cx=Math.floor(wx/CHUNK_W),cz=Math.floor(wz/CHUNK_D);
  var ch=gchunk(cx,cz); if(!ch)return AIR;
  var lx=((wx%CHUNK_W)+CHUNK_W)%CHUNK_W,lz=((wz%CHUNK_D)+CHUNK_D)%CHUNK_D;
  return ch.data[lx+wy*CHUNK_W+lz*CHUNK_W*CHUNK_H];
}
function setBlock(wx,wy,wz,id){
  if(wy<0||wy>=CHUNK_H)return;
  var cx=Math.floor(wx/CHUNK_W),cz=Math.floor(wz/CHUNK_D);
  var ch=gchunk(cx,cz); if(!ch)return;
  var lx=((wx%CHUNK_W)+CHUNK_W)%CHUNK_W,lz=((wz%CHUNK_D)+CHUNK_D)%CHUNK_D;
  ch.data[lx+wy*CHUNK_W+lz*CHUNK_W*CHUNK_H]=id;
  rebuildChunk(cx,cz);
  if(lx===0)rebuildChunk(cx-1,cz); if(lx===CHUNK_W-1)rebuildChunk(cx+1,cz);
  if(lz===0)rebuildChunk(cx,cz-1); if(lz===CHUNK_D-1)rebuildChunk(cx,cz+1);
}
function genTerrain(cx,cz){
  var data=new Uint8Array(CHUNK_W*CHUNK_H*CHUNK_D);
  var lx,lz,wx,wz,h,y,id;
  for(lx=0;lx<CHUNK_W;lx++)for(lz=0;lz<CHUNK_D;lz++){
    wx=cx*CHUNK_W+lx; wz=cz*CHUNK_D+lz;
    h=Math.floor(SEA+noise2D(wx*SCALE,wz*SCALE)*AMP);
    for(y=0;y<=h&&y<CHUNK_H;y++){
      id=(y===h)?((h<=SEA+1)?SAND:GRASS):(y>=h-3?DIRT:STONE);
      data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H]=id;
    }
    for(y=h+1;y<=SEA;y++)data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H]=WATER;
  }
  return data;
}

// ── Chunk mesh (Three.js BufferGeometry, vertex colors) ───────────────────
// [dx,dy,dz, [v0x,v0y,v0z, v1x,v1y,v1z, v2x,v2y,v2z, v3x,v3y,v3z], colorOffset]
var FACES=[
  [1,0,0,  [1,0,0,1,1,0,1,1,1,1,0,1], 6],
  [-1,0,0, [0,0,1,0,1,1,0,1,0,0,0,0], 6],
  [0,1,0,  [0,1,1,1,1,1,1,1,0,0,1,0], 0],
  [0,-1,0, [0,0,0,1,0,0,1,0,1,0,0,1], 3],
  [0,0,1,  [1,0,1,1,1,1,0,1,1,0,0,1], 6],
  [0,0,-1, [0,0,0,0,1,0,1,1,0,1,0,0], 6]
];
// Per-face brightness for free directional shading
var FSHADE=[0.80,0.80,1.00,0.50,0.85,0.85];

var _mat=new THREE.MeshBasicMaterial({vertexColors:true});

function buildMesh(cx,cz,data){
  var pos=[],col=[];
  var lx,y,lz,id,wx,wz,f,fd,nb,ci,sh,cr,cg,cb,cn;
  for(lx=0;lx<CHUNK_W;lx++)for(y=0;y<CHUNK_H;y++)for(lz=0;lz<CHUNK_D;lz++){
    id=data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H];
    if(id===AIR)continue;
    wx=cx*CHUNK_W+lx; wz=cz*CHUNK_D+lz;
    for(f=0;f<6;f++){
      fd=FACES[f];
      nb=getBlock(wx+fd[0],y+fd[1],wz+fd[2]);
      if(nb!==AIR&&nb!==WATER)continue;
      if(id===WATER&&f!==2)continue; // water: top face only
      ci=fd[4]; sh=FSHADE[f]; cn=fd[3];
      cr=BCOL[id][ci]*sh; cg=BCOL[id][ci+1]*sh; cb=BCOL[id][ci+2]*sh;
      // 4 corners → 2 triangles (0,1,2 and 0,2,3)
      pos.push(wx+cn[0],y+cn[1],wz+cn[2], wx+cn[3],y+cn[4],wz+cn[5], wx+cn[6],y+cn[7],wz+cn[8],
               wx+cn[0],y+cn[1],wz+cn[2], wx+cn[6],y+cn[7],wz+cn[8], wx+cn[9],y+cn[10],wz+cn[11]);
      col.push(cr,cg,cb,cr,cg,cb,cr,cg,cb, cr,cg,cb,cr,cg,cb,cr,cg,cb);
    }
  }
  if(pos.length===0)return null;
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));
  return new THREE.Mesh(geo,_mat);
}

function rebuildChunk(cx,cz){
  var ch=gchunk(cx,cz); if(!ch)return;
  if(ch.mesh){scene.remove(ch.mesh);ch.mesh.geometry.dispose();ch.mesh=null;}
  ch.mesh=buildMesh(cx,cz,ch.data);
  if(ch.mesh)scene.add(ch.mesh);
}
function createChunk(cx,cz){
  var k=ckey(cx,cz); if(chunks[k])return;
  chunks[k]={data:genTerrain(cx,cz),mesh:null};
}
function removeChunk(cx,cz){
  var k=ckey(cx,cz),ch=chunks[k]; if(!ch)return;
  if(ch.mesh){scene.remove(ch.mesh);ch.mesh.geometry.dispose();}
  delete chunks[k];
}

window._step=4;

// ── Player ────────────────────────────────────────────────────────────────
var player={
  x:8, y:SEA+AMP+4, z:8,
  vx:0, vy:0, vz:0,
  yaw:0, pitch:0,
  onGround:false, flying:false,
  jumpQ:false, breakQ:false, placeQ:false,
  slot:0,
  inv:[GRASS,DIRT,STONE,SAND,WOOD,LEAVES,WATER]
};

// ── AABB collision ────────────────────────────────────────────────────────
function resolveAABB(){
  var hw=PR,hh=PH;
  var x0=player.x-hw,x1=player.x+hw,y0=player.y,y1=player.y+hh,z0=player.z-hw,z1=player.z+hw;
  var bx,by,bz,bid,ox,oy,oz;
  for(bx=Math.floor(x0);bx<=Math.floor(x1);bx++){
    for(by=Math.floor(y0);by<=Math.floor(y1);by++){
      for(bz=Math.floor(z0);bz<=Math.floor(z1);bz++){
        bid=getBlock(bx,by,bz);
        if(bid===AIR||bid===WATER)continue;
        ox=Math.min(player.x+hw-bx,bx+1-(player.x-hw));
        oy=Math.min(player.y+hh-by,by+1-player.y);
        oz=Math.min(player.z+hw-bz,bz+1-(player.z-hw));
        if(ox<=0||oy<=0||oz<=0)continue;
        if(oy<ox&&oy<oz){
          if(player.y+hh/2<by+0.5){player.y-=oy;player.vy=Math.min(player.vy,0);}
          else{player.y+=oy;player.vy=Math.max(player.vy,0);player.onGround=true;}
        }else if(ox<oz){player.x+=(player.x<bx+0.5)?-ox:ox;player.vx=0;}
        else{player.z+=(player.z<bz+0.5)?-oz:oz;player.vz=0;}
      }
    }
  }
}

// ── Raycast ───────────────────────────────────────────────────────────────
function raycast(maxD){
  var cp=Math.cos(player.pitch),sp=Math.sin(player.pitch);
  var dx=-Math.sin(player.yaw)*cp,dy=sp,dz=-Math.cos(player.yaw)*cp;
  var ox=player.x,oy=player.y+PH*0.85,oz=player.z;
  var prev=null,d,bx,by,bz,id;
  for(d=0;d<maxD;d+=0.05){
    bx=Math.floor(ox+dx*d);by=Math.floor(oy+dy*d);bz=Math.floor(oz+dz*d);
    id=getBlock(bx,by,bz);
    if(id!==AIR&&id!==WATER)return{x:bx,y:by,z:bz,prev:prev};
    prev={x:bx,y:by,z:bz};
  }
  return null;
}

window._step=5;

// ── Touch controls ────────────────────────────────────────────────────────
var joy={active:false,id:-1,cx:0,cy:0,dx:0,dy:0};
var lookAct=false,lookId=-1,lookLx=0,lookLy=0;

var joyZone =document.getElementById('joy-zone');
var joyThumb=document.getElementById('joy-thumb');
var joyBase =document.getElementById('joy-base');
var lookZone=document.getElementById('look-zone');

joyZone.addEventListener('touchstart',function(e){
  e.preventDefault();
  var i,t,r;
  for(i=0;i<e.changedTouches.length;i++){
    t=e.changedTouches[i]; if(joy.active)continue;
    joy.active=true;joy.id=t.identifier;
    r=joyBase.getBoundingClientRect();
    joy.cx=r.left+r.width/2;joy.cy=r.top+r.height/2;joy.dx=0;joy.dy=0;
  }
},{passive:false});
joyZone.addEventListener('touchmove',function(e){
  e.preventDefault();
  var i,t;
  for(i=0;i<e.changedTouches.length;i++){
    t=e.changedTouches[i]; if(t.identifier!==joy.id)continue;
    joy.dx=Math.max(-40,Math.min(40,t.clientX-joy.cx));
    joy.dy=Math.max(-40,Math.min(40,t.clientY-joy.cy));
    joyThumb.style.transform='translate(calc(-50% + '+joy.dx+'px),calc(-50% + '+joy.dy+'px))';
  }
},{passive:false});
function jEnd(e){
  e.preventDefault();
  var i;
  for(i=0;i<e.changedTouches.length;i++){
    if(e.changedTouches[i].identifier===joy.id){
      joy.active=false;joy.dx=0;joy.dy=0;
      joyThumb.style.transform='translate(-50%,-50%)';
    }
  }
}
joyZone.addEventListener('touchend',jEnd,{passive:false});
joyZone.addEventListener('touchcancel',jEnd,{passive:false});

lookZone.addEventListener('touchstart',function(e){
  e.preventDefault();
  var i,t;
  for(i=0;i<e.changedTouches.length;i++){
    t=e.changedTouches[i]; if(lookAct)continue;
    lookAct=true;lookId=t.identifier;lookLx=t.clientX;lookLy=t.clientY;
  }
},{passive:false});
lookZone.addEventListener('touchmove',function(e){
  e.preventDefault();
  var i,t;
  for(i=0;i<e.changedTouches.length;i++){
    t=e.changedTouches[i]; if(t.identifier!==lookId)continue;
    player.yaw  -=(t.clientX-lookLx)*0.004;
    player.pitch-=(t.clientY-lookLy)*0.004;
    player.pitch=Math.max(-1.5,Math.min(1.5,player.pitch));
    lookLx=t.clientX;lookLy=t.clientY;
  }
},{passive:false});
function lEnd(e){
  e.preventDefault();
  var i;
  for(i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===lookId)lookAct=false;}
}
lookZone.addEventListener('touchend',lEnd,{passive:false});
lookZone.addEventListener('touchcancel',lEnd,{passive:false});

function tapBtn(id,fn){
  var el=document.getElementById(id);
  if(el)el.addEventListener('touchstart',function(e){e.preventDefault();fn();},{passive:false});
}
tapBtn('b-jump',function(){player.jumpQ=true;});
tapBtn('b-brk', function(){player.breakQ=true;});
tapBtn('b-plc', function(){player.placeQ=true;});
tapBtn('b-fly', function(){
  player.flying=!player.flying;player.vy=0;
  var el=document.getElementById('b-fly');if(el)el.classList.toggle('on',player.flying);
});

// ── Hotbar ────────────────────────────────────────────────────────────────
function buildHotbar(){
  var hbar=document.getElementById('hotbar');if(!hbar)return;
  hbar.innerHTML='';
  var i,id,slot,cs,r,g,b;
  for(i=0;i<player.inv.length;i++){
    id=player.inv[i];
    slot=document.createElement('div');
    slot.className='slot'+(i===player.slot?' on':'');
    slot.id='slot-'+i;
    cs=BCOL[id];
    r=Math.round(cs[0]*255);g=Math.round(cs[1]*255);b=Math.round(cs[2]*255);
    slot.innerHTML='<div class="slot-ic" style="background:rgb('+r+','+g+','+b+')"></div>'
                  +'<div class="slot-lbl">'+BNAMES[id]+'</div>';
    (function(idx2,slotEl){
      slotEl.addEventListener('touchstart',function(e){
        e.preventDefault();
        var prev=document.getElementById('slot-'+player.slot);if(prev)prev.classList.remove('on');
        player.slot=idx2;slotEl.classList.add('on');
      },{passive:false});
    }(i,slot));
    hbar.appendChild(slot);
  }
}

window._step=6;

// ── Chunk streaming ───────────────────────────────────────────────────────
var lastCX=null,lastCZ=null,RDIST=3;

function updateChunks(){
  var cx=Math.floor(player.x/CHUNK_W),cz=Math.floor(player.z/CHUNK_D);
  if(cx===lastCX&&cz===lastCZ)return;
  lastCX=cx;lastCZ=cz;
  var dx,dz,keys,k,p2,kcx,kcz;
  for(dx=-RDIST;dx<=RDIST;dx++)for(dz=-RDIST;dz<=RDIST;dz++)createChunk(cx+dx,cz+dz);
  for(dx=-RDIST;dx<=RDIST;dx++)for(dz=-RDIST;dz<=RDIST;dz++)rebuildChunk(cx+dx,cz+dz);
  keys=Object.keys(chunks);
  for(k=0;k<keys.length;k++){
    p2=keys[k].split(',');kcx=+p2[0];kcz=+p2[1];
    if(Math.abs(kcx-cx)>RDIST+1||Math.abs(kcz-cz)>RDIST+1)removeChunk(kcx,kcz);
  }
}

// ── Game loop ─────────────────────────────────────────────────────────────
var lastT=0;
function tick(now){
  requestAnimationFrame(tick);
  var dt=Math.min((now-lastT)/1000,0.05);lastT=now;

  // Movement
  var sy=Math.sin(player.yaw),cy2=Math.cos(player.yaw);
  var jx=joy.dx/40,jy=joy.dy/40;
  var spd=player.flying?FLY_SPD:MOVE_SPD;
  player.vx=(-jy*(-sy)+jx*cy2)*spd;
  player.vz=(-jy*(-cy2)+jx*(-sy))*spd;
  if(player.flying){player.vy*=0.8;}
  else{player.vy-=GRAVITY*dt;if(player.jumpQ&&player.onGround)player.vy=JUMP_V;}
  player.jumpQ=false;player.onGround=false;
  player.x+=player.vx*dt;player.y+=player.vy*dt;player.z+=player.vz*dt;
  resolveAABB();

  // Block interactions
  var hit,hit2,pv;
  if(player.breakQ){
    player.breakQ=false;
    hit=raycast(6);if(hit)setBlock(hit.x,hit.y,hit.z,AIR);
  }
  if(player.placeQ){
    player.placeQ=false;
    hit2=raycast(6);
    if(hit2&&hit2.prev){
      pv=hit2.prev;
      var px2=Math.floor(player.x),py2=Math.floor(player.y),pz2=Math.floor(player.z);
      if(!(pv.x===px2&&(pv.y===py2||pv.y===py2+1)&&pv.z===pz2))
        setBlock(pv.x,pv.y,pv.z,player.inv[player.slot]);
    }
  }

  // Update coords display
  if(coordEl)coordEl.textContent='X:'+Math.floor(player.x)+' Y:'+Math.floor(player.y)+' Z:'+Math.floor(player.z);

  // Chunk streaming
  updateChunks();

  // Camera
  camera.position.set(player.x, player.y+PH*0.85, player.z);
  camera.rotation.y=player.yaw;
  camera.rotation.x=player.pitch;

  renderer.render(scene,camera);
}

// ── Start game ────────────────────────────────────────────────────────────
window.startGame=function(){
  if(menuEl)menuEl.style.display='none';
  if(uiEl)uiEl.style.display='block';
  buildHotbar();
  lastT=performance.now();
  requestAnimationFrame(tick);
};

// ── Boot sequence (spread terrain gen over frames) ────────────────────────
var bootSX,bootSZ,bootStep=0;
function bootNext(){
  try{
    if(bootStep===0){
      setProgress(10,'测试渲染器...');
      renderer.render(scene,camera);
      bootSX=Math.floor(player.x/CHUNK_W);
      bootSZ=Math.floor(player.z/CHUNK_D);
      bootStep=1;requestAnimationFrame(bootNext);
    }else if(bootStep===1){
      setProgress(25,'生成地形...');
      var dx1,dz1;
      for(dx1=-2;dx1<=2;dx1++)for(dz1=-2;dz1<=2;dz1++)createChunk(bootSX+dx1,bootSZ+dz1);
      bootStep=2;requestAnimationFrame(bootNext);
    }else if(bootStep>=2&&bootStep<=6){
      var col2=bootStep-4,dz2;
      for(dz2=-2;dz2<=2;dz2++)rebuildChunk(bootSX+col2,bootSZ+dz2);
      setProgress(40+(bootStep-2)*12,'构建地形 '+(bootStep-1)+'/5...');
      bootStep++;requestAnimationFrame(bootNext);
    }else if(bootStep===7){
      setProgress(92,'定位出生点...');
      var y;
      for(y=CHUNK_H-1;y>=0;y--){
        if(getBlock(Math.floor(player.x),y,Math.floor(player.z))!==AIR){player.y=y+1;break;}
      }
      bootStep=8;requestAnimationFrame(bootNext);
    }else{
      setProgress(100,'完成!');
      if(loadEl)loadEl.style.display='none';
      if(menuEl)menuEl.style.display='flex';
    }
  }catch(e){
    setProgress(0,'错误: '+(e.message||String(e)));
    if(loadFill){loadFill.style.width='100%';loadFill.style.background='#f44';}
  }
}

requestAnimationFrame(bootNext);
