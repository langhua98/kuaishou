// Pure ES5, zero imports — maximally compatible with any WebKit version

window._ok = true;
window._step = 1;

var loadEl   = document.getElementById('loading');
var loadFill = document.getElementById('loading-fill');
var loadText = document.getElementById('loading-text');
var menuEl   = document.getElementById('menu');
var uiEl     = document.getElementById('ui');
var coordEl  = document.getElementById('coords');

function setProgress(pct, msg) {
  if (loadFill) loadFill.style.width = pct + '%';
  if (loadText) loadText.textContent = msg;
}

window._step = 2;

var canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;touch-action:none;display:block';
document.body.appendChild(canvas);

var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
if (!gl) { setProgress(0, 'WebGL不支持'); throw new Error('no webgl'); }

window._step = 3;

function resize() {
  canvas.width  = window.innerWidth  * Math.min(devicePixelRatio, 2);
  canvas.height = window.innerHeight * Math.min(devicePixelRatio, 2);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
window.addEventListener('resize', resize);

var VERT_SRC =
  'attribute vec3 aPos;\n' +
  'attribute vec3 aCol;\n' +
  'uniform mat4 uMVP;\n' +
  'varying vec3 vCol;\n' +
  'void main(){gl_Position=uMVP*vec4(aPos,1.0);vCol=aCol;}';

var FRAG_SRC =
  'precision mediump float;\n' +
  'varying vec3 vCol;\n' +
  'void main(){gl_FragColor=vec4(vCol,1.0);}';

function mkShader(type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  return s;
}

var prog = gl.createProgram();
gl.attachShader(prog, mkShader(gl.VERTEX_SHADER,   VERT_SRC));
gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FRAG_SRC));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
  throw new Error('Link: ' + gl.getProgramInfoLog(prog));
gl.useProgram(prog);

var aPos = gl.getAttribLocation(prog, 'aPos');
var aCol = gl.getAttribLocation(prog, 'aCol');
var uMVP = gl.getUniformLocation(prog, 'uMVP');
gl.enableVertexAttribArray(aPos);
gl.enableVertexAttribArray(aCol);
gl.enable(gl.DEPTH_TEST);
gl.enable(gl.CULL_FACE);

window._step = 4;

function mat4() { return new Float32Array(16); }

function perspective(out, fovy, aspect, near, far) {
  var f = 1 / Math.tan(fovy / 2);
  out[0]=f/aspect; out[1]=0; out[2]=0; out[3]=0;
  out[4]=0; out[5]=f; out[6]=0; out[7]=0;
  out[8]=0; out[9]=0; out[10]=(far+near)/(near-far); out[11]=-1;
  out[12]=0; out[13]=0; out[14]=(2*far*near)/(near-far); out[15]=0;
}

function viewMatrix(out, px, py, pz, yaw, pitch) {
  var cy = Math.cos(yaw),   sy = Math.sin(yaw);
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  var rx=cy, ry=0, rz=-sy;
  var ux=sy*sp, uy=cp, uz=cy*sp;
  var fx=-sy*cp, fy=sp, fz=-cy*cp;
  out[0]=rx;  out[1]=ux;  out[2]=-fx; out[3]=0;
  out[4]=ry;  out[5]=uy;  out[6]=-fy; out[7]=0;
  out[8]=rz;  out[9]=uz;  out[10]=-fz;out[11]=0;
  out[12]=-(rx*px+ry*py+rz*pz);
  out[13]=-(ux*px+uy*py+uz*pz);
  out[14]= (fx*px+fy*py+fz*pz);
  out[15]=1;
}

function mul4(out, a, b) {
  var i, j, k;
  for (i=0; i<4; i++) for (j=0; j<4; j++) {
    out[i*4+j]=0;
    for (k=0; k<4; k++) out[i*4+j]+=a[i*4+k]*b[k*4+j];
  }
  return out;
}

window._step = 5;

var CHUNK_W=16, CHUNK_H=64, CHUNK_D=16;
var SEA=12, AMP=14, SCALE=0.04;
var GRAVITY=28, JUMP_V=10, PH=1.7, PR=0.3;
var MOVE_SPD=5, FLY_SPD=8;

var AIR=0, GRASS=1, DIRT=2, STONE=3, SAND=4, WOOD=5, LEAVES=6, WATER=7;

