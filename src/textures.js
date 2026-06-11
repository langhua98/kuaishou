// ─── textures.js ──────────────────────────────────────────────────────────────
// 方块贴图集：Minetest 开源贴图（CC BY-SA 3.0，https://minetest.net）
// 9 张 16×16 PNG 在构建时 base64 嵌入，组装为 64×48 texture atlas。
// 零运行时网络请求，完全内置。水贴图为 16×256 动画，仅取第一帧（16×16）。
//
// 贴图格布局（ATLAS_COLS=4, ATLAS_ROWS=3）：
//   [0] grass_top  [1] grass_side  [2] dirt      [3] stone
//   [4] sand       [5] wood_top    [6] wood_side  [7] leaves
//   [8] water
//
// BTEX[blockId] = [top格, side格, bot格]
// loadTextures(callback) — 异步加载完成后设置 atlasTexture 并回调

var ATLAS_COLS = 4, ATLAS_ROWS = 3, TILE = 16;

var BTEX = [
  null,        // AIR
  [0, 1, 2],   // GRASS
  [2, 2, 2],   // DIRT
  [3, 3, 3],   // STONE
  [4, 4, 4],   // SAND
  [5, 6, 5],   // WOOD
  [7, 7, 7],   // LEAVES
  [8, 8, 8],   // WATER
];

var atlasTexture = null;

