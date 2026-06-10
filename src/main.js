// Minimal test: does ANY inline JS run on this device?
window._ok = true;
document.getElementById('loading-text').textContent = 'JS运行正常 v13 — 等待游戏载入';
document.getElementById('loading-fill').style.width = '50%';
document.getElementById('loading-fill').style.background = '#4ade80';