var BCOL = [
  null,
  [0.365,0.702,0.365, 0.545,0.369,0.235, 0.478,0.478,0.290],
  [0.545,0.369,0.235, 0.545,0.369,0.235, 0.545,0.369,0.235],
  [0.533,0.533,0.533, 0.533,0.533,0.533, 0.533,0.533,0.533],
  [0.831,0.784,0.478, 0.831,0.784,0.478, 0.831,0.784,0.478],
  [0.361,0.239,0.118, 0.361,0.239,0.118, 0.478,0.322,0.188],
  [0.176,0.431,0.176, 0.176,0.431,0.176, 0.176,0.431,0.176],
  [0.200,0.400,0.800, 0.200,0.400,0.800, 0.200,0.400,0.800]
];
var BNAMES = ['','草地','泥土','石头','沙子','木头','树叶','水'];

window._step = 6;

// Perlin noise — pure ES5, no external dependencies
var _perm = new Uint8Array(512);
(function() {
  var i, j, tmp;
  for (i=0; i<256; i++) _perm[i] = i;
  for (i=255; i>0; i--) {
    j = Math.floor(Math.random() * (i+1));
    tmp = _perm[i]; _perm[i] = _perm[j]; _perm[j] = tmp;
  }
  for (i=0; i<256; i++) _perm[i+256] = _perm[i];
}());

function _fade(t) { return t*t*t*(t*(t*6-15)+10); }
function _lerp(a,b,t) { return a+t*(b-a); }
function _grad(h,x,z) {
  switch (h & 3) {
    case 0: return  x+z;
    case 1: return -x+z;
    case 2: return  x-z;
    default: return -x-z;
  }
}

function noise2D(x, z) {
  var ix=Math.floor(x)&255, iz=Math.floor(z)&255;
  var fx=x-Math.floor(x), fz=z-Math.floor(z);
  var ux=_fade(fx), uz=_fade(fz);
  var aa=_perm[_perm[ix  ]+iz  ];
  var ab=_perm[_perm[ix  ]+iz+1];
  var ba=_perm[_perm[ix+1]+iz  ];
  var bb=_perm[_perm[ix+1]+iz+1];
  return _lerp(
    _lerp(_grad(aa,fx,fz),   _grad(ba,fx-1,fz),   ux),
    _lerp(_grad(ab,fx,fz-1), _grad(bb,fx-1,fz-1), ux),
    uz
  );
}

var chunks = {};

function ckey(cx,cz) { return cx+','+cz; }
function gchunk(cx,cz) { return chunks[ckey(cx,cz)]; }

function getBlock(wx,wy,wz) {
  var cx, cz, ch, lx, lz;
  if (wy<0) return STONE;
  if (wy>=CHUNK_H) return AIR;
  cx=Math.floor(wx/CHUNK_W); cz=Math.floor(wz/CHUNK_D);
  ch=gchunk(cx,cz); if (!ch) return AIR;
  lx=((wx%CHUNK_W)+CHUNK_W)%CHUNK_W;
  lz=((wz%CHUNK_D)+CHUNK_D)%CHUNK_D;
  return ch.data[lx+wy*CHUNK_W+lz*CHUNK_W*CHUNK_H];
}

function setBlock(wx,wy,wz,id) {
  var cx, cz, ch, lx, lz;
  if (wy<0||wy>=CHUNK_H) return;
  cx=Math.floor(wx/CHUNK_W); cz=Math.floor(wz/CHUNK_D);
  ch=gchunk(cx,cz); if (!ch) return;
  lx=((wx%CHUNK_W)+CHUNK_W)%CHUNK_W;
  lz=((wz%CHUNK_D)+CHUNK_D)%CHUNK_D;
  ch.data[lx+wy*CHUNK_W+lz*CHUNK_W*CHUNK_H]=id;
  rebuildChunk(cx,cz);
  if (lx===0)         rebuildChunk(cx-1,cz);
  if (lx===CHUNK_W-1) rebuildChunk(cx+1,cz);
  if (lz===0)         rebuildChunk(cx,cz-1);
  if (lz===CHUNK_D-1) rebuildChunk(cx,cz+1);
}