var _TX_GRASS_TOP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAArlBMVEU4YhY5Yxc5ZBY6ZBg6ZRc7Yxc7ZBY7Zhg7Zxc8ZRc8aBg9Zhg9aRk9ahg+aBg+aRc+axk+cBo/ahg/cBhAaxlAbBhAbhhAbhpAcRlAcxtBbRlBbxlBcBhBcRtBdBxBdRtCcBpCcRlCcxtCdBpCdhxDdBxDdRtDeBxEdR1EdhxEdxtEeBpFdx1FeBxGeB5GeR1HeR9IeiBIex9IfB5JeR9Jeh5JfCBKex9KfB5KfSE8mWaKAAAA2klEQVQYGQXBgUKCMBQF0IdNkRcSEYzkVmM6RiOnhbTR//9Y59AtiszVTJtXraomZRrCJcQyh7FaY0NMXe7uE/RiM2inBMidDhl6bKn9hBmNprIgXoMTBTPq0Wu6pvwdfOmWKoEObU/JDxfTm5zjNMiXr5iQk9KaJ4l8r7Jn2W1pBbrB3sCsdsR5JMVxEckBp1o2aVp6yj58TJgb9EBZ/3qySoALEjG0rurnQFLsGhzF2Q/VOEiA4EwFKZXtzPGackfZ7M+cA5wWl/j4sBJKu+c63pP3uWmk+fsHOJAawOkrkdAAAAAASUVORK5CYII=';
var _TX_GRASS_SIDE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABlElEQVQ4y8WSaVLCQBCF5xQQdo4ha0IICBxD3FBBLEACUuXR2/46CUSL/6aqazK9vH79etz4UJPZV0PaD0XpqkWfVQleS9J99uTmriCt+4IEHyUJ1Qa7ivgvngRvnnQePctxw21VpqemjPY1OwHrK0BvoQXvWqiAQy0MMxD1AQq4AQyWSTKdJ6e6RPtKUqjJ00PDimGW+ciDSTv1ORzhpiI9pXZOXJft7MyL1ilYlSXa1S6M4qqdADro9tN5oTRTFowCMF2IdVMDAH0AGMUpwDiunwW5VcqmhwYBBoQxEK41v4xBDqxg6ghMjk0DoJtpsFalV55MVFBExYfY+HyNRXHZ/NSaBgQwU1vv/UXR7nRE4M5T0YRDo752tdgy0cgxM4lm6qQTQLwPfOf51dfJrQ9gWDhDRjy9MC/CQY2t2My6IYQzlukDwtAIrZytbpuo6pz7pjjrSkF+rcQpBHB6rCc10CVAZ85MTKhmvkx1/tmIqZ/6HdT04mdmu94koOG2/CuGoVE+16WX/Of/MXclfu3/n74fXkNcmB6lnnIAAAAASUVORK5CYII=';
var _TX_DIRT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAMFBMVEVGKApUNBZWNxtYNxpZOiBaPiZdPyZfQipkRSpmSTBqSzFsTjVwUjhoVEZ8XEGDalgE/1C/AAAAm0lEQVQI1wGQAG//AMpWvFyBa9arAFOItVV7w3dsAE6XO3O+Y3AnAEQVRnZ6p5xiAGFpB7l2w5t3AIX3jKk3V2cMAH2YN3bHOxVqAFEmNwJ1lDx3AJUyecb1Io63AGoeObd9JZJnAIVXeHV3e0UXAGUi+oZ3V4Z+AGB112cwZntrAHd2N8kxl8ehAJGTjsHJR7uRAOi4M3i1GP1medU7vGNW+SwAAAAASUVORK5CYII=';
var _TX_STONE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAIVBMVEVhXl1WVFNvbGtiX15gXFtua2pVUlFOS0p8eHdQTUxoZGOCDXQRAAAAgklEQVQIHQXBMRKCMBBA0Z/AAbIjhXaaNJaB9QAOs1BTSO9YQE1Fn8qWQ3hP36PSh41mELufzXMf2aWxYXLCluvl7eSCSPMCQHPd30s90UrzlH15E7OP3zJX5HHdDwYPhgMRbN2CjynxiancRAW6mLxqJslJ5VyudImkGuAIVK0E9wf3zRbTcwUITAAAAABJRU5ErkJggg==';
var _TX_SAND = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAJFBMVEXY0aHd1qXa06PWz5/TzZzg2ajNx5bHwZDAuonPyZi9t4XJw5J1PvJNAAAAlElEQVQI1wXBMQuCQBgG4LfzQNzuE25X02a1Kxo14aS2Q675oKhokoYGxxpqrh/RXL/Q5wE7QN3KKkDaNDHf7Ct8wmz3JiawllltU+vAKJReoZaIMtHyeVSjkv4fJARgTjHZjgPTO0k765FsC2O6ZwnvGiI5FwJfao/6Rz5y7SYUBwPAIklqeIApvUhffQ6sHL84Vo4pFRpLCRofAQAAAABJRU5ErkJggg==';
var _TX_WOOD_TOP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABVlBMVEU5Lh9DNCM/MyMzKh3q0JzpyovjunnWoGLUnmBLOyczKx3w3rfs0Z7pzZbmxpPlwormxoXmwYPjwILfuX/kwH3euHnht3fetXbcsXXdtHPbsHPZqGjYo2XYomHRml9vQi5PNyXy4Lrt0ZXr0pTt0pHrz4/qzIzkvYTju4Dgu3vetnTYqXLfs3HZrnDWp2/crmvYpmfTomfQlFTNjFOtelGreEumcUuWbEiUZUWca0ObZECGWTyEVTl2TzdmQC04Lh736r3v2a/u2az03aDy2ZzozJzw0JLlxY3kxYjhvofnw4Xdt3vbtnvWr3jjvHfdsG/jr2vNnmfVmmXFkmHPk123h1nAilbKjVKielKkdVLGgU6bcE3Hf0Wlb0ONZEOFWz+QWjp8UjiEUDaCTzaJTTVjSjOBRzNNPS1lPClJNyVGOiRSMSI9MCE7Kx8sIBgrHxclHhcbFhPR7MKzAAAA9klEQVQYGQXB04IDQRQFwHO7x8FkYk9s28natm3//8tW4R2MgQNEBM6hgt28PAy6R612bzKJfX8BbLyfdmy7RUdmeXG29Qmw55Q74guEQyVvzrrwBLDHpKwLgm3eEo/nEl0CM9Oys2zLrtj1uWzimkCm2CzXlywWwSUYqSHARu7QasVetOtBq5TpANN7/7En6K/sbYasJfEUmL5KsjPqc625irYdxxlB+5Ci+UY1fHjuFyPrFwTN9DYCBZ83UJA8eaPHof3uVmuXJ1FFadaM5B0Bf6OIotTlcHDD4zyIAfh5G98O2q3OVb8/VGOACo0IHETEOaD+Axe4I2yoTQ96AAAAAElFTkSuQmCC';
var _TX_WOOD_SIDE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAQlBMVEUlGhA2Kh40KBwnHBMwJBlKPC1BMyVRQzM7LyI6LSEuIRgrHxVJOis+MiQ4LSBOPS9GOCpENygyJxxBNiYiFw4rHRRm8zmNAAAAqklEQVQYGQXBhQHAMAwDMIfLvP9fnQR8lPdsQZZWy7kCWsh3C4SbcRKAlKjvgM3VmT5gcKbU4/PmiVkA6qROlo/RGEUA9aOt3nW8LK0C8EJphYKtXikCjPSqZQ5ufPEJ0EuB9bRr+GARoL8M48mIdm4R4FZT00CNRIsFOETeObSuxMmBh12Gl5lS3n6G4L1cNem8XWdWEjw5pI3nmGybSYDv5N585jXWHlR/IpEIPoIsCgwAAAAASUVORK5CYII=';
var _TX_LEAVES = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABhklEQVR4AT3SBY5kMQwE0NxhppmZSbDMJFxmuP81snlWZyRF8bfLVWXnp+mjcRrfH+T2upmXT6a5xGm8Gebevp2H637cNQe3eDnLzcGtOznp0a9lfvFvG8XutC0JHISDSw846nK+EbTHTX0Ra4jm88cJArGTxNcDjECsWRz1+98KAduSiNzUNA0WoZ6KkxgRrj/vVmxyc1ntAptX7CTN9lMaU7GugaK9BAGyGIGdzbs5QKhoevJ3Ve0azc1JEAyWvayuTz0BlA9zRgJZOYAa1MSJsiU6ahzCBtjcVBCVmGVOgIMAkGWu6s7gLNec2IARKISC+dxXUgQ2zyUCuXDoGbFisyBqjiUChCtEpcaZ10GsHlgA6pi9P+uWVNXS+cO2LjMINavXv1UQb31VRwAczWIz2wUiBJyoGUmPd5YwClt1OazGt+fjjHVNddluwhrZpeoAW5BcPfU14ptL9sUcYbmbEZg6RTGw9xYjgPET1X0RN6eEhQAZQY5dc8vHmAjkSiynOcT+A7LZFiNTpzO9AAAAAElFTkSuQmCC';
var _TX_WATER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAEACAMAAACNjAZ8AAAB/lBMVEUadN4add4adtcadtkadtoadt8aduMad9kad9oad9sad9wad98ad+AaeNYaeNkaeNoaeNsaeN4aeOAaeOEaedQaedUaedcaedkaedsaedwaed0aed8aeeAaeeEaetUaetkaetoaetwaet0aet8aeuAaeuEaeuIae9Yae9kae9oae9sae9wae90ae94ae98ae+EafNkafNoafNsafNwafN0afN4afOEafOIafOMafdcafdkafdoafdsafdwafd0afd4afd8aftkaftoaftsaftwaft0aft4aft8afuAafuEafuIaf9gaf9kaf9oaf9saf9waf90af94af98af+Aaf+Eaf+IagNcagNkagNoagNsagNwagN0agN4agN8agOAagOEagOIagOMagdkagdoagdsagdwagd0agd4agd8ageAageEageIagtoagtsagtwagt0agt4agt8aguAaguEaguMag9wag90ag94ag98ag+Aag+Eag+IahNsahNwahN0ahN8ahOAahOEahOIahOQahdkahdoahd0ahd4ahd8aheAaheEaheIahtkahtoahtsahtwaht0aht4aht8ahuAahuEahuIahuMah9kah9sah94ah+Aah+Iah+Mah+Qah+UaiNsaiN0aiN4aiN8aiOEaiOIaidwaieAaiuAaiuEajN6rcwxgAAAAqnRSTlPMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzG/kJ2oAAAM5SURBVFjD7dcJVxJRHAXwZ6u2SGa2mKVmplZa5pIbCBqLGwxIpiySyMyUFsyAOIglZoUNVhpE5W4uLd+yYRl4M8mRczwdyeNX+J3/fe9esKBXicve4MvqUwPl1ZX9BPDit8Q6QflqY1lFtvjSMTMgmohSab2KtmF5NfktinWQU1V0NVO+qP7lsPbrNEs2gDWm36xwBSSj5NyED/mIghHCUyDeUh86fnoStYyPrgPp183RoK5VcOGOUGL3yrWgBDN9cbYMVx3tuZ81Mek4DzIKm6mgTHRXeyRnUEQTuSBTfuIK9hnpuF158b1yzFED8JraZ85poyJbn1asChpLQceja9fLTT+Iwzf6DC7a2g4kl5vPIE88lAufebm45sRBZzNpc7Thbp8bd/Ui9AvgsTto23efr4sqzC9+qEGBJUAqx1Hc//htey0oeFoHtvdAgijG8bDM01tYd9xD5abULsdcxKOR8TCuYBIliUY82kSsh53x0OnBlJmEPMZnQO+7ZdhDCTIMZEp4GCiKhDyEMY/YffhtRCmxpmI8QvdxFgNdVUW9TnnUI0tGMx5Sj9FVCXkQnhlxTy7kwdzHUD7swb0P5bb3oZ0dEuzgYVyhRIk8qhkPWUvEQ6gpQehWxkNBhj2QsMc04/HJC3kMJ/RY5dxH3CNyH1EPNi8Y68HkxRPKi4f1mETnFDomL+a4x4Y1lJd7SeRl1x7n+B5Svof3L48COC/2DdBQDXmoX5uBFPawTWFcD5+sKaU8KE5eSCYvI/OsB5OXAJMXp4b1QIHXwOSlYU897N6TfA8T3+MB30PL96iIvx9CU8ijk/VAFzb9kMcS40HkQR5CvsfAnnpYN6xcD81vMddjguzmesx+k8EelNg0rYY9gh9e/dTAHri0z33gceCRMh7R/hHzSNcH97WHwMj1kFqi/TTuEe2nrAfTx6yjsMfY8/3sUc/ziPX1sEeon7oCUY/BcF/Xs319TsHt69bIf4sl4cH2U56Hnu9h4nv4+R7dSXsk2C9Gbh/beb/EPKL7RZ/0fkklj7p954FwPJr5HnaeR2i//PceaVyPUD+FPCL91M3fcyW72bf/3oPYjcfu9y2SwOMP3y9n5BLqPCMAAAAASUVORK5CYII=';

