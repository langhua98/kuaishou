// ─── noise.js ─────────────────────────────────────────────────────────────────
// 纯 ES5 实现的 2D Perlin 噪声，无外部依赖。
// 算法：随机置换表 + 梯度向量插值（Ken Perlin 改进版）。
// 仅供地形高度采样，输出范围约 [-1, 1]。

// 512 个随机置换值（前 256 随机打乱后镜像复制，避免越界取模）
var _perm = new Uint8Array(512);
(function () {
  var i, j, t;
  for (i = 0; i < 256; i++) _perm[i] = i;
  // Fisher–Yates shuffle
  for (i = 255; i > 0; i--) {
    j = Math.floor(Math.random() * (i + 1));
    t = _perm[i]; _perm[i] = _perm[j]; _perm[j] = t;
  }
  for (i = 0; i < 256; i++) _perm[i + 256] = _perm[i];
}());

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); } // 平滑曲线
function _lerp(a, b, t) { return a + t * (b - a); }
function _grad(h, x, z) {                                           // 2D 梯度
  switch (h & 3) {
    case 0: return  x + z;
    case 1: return -x + z;
    case 2: return  x - z;
    default: return -x - z;
  }
}

// 采样 (x, z) 处的噪声值，返回 [-1, 1] 近似范围内的浮点数
function noise2D(x, z) {
  var ix = Math.floor(x) & 255, iz = Math.floor(z) & 255;
  var fx = x - Math.floor(x),   fz = z - Math.floor(z);
  var ux = _fade(fx), uz = _fade(fz);
  var aa = _perm[_perm[ix]   + iz],     ab = _perm[_perm[ix]   + iz + 1];
  var ba = _perm[_perm[ix+1] + iz],     bb = _perm[_perm[ix+1] + iz + 1];
  return _lerp(
    _lerp(_grad(aa, fx,   fz),   _grad(ba, fx-1, fz),   ux),
    _lerp(_grad(ab, fx, fz-1), _grad(bb, fx-1, fz-1), ux),
    uz
  );
}