function genTerrain(cx,cz) {
  var data=new Uint8Array(CHUNK_W*CHUNK_H*CHUNK_D);
  var lx,lz,wx,wz,h,y,id;
  for (lx=0; lx<CHUNK_W; lx++) {
    for (lz=0; lz<CHUNK_D; lz++) {
      wx=cx*CHUNK_W+lx; wz=cz*CHUNK_D+lz;
      h=Math.floor(SEA+noise2D(wx*SCALE,wz*SCALE)*AMP);
      for (y=0; y<=h&&y<CHUNK_H; y++) {
        if (y===h) id=(h<=SEA+1)?SAND:GRASS;
        else if (y>=h-3) id=DIRT;
        else id=STONE;
        data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H]=id;
      }
      for (y=h+1; y<=SEA; y++) data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H]=WATER;
    }
  }
  return data;
}

// Each face: [dx,dy,dz, cornersFlat12, colorOffset]
var FACES = [
  [1,0,0,  [1,0,0,1,1,0,1,1,1,1,0,1], 6],
  [-1,0,0, [0,0,1,0,1,1,0,1,0,0,0,0], 6],
  [0,1,0,  [0,1,1,1,1,1,1,1,0,0,1,0], 0],
  [0,-1,0, [0,0,0,1,0,0,1,0,1,0,0,1], 3],
  [0,0,1,  [1,0,1,1,1,1,0,1,1,0,0,1], 6],
  [0,0,-1, [0,0,0,0,1,0,1,1,0,1,0,0], 6]
];

function buildMesh(cx,cz,data) {
  var pos=[],col=[],idx=[],vi=0;
  var lx,y,lz,id,wx,wz,cs,f,fd,nb,ci,cr,cg,cb2,cn,c;
  for (lx=0; lx<CHUNK_W; lx++) {
    for (y=0; y<CHUNK_H; y++) {
      for (lz=0; lz<CHUNK_D; lz++) {
        id=data[lx+y*CHUNK_W+lz*CHUNK_W*CHUNK_H];
        if (id===AIR) continue;
        wx=cx*CHUNK_W+lx; wz=cz*CHUNK_D+lz;
        cs=BCOL[id]; if (!cs) continue;
        for (f=0; f<6; f++) {
          fd=FACES[f];
          nb=getBlock(wx+fd[0],y+fd[1],wz+fd[2]);
          if (nb!==AIR&&nb!==WATER) continue;
          if (id===WATER&&f!==2) continue;
          ci=fd[4]; cr=cs[ci]; cg=cs[ci+1]; cb2=cs[ci+2];
          cn=fd[3];
          for (c=0; c<4; c++) {
            pos.push(wx+cn[c*3],y+cn[c*3+1],wz+cn[c*3+2]);
            col.push(cr,cg,cb2);
          }
          idx.push(vi,vi+1,vi+2,vi,vi+2,vi+3);
          vi+=4;
        }
      }
    }
  }
  if (pos.length===0) return null;
  return {pos:new Float32Array(pos), col:new Float32Array(col), idx:new Uint16Array(idx)};
}

function rebuildChunk(cx,cz) {
  var ch=gchunk(cx,cz); if (!ch) return;
  if (ch.buf) {
    gl.deleteBuffer(ch.buf.pb);
    gl.deleteBuffer(ch.buf.cb);
    gl.deleteBuffer(ch.buf.ib);
  }
  ch.buf=null; ch.count=0;
  var m=buildMesh(cx,cz,ch.data); if (!m) return;
  var pb=gl.createBuffer(), cb=gl.createBuffer(), ib=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,pb); gl.bufferData(gl.ARRAY_BUFFER,m.pos,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER,cb); gl.bufferData(gl.ARRAY_BUFFER,m.col,gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,m.idx,gl.STATIC_DRAW);
  ch.buf={pb:pb,cb:cb,ib:ib}; ch.count=m.idx.length;
}

function createChunk(cx,cz) {
  var k=ckey(cx,cz); if (chunks[k]) return;
  chunks[k]={data:genTerrain(cx,cz),buf:null,count:0};
}

window._step = 7;

var player = {
  x:8, y:SEA+AMP+4, z:8,
  vx:0, vy:0, vz:0,
  yaw:0, pitch:0,
  onGround:false, flying:false,
  jumpQ:false, breakQ:false, placeQ:false,
  slot:0,
  inv:[GRASS,DIRT,STONE,SAND,WOOD,LEAVES,WATER]
};