// 按顺序对应贴图格 0-8
var _TX_LIST = [
  _TX_GRASS_TOP, _TX_GRASS_SIDE, _TX_DIRT, _TX_STONE,
  _TX_SAND, _TX_WOOD_TOP, _TX_WOOD_SIDE, _TX_LEAVES,
  _TX_WATER
];

// 加载所有贴图、组装 atlas canvas，完成后调用 onReady()
// 由 game.js bootNext 在渲染器就绪后调用
//
// 透明像素处理（修复方块接缝穿模）：
//   Minetest 的 grass_side 是"叠加层"设计（仅顶部绿条不透明，需叠在泥土上），
//   leaves 也含透明孔隙。直接用 + alphaTest 会让侧面出现透视洞。
//   → 组装时先铺底图：grass_side 底=dirt，leaves 底=深绿色，全部变为不透明。
function loadTextures(onReady) {
  var W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');

  var imgs = [], total = _TX_LIST.length, done = 0;

  function allLoaded() {
    // 全部图片就绪后按依赖顺序合成（dirt 必须先于 grass_side 画好）
    var i, col, row;
    for (i = 0; i < total; i++) {
      col = (i % ATLAS_COLS) * TILE;
      row = ((i / ATLAS_COLS) | 0) * TILE;

      if (i === 1 && imgs[2]) {
        // grass_side：先铺 dirt 底，再叠加绿条层
        ctx.drawImage(imgs[2], 0, 0, TILE, TILE, col, row, TILE, TILE);
      } else if (i === 7) {
        // leaves：先铺深绿底，填掉透明孔隙
        ctx.fillStyle = '#1e3d14';
        ctx.fillRect(col, row, TILE, TILE);
      }

      if (imgs[i]) {
        // 取左上角 16×16（水为 16×256 动画图，取首帧）
        ctx.drawImage(imgs[i], 0, 0, TILE, TILE, col, row, TILE, TILE);
      } else {
        // 加载失败：洋红占位
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(col, row, TILE, TILE);
      }
    }

    atlasTexture = new THREE.CanvasTexture(cv);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.needsUpdate = true;
    onReady();
  }

  _TX_LIST.forEach(function (url, i) {
    var img = new Image();
    img.onload  = function () { imgs[i] = img;  if (++done === total) allLoaded(); };
    img.onerror = function () { imgs[i] = null; if (++done === total) allLoaded(); };
    img.src = url;
  });
}
