// ─── init.js ──────────────────────────────────────────────────────────────────
// 最先执行：设置诊断标志、缓存 DOM 引用、声明 setProgress。
// window._ok 告诉诊断脚本"游戏代码已开始执行"，防止 10 秒超时误报。
// window._step 在关键节点更新，供错误信息定位用。

window._ok   = true;
window._step = 1;

var loadEl   = document.getElementById('loading');
var loadFill = document.getElementById('loading-fill');
var loadText = document.getElementById('loading-text');
var loadSub  = document.getElementById('loading-sub');
var loadLog  = document.getElementById('loading-log');
var menuEl   = document.getElementById('menu');
var uiEl     = document.getElementById('ui');
var coordEl  = document.getElementById('coords');

// GSAP 是否可用（gsap.min.js 在游戏包之前以 <script> 加载）。全局共享给所有源文件。
var _hasGsap = (typeof gsap !== 'undefined');

// 标题入场弹跳（加载页 + 菜单页）
if (_hasGsap) {
  gsap.from('#loading h1, #menu h1', { scale: 0.7, autoAlpha: 0, y: -14,
    duration: 0.7, ease: 'back.out(1.7)' });
}

// 更新加载进度条和文字
function setProgress(pct, msg) {
  if (loadFill) {
    if (_hasGsap) gsap.to(loadFill, { width: pct + '%', duration: 0.4, ease: 'power2.out', overwrite: true });
    else loadFill.style.width = pct + '%';
  }
  if (loadText) loadText.textContent = msg;
}

// 当前文件提示（小字）
function setProgressSub(msg) {
  if (loadSub) loadSub.textContent = msg;
}

// 追加到滚动日志（最多显示 5 行）
var _logLines = [];
function addProgressLog(msg) {
  _logLines.push(msg);
  if (_logLines.length > 5) _logLines.shift();
  if (loadLog) loadLog.innerHTML = _logLines.map(function(l) {
    return '<span style="color:#22c55e">✓</span> ' + l;
  }).join('<br>');
}

setProgress(5, 'Three.js 初始化...');

// three.min.js 必须在此脚本块之前以 <script src> 加载
if (typeof THREE === 'undefined') {
  setProgress(0, '错误: THREE 未定义 — lib/three.min.js 未加载');
  throw new Error('THREE undefined');
}

window._step = 2;