function resolveAABB() {
  var hw=PR, hh=PH;
  var x0=player.x-hw, x1=player.x+hw;
  var y0=player.y, y1=player.y+hh;
  var z0=player.z-hw, z1=player.z+hw;
  var bx,by,bz,bid,ox,oy,oz;
  for (bx=Math.floor(x0); bx<=Math.floor(x1); bx++) {
    for (by=Math.floor(y0); by<=Math.floor(y1); by++) {
      for (bz=Math.floor(z0); bz<=Math.floor(z1); bz++) {
        bid=getBlock(bx,by,bz);
        if (bid===AIR||bid===WATER) continue;
        ox=Math.min(player.x+hw-bx, bx+1-(player.x-hw));
        oy=Math.min(player.y+hh-by, by+1-player.y);
        oz=Math.min(player.z+hw-bz, bz+1-(player.z-hw));
        if (ox<=0||oy<=0||oz<=0) continue;
        if (oy<ox&&oy<oz) {
          if (player.y+hh/2<by+0.5) { player.y-=oy; player.vy=Math.min(player.vy,0); }
          else { player.y+=oy; player.vy=Math.max(player.vy,0); player.onGround=true; }
        } else if (ox<oz) { player.x+=(player.x<bx+0.5)?-ox:ox; player.vx=0; }
        else               { player.z+=(player.z<bz+0.5)?-oz:oz; player.vz=0; }
      }
    }
  }
}

function raycast(maxD) {
  var cp=Math.cos(player.pitch), sp=Math.sin(player.pitch);
  var dx=-Math.sin(player.yaw)*cp, dy=sp, dz=-Math.cos(player.yaw)*cp;
  var ox=player.x, oy=player.y+PH*0.85, oz=player.z;
  var prev=null, d, bx, by, bz, id;
  for (d=0; d<maxD; d+=0.05) {
    bx=Math.floor(ox+dx*d); by=Math.floor(oy+dy*d); bz=Math.floor(oz+dz*d);
    id=getBlock(bx,by,bz);
    if (id!==AIR&&id!==WATER) return {x:bx,y:by,z:bz,prev:prev};
    prev={x:bx,y:by,z:bz};
  }
  return null;
}

window._step = 8;

var joy={active:false,id:-1,cx:0,cy:0,dx:0,dy:0};
var lookAct=false, lookId=-1, lookLx=0, lookLy=0;

var joyZone  = document.getElementById('joy-zone');
var joyThumb = document.getElementById('joy-thumb');
var joyBase  = document.getElementById('joy-base');
var lookZone = document.getElementById('look-zone');

joyZone.addEventListener('touchstart', function(e) {
  e.preventDefault();
  var i, t, r;
  for (i=0; i<e.changedTouches.length; i++) {
    t=e.changedTouches[i]; if (joy.active) continue;
    joy.active=true; joy.id=t.identifier;
    r=joyBase.getBoundingClientRect();
    joy.cx=r.left+r.width/2; joy.cy=r.top+r.height/2; joy.dx=0; joy.dy=0;
  }
}, {passive:false});

joyZone.addEventListener('touchmove', function(e) {
  e.preventDefault();
  var i, t;
  for (i=0; i<e.changedTouches.length; i++) {
    t=e.changedTouches[i]; if (t.identifier!==joy.id) continue;
    joy.dx=Math.max(-40,Math.min(40,t.clientX-joy.cx));
    joy.dy=Math.max(-40,Math.min(40,t.clientY-joy.cy));
    joyThumb.style.transform='translate(calc(-50% + '+joy.dx+'px),calc(-50% + '+joy.dy+'px))';
  }
}, {passive:false});

function jEnd(e) {
  e.preventDefault();
  var i;
  for (i=0; i<e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier===joy.id) {
      joy.active=false; joy.dx=0; joy.dy=0;
      joyThumb.style.transform='translate(-50%,-50%)';
    }
  }
}
joyZone.addEventListener('touchend',jEnd,{passive:false});
joyZone.addEventListener('touchcancel',jEnd,{passive:false});

lookZone.addEventListener('touchstart', function(e) {
  e.preventDefault();
  var i, t;
  for (i=0; i<e.changedTouches.length; i++) {
    t=e.changedTouches[i]; if (lookAct) continue;
    lookAct=true; lookId=t.identifier; lookLx=t.clientX; lookLy=t.clientY;
  }
}, {passive:false});

