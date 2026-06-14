// ─── physics.js ───────────────────────────────────────────────────────────────
// AABB 碰撞解算。
//
// 算法：穿透深度最小轴推出（非扫描式）
//   遍历玩家碰撞箱范围内所有实心方块，
//   计算在 X/Y/Z 三轴上的穿透深度，沿最小穿透轴将玩家推出去。
//
// 玩家碰撞箱：以 (player.x, player.y, player.z) 为底部中心，
//   宽度 PR×2，高度 PH（见 constants.js）。
// 水方块视为非实心（玩家可以穿过水面）。

function resolveAABB() {
  var hw = PR, hh = PH;
  var x0 = player.x - hw, x1 = player.x + hw;
  var y0 = player.y,      y1 = player.y + hh;
  var z0 = player.z - hw, z1 = player.z + hw;
  var bx, by, bz, bid, ox, oy, oz;

  for (bx = Math.floor(x0); bx <= Math.floor(x1); bx++) {
    for (by = Math.floor(y0); by <= Math.floor(y1); by++) {
      for (bz = Math.floor(z0); bz <= Math.floor(z1); bz++) {
        bid = getBlock(bx, by, bz);
        var _solid = !(bid === AIR || bid === WATER || _PLANT[bid]);
        if (!_solid && _furnitureSolid[bx + ',' + by + ',' + bz]) _solid = true;
        if (!_solid) continue;

        // 三轴穿透深度
        ox = Math.min(player.x + hw - bx,  bx + 1 - (player.x - hw));
        oy = Math.min(player.y + hh - by,  by + 1 - player.y);
        oz = Math.min(player.z + hw - bz,  bz + 1 - (player.z - hw));
        if (ox <= 0 || oy <= 0 || oz <= 0) continue;  // 实际未重叠

        // 沿穿透最小的轴推出
        if (oy < ox && oy < oz) {
          // Y 轴：落地或撞天花板
          if (player.y + hh / 2 < by + 0.5) {
            player.y -= oy;
            player.vy = Math.min(player.vy, 0);
          } else {
            player.y += oy;
            player.vy = Math.max(player.vy, 0);
            player.onGround = true;
          }
        } else if (ox < oz) {
          // X 轴
          player.x += (player.x < bx + 0.5) ? -ox : ox;
          player.vx = 0;
        } else {
          // Z 轴
          player.z += (player.z < bz + 0.5) ? -oz : oz;
          player.vz = 0;
        }
      }
    }
  }
}
