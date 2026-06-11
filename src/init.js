// ─── init.js ──────────────────────────────────────────────────────────────────
// 最先执行：设置诊断标志、缓存 DOM 引用、声明 setProgress。
// window._ok 告诉诊断脚本"游戏代码已开始执行"，防止 10 秒超时误报。
// window._step 在关键节点更新，供错误信息定位用。

window._ok   = true;
window._step = 1;

var loadEl   = document.getElementById('loading');
var loadFill = document.getElementById('loading-fill');
var loadText = document.getElementById('loading-text');
var menuEl   = document.getElementById('menu');
var uiEl     = document.getElementById('ui');
var coordEl  = document.getElementById('coords');

// 更新加载进度条和文字
function setProgress(pct, msg) {
  if (loadFill) loadFill.style.width = pct + '%';
  if (loadText) loadText.textContent = msg;
}

setProgress(5, 'Three.js 初始化...');

// three.min.js 必须在此脚本块之前以 <script src> 加载
if (typeof THREE === 'undefined') {
  setProgress(0, '错误: THREE 未定义 — lib/three.min.js 未加载');
  throw new Error('THREE undefined');
}

window._step = 2;
