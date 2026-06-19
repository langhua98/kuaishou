#!/usr/bin/env node
// download-textures.cjs — 从 PixiGeko/Minecraft-default-assets 下载 MC vanilla 16×16 贴图
// 用法: node download-textures.cjs
// 结果: 覆盖 assets/textures/block/*.png（404 时跳过，保留原文件）

var https = require('https');
var fs    = require('fs');
var path  = require('path');

var BASE = 'https://raw.githubusercontent.com/PixiGeko/Minecraft-default-assets/latest/assets/minecraft/textures/block/';
var DEST = path.join(__dirname, 'assets/textures/block');

// 与 src/textures.js _TILES 一一对应的文件名（自制方块名会 404 自动跳过）
var TILES = [
  'grass_block_top', 'grass_block_side', 'dirt', 'stone', 'sand',
  'oak_log_top', 'oak_log', 'oak_leaves', 'water_still', 'bricks',
  'gold_roof', 'white_stone', 'gray_brick', 'gray_roof', 'red_pillar',
  'oak_planks', 'cobblestone', 'mud_bricks', 'white_stone',
  'ice', 'snow', 'iron_ore', 'glass', 'obsidian', 'gravel', 'red_sand',
  'tnt_top', 'tnt_side', 'tnt_bottom', 'pumpkin_top', 'pumpkin_side', 'coal_ore',
  'bedrock', 'birch_log', 'birch_leaves', 'spruce_log', 'spruce_leaves',
  'blue_wool', 'green_wool', 'red_wool', 'white_wool', 'yellow_wool',
  'bookshelf', 'carved_pumpkin', 'crafting_table_top', 'crafting_table_side',
  'diamond_ore', 'emerald_ore', 'gold_ore', 'redstone_ore',
  'furnace_top', 'furnace_side', 'lava_still', 'melon_top', 'melon_side',
  'mossy_cobblestone', 'dandelion', 'poppy', 'oak_sapling', 'fern',
  'packed_ice', 'sandstone_top'
];

// 同名去重（白石和领地石都用 white_stone，只下载一次）
var seen = {};
var unique = TILES.filter(function(n) { if (seen[n]) return false; seen[n] = true; return true; });

function download(name) {
  return new Promise(function(resolve) {
    var url  = BASE + name + '.png';
    var dest = path.join(DEST, name + '.png');
    var tmp  = dest + '.tmp';
    var file = fs.createWriteStream(tmp);
    https.get(url, function(res) {
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        fs.unlink(tmp, function(){});
        resolve({ name: name, ok: false, status: res.statusCode });
        return;
      }
      res.pipe(file);
      file.on('finish', function() {
        file.close();
        fs.rename(tmp, dest, function(err) {
          resolve({ name: name, ok: !err, status: err ? err.message : undefined });
        });
      });
    }).on('error', function(err) {
      file.close();
      fs.unlink(tmp, function(){});
      resolve({ name: name, ok: false, status: err.message });
    });
  });
}

(async function() {
  console.log('正在从 PixiGeko/Minecraft-default-assets 下载 ' + unique.length + ' 个贴图...\n');
  var ok = 0, fail = 0, failList = [];
  for (var i = 0; i < unique.length; i++) {
    var r = await download(unique[i]);
    if (r.ok) {
      ok++;
      process.stdout.write('.');
    } else {
      fail++;
      failList.push(unique[i] + '(' + r.status + ')');
      process.stdout.write('x');
    }
  }
  console.log('\n\n完成：成功 ' + ok + ' / 失败 ' + fail);
  if (failList.length) console.log('失败（自制方块或名称不同，保留原图）：\n  ' + failList.join('\n  '));
  console.log('\n接下来运行: node inline.cjs');
})();