lookZone.addEventListener('touchmove', function(e) {
  e.preventDefault();
  var i, t;
  for (i=0; i<e.changedTouches.length; i++) {
    t=e.changedTouches[i]; if (t.identifier!==lookId) continue;
    player.yaw  -=(t.clientX-lookLx)*0.004;
    player.pitch-=(t.clientY-lookLy)*0.004;
    player.pitch=Math.max(-1.5,Math.min(1.5,player.pitch));
    lookLx=t.clientX; lookLy=t.clientY;
  }
}, {passive:false});

function lEnd(e) {
  e.preventDefault();
  var i;
  for (i=0; i<e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier===lookId) lookAct=false;
  }
}
lookZone.addEventListener('touchend',lEnd,{passive:false});
lookZone.addEventListener('touchcancel',lEnd,{passive:false});

function tapBtn(id,fn) {
  var el=document.getElementById(id);
  if (el) el.addEventListener('touchstart',function(e){e.preventDefault();fn();},{passive:false});
}
tapBtn('b-jump',function(){player.jumpQ=true;});
tapBtn('b-brk', function(){player.breakQ=true;});
tapBtn('b-plc', function(){player.placeQ=true;});
tapBtn('b-fly', function(){
  player.flying=!player.flying; player.vy=0;
  var el=document.getElementById('b-fly'); if (el) el.classList.toggle('on',player.flying);
});

function buildHotbar() {
  var hbar=document.getElementById('hotbar'); if (!hbar) return;
  hbar.innerHTML='';
  var i, id, slot, cs, r, g, b;
  for (i=0; i<player.inv.length; i++) {
    id=player.inv[i];
    slot=document.createElement('div');
    slot.className='slot'+(i===player.slot?' on':'');
    slot.id='slot-'+i;
    cs=BCOL[id];
    r=Math.round(cs[0]*255); g=Math.round(cs[1]*255); b=Math.round(cs[2]*255);
    slot.innerHTML='<div class="slot-ic" style="background:rgb('+r+','+g+','+b+')"></div>'
                  +'<div class="slot-lbl">'+BNAMES[id]+'</div>';
    (function(idx2,slotEl) {
      slotEl.addEventListener('touchstart',function(e){
        e.preventDefault();
        var prev=document.getElementById('slot-'+player.slot); if (prev) prev.classList.remove('on');
        player.slot=idx2; slotEl.classList.add('on');
      },{passive:false});
    }(i, slot));
    hbar.appendChild(slot);
  }
}

window._step = 9;

var lastCX=null, lastCZ=null, RDIST=3;

function updateChunks() {
  var cx=Math.floor(player.x/CHUNK_W), cz=Math.floor(player.z/CHUNK_D);
  if (cx===lastCX&&cz===lastCZ) return;
  lastCX=cx; lastCZ=cz;
  var dx,dz,keys,k,p2,kcx,kcz,ch;
  for (dx=-RDIST; dx<=RDIST; dx++) for (dz=-RDIST; dz<=RDIST; dz++) createChunk(cx+dx,cz+dz);
  for (dx=-RDIST; dx<=RDIST; dx++) for (dz=-RDIST; dz<=RDIST; dz++) rebuildChunk(cx+dx,cz+dz);
  keys=Object.keys(chunks);
  for (k=0; k<keys.length; k++) {
    p2=keys[k].split(','); kcx=+p2[0]; kcz=+p2[1];
    if (Math.abs(kcx-cx)>RDIST+1||Math.abs(kcz-cz)>RDIST+1) {
      ch=chunks[keys[k]];
      if (ch.buf) { gl.deleteBuffer(ch.buf.pb); gl.deleteBuffer(ch.buf.cb); gl.deleteBuffer(ch.buf.ib); }
      delete chunks[keys[k]];
    }
  }
}

var proj=mat4(), view=mat4(), mvp=mat4();

function render() {
  var W=canvas.width, H=canvas.height;
  gl.viewport(0,0,W,H);
  gl.clearColor(0.529,0.808,0.922,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  perspective(proj,1.309,W/H,0.1,100);
  viewMatrix(view,player.x,player.y+PH*0.85,player.z,player.yaw,player.pitch);
  mul4(mvp,proj,view);
  gl.uniformMatrix4fv(uMVP,false,mvp);
  var keys=Object.keys(chunks),k,ch;
  for (k=0; k<keys.length; k++) {
    ch=chunks[keys[k]]; if (!ch||!ch.buf||!ch.count) continue;
    gl.bindBuffer(gl.ARRAY_BUFFER,ch.buf.pb);
    gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,ch.buf.cb);
    gl.vertexAttribPointer(aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ch.buf.ib);
    gl.drawElements(gl.TRIANGLES,ch.count,gl.UNSIGNED_SHORT,0);
  }
}

