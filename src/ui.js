// ─── ui.js ────────────────────────────────────────────────────────────────────
// 游戏 UI：热键栏渲染、槽位选择。
//
// 热键栏：从 player.inv 动态生成 DOM 元素，
//   每个槽位显示方块颜色（用 BCOL 顶面色生成内联背景色）和中文名。
//   点击/触摸切换 player.slot，更新 .on 样式类。

function buildHotbar() {
  var hbar = document.getElementById('hotbar');
  if (!hbar) return;
  hbar.innerHTML = '';

  var i, id, slot, cs, r, g, b;
  for (i = 0; i < player.inv.length; i++) {
    id   = player.inv[i];
    cs   = BCOL[id];
    r    = Math.round(cs[0] * 255);
    g    = Math.round(cs[1] * 255);
    b    = Math.round(cs[2] * 255);

    slot = document.createElement('div');
    slot.className = 'slot' + (i === player.slot ? ' on' : '');
    slot.id = 'slot-' + i;
    slot.innerHTML =
      '<div class="slot-ic" style="background:rgb(' + r + ',' + g + ',' + b + ')"></div>' +
      '<div class="slot-lbl">' + BNAMES[id] + '</div>';

    // 闭包捕获 i 和 slot 元素，避免循环变量陷阱
    (function (idx, slotEl) {
      slotEl.addEventListener('touchstart', function (e) {
        e.preventDefault();
        var prev = document.getElementById('slot-' + player.slot);
        if (prev) prev.classList.remove('on');
        player.slot = idx;
        slotEl.classList.add('on');
      }, { passive: false });
    }(i, slot));

    hbar.appendChild(slot);
  }
}
