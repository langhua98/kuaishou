// ─── raycast.js ───────────────────────────────────────────────────────────────
// 步进式射线检测，用于挖方块和放方块的目标定位。
//
// 算法：从摄像机眼睛位置沿视线方向每 0.05 单位步进一次，
//   遇到第一个实心（非 AIR/WATER）方块时停止。
//
// 返回值：
//   { x, y, z }  — 被瞄准的方块坐标
//   { prev }     — 该方块前一步的位置（用于放置：新方块放在此处）
//   null         — 射程内无目标
//
// 视线方向由 player.yaw/pitch 决定（见 constants.js 约定）：
//   forward = (-sin(yaw)*cos(pitch),  sin(pitch),  -cos(yaw)*cos(pitch))

function raycast(maxD) {
  var cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  var dx = -Math.sin(player.yaw) * cp;
  var dy = sp;
  var dz = -Math.cos(player.yaw) * cp;

  // 射线起点：
  //   第一人称 = 玩家眼睛 (player.x/z, player.y+PH*0.85)
  //   第三人称 = 平滑相机枢轴 (_pivX/_pivY/_pivZ) + 右肩偏移 CAM_SHOULDER
  //   须用平滑枢轴而非 player.x/y/z，否则移动时枢轴滞后导致准星偏移。
  var ox, oy, oz;
  if (viewFP) {
    ox = player.x;
    oy = player.y + PH * 0.85;
    oz = player.z;
  } else {
    ox = _pivX + Math.cos(player.yaw) * CAM_SHOULDER;
    oy = _pivY;
    oz = _pivZ - Math.sin(player.yaw) * CAM_SHOULDER;
  }

  var prev = null, d, bx, by, bz, id;
  for (d = 0; d < maxD; d += 0.05) {
    bx = Math.floor(ox + dx * d);
    by = Math.floor(oy + dy * d);
    bz = Math.floor(oz + dz * d);
    id = getBlock(bx, by, bz);
    if (id !== AIR && id !== WATER) return { x: bx, y: by, z: bz, prev: prev };
    prev = { x: bx, y: by, z: bz };
  }
  return null;
}