var lastT=0;
function tick(now) {
  requestAnimationFrame(tick);
  var dt=Math.min((now-lastT)/1000,0.05); lastT=now;
  var sy=Math.sin(player.yaw), cy2=Math.cos(player.yaw);
  var jx=joy.dx/40, jy=joy.dy/40;
  var spd=player.flying?FLY_SPD:MOVE_SPD;
  player.vx=(-jy*(-sy)+jx*cy2)*spd;
  player.vz=(-jy*(-cy2)+jx*(-sy))*spd;
  if (player.flying) { player.vy*=0.8; }
  else { player.vy-=GRAVITY*dt; if (player.jumpQ&&player.onGround) player.vy=JUMP_V; }
  player.jumpQ=false; player.onGround=false;
  player.x+=player.vx*dt; player.y+=player.vy*dt; player.z+=player.vz*dt;
  resolveAABB();
  var hit, hit2, pv, px, py, pz;
  if (player.breakQ) {
    player.breakQ=false;
    hit=raycast(6); if (hit) setBlock(hit.x,hit.y,hit.z,AIR);
  }
  if (player.placeQ) {
    player.placeQ=false;
    hit2=raycast(6);
    if (hit2&&hit2.prev) {
      pv=hit2.prev;
      px=Math.floor(player.x); py=Math.floor(player.y); pz=Math.floor(player.z);
      if (!(pv.x===px&&(pv.y===py||pv.y===py+1)&&pv.z===pz))
        setBlock(pv.x,pv.y,pv.z,player.inv[player.slot]);
    }
  }
  coordEl.textContent='X:'+Math.floor(player.x)+' Y:'+Math.floor(player.y)+' Z:'+Math.floor(player.z);
  updateChunks();
  render();
}

window.startGame = function() {
  if (menuEl) menuEl.style.display='none';
  if (uiEl)   uiEl.style.display='block';
  buildHotbar();
  lastT=performance.now();
  requestAnimationFrame(tick);
};

// Boot — no async/await, uses requestAnimationFrame steps
var bootSX, bootSZ, bootStep=0;

function bootNext() {
  try {
    if (bootStep===0) {
      setProgress(10,'步骤1: 测试WebGL...');
      gl.clear(gl.COLOR_BUFFER_BIT);
      bootSX=Math.floor(player.x/CHUNK_W);
      bootSZ=Math.floor(player.z/CHUNK_D);
      bootStep=1; requestAnimationFrame(bootNext);
    } else if (bootStep===1) {
      setProgress(25,'步骤2: 生成地形...');
      var dx1,dz1;
      for (dx1=-2; dx1<=2; dx1++) for (dz1=-2; dz1<=2; dz1++) createChunk(bootSX+dx1,bootSZ+dz1);
      bootStep=2; requestAnimationFrame(bootNext);
    } else if (bootStep>=2&&bootStep<=6) {
      var col2=bootStep-4;
      var dz2;
      for (dz2=-2; dz2<=2; dz2++) rebuildChunk(bootSX+col2,bootSZ+dz2);
      setProgress(40+(bootStep-2)*12,'构建中 '+(bootStep-1)+'/5...');
      bootStep++; requestAnimationFrame(bootNext);
    } else if (bootStep===7) {
      setProgress(92,'步骤4: 定位出生点...');
      var y;
      for (y=CHUNK_H-1; y>=0; y--) {
        var bid=getBlock(Math.floor(player.x),y,Math.floor(player.z));
        if (bid!==AIR&&bid!==WATER) { player.y=y+1; break; }
      }
      bootStep=8; requestAnimationFrame(bootNext);
    } else {
      setProgress(100,'完成!');
      if (loadEl) loadEl.style.display='none';
      if (menuEl) menuEl.style.display='flex';
    }
  } catch(e) {
    setProgress(0,'错误: '+(e.message||String(e)));
    if (loadFill) { loadFill.style.width='100%'; loadFill.style.background='#f44'; }
  }
}

requestAnimationFrame(bootNext);
