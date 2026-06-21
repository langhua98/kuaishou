/**
 * merge_anims.cjs
 * 把额外的 GLB 动画片段合并到 player.glb，输出新的 player.glb。
 * 用法：node merge_anims.cjs
 */
'use strict';
const { NodeIO, Document } = require('@gltf-transform/core');
const path = require('path');

const CLIPS = [
  { file: 'assets/models/sit_down.glb',     name: 'sit_down'     },
  { file: 'assets/models/sitting.glb',       name: 'sitting'      },
  { file: 'assets/models/firing_rifle.glb',  name: 'firing_rifle' },
];

async function main() {
  const io  = new NodeIO();
  const base = await io.read('assets/models/player.glb');
  const root = base.getRoot();

  // 已有动画名（避免重复）
  const existing = new Set(root.listAnimations().map(a => a.getName()));
  console.log('Base animations:', [...existing].join(', '));

  for (const { file, name } of CLIPS) {
    if (existing.has(name)) { console.log('Skip (exists):', name); continue; }

    const extra = await io.read(file);
    const anims = extra.getRoot().listAnimations();
    if (!anims.length) { console.warn('No animations in', file); continue; }

    // 只取第一段动画，重命名后合并进 base doc
    const srcAnim = anims[0];

    // gltf-transform Document.merge() / copy API: 用 Document copy 将 anim 迁移
    // 在 gltf-transform v4 中需要用 document.merge() 或手动 copyToDocument。
    // 最简单方式：用 io 序列化再反序列化合并后的 document（内存 merge）
    // 因为 v4 没有直接的 cross-document clone，我们用 JSON merge 方式：

    const extraJson = await io.writeJSON(extra);
    const baseJson  = await io.writeJSON(base);

    // 找到 extra 中第一个 animation 的 JSON 索引（总是 0）
    const extraAnim = extraJson.json.animations[0];
    if (!extraAnim) { console.warn('No anim JSON for', file); continue; }
    extraAnim.name = name;

    // 合并 accessor、bufferView、buffer 到 base
    const accOffset  = (baseJson.json.accessors  || []).length;
    const bvOffset   = (baseJson.json.bufferViews|| []).length;
    const nodeOffset = (baseJson.json.nodes      || []).length;

    // Base buffer：把 extra 的 buffer 数据追加到 base buffer
    const baseBuf  = baseJson.resources[baseJson.json.buffers[0].uri] || new Uint8Array(0);
    const extraBuf = extraJson.resources[extraJson.json.buffers[0]?.uri] || new Uint8Array(0);

    const merged = new Uint8Array(baseBuf.byteLength + extraBuf.byteLength);
    merged.set(baseBuf, 0);
    merged.set(extraBuf, baseBuf.byteLength);

    const mergedUri = baseJson.json.buffers[0].uri;
    baseJson.resources[mergedUri] = merged;
    baseJson.json.buffers[0].byteLength = merged.byteLength;

    // 修正 extra bufferViews 的 byteOffset 和 buffer 引用
    const extraBVs = (extraJson.json.bufferViews || []).map(bv => ({
      ...bv,
      buffer: 0,
      byteOffset: (bv.byteOffset || 0) + baseBuf.byteLength,
    }));
    baseJson.json.bufferViews = (baseJson.json.bufferViews || []).concat(extraBVs);

    // 修正 extra accessors 的 bufferView 引用
    const extraACs = (extraJson.json.accessors || []).map(ac => ({
      ...ac,
      bufferView: ac.bufferView != null ? ac.bufferView + bvOffset : undefined,
    }));
    baseJson.json.accessors = (baseJson.json.accessors || []).concat(extraACs);

    // 修正 animation samplers 引用的 accessor
    extraAnim.samplers = (extraAnim.samplers || []).map(s => ({
      input:  s.input  + accOffset,
      output: s.output + accOffset,
      interpolation: s.interpolation,
    }));

    // 查找 base 中对应骨骼节点（按名字）：extra channels 用 extra 的 node 索引
    // 我们需要把 extra node 名映射到 base node 索引
    const extraNodes = extraJson.json.nodes || [];
    const baseNodes  = baseJson.json.nodes  || [];
    const baseNodeByName = {};
    baseNodes.forEach((n, i) => { if (n.name) baseNodeByName[n.name] = i; });

    extraAnim.channels = (extraAnim.channels || []).map(ch => {
      const eName = extraNodes[ch.target?.node]?.name;
      const bIdx  = eName != null ? baseNodeByName[eName] : undefined;
      if (bIdx == null) return null;  // 找不到对应节点则跳过
      return {
        sampler: ch.sampler,
        target: { node: bIdx, path: ch.target.path },
      };
    }).filter(Boolean);

    if (!baseJson.json.animations) baseJson.json.animations = [];
    baseJson.json.animations.push(extraAnim);

    // 用修改后的 JSON 重新读入 base doc（覆盖）
    const rebased = await io.readJSON(baseJson);
    // 替换 base 的内容——直接覆盖引用
    Object.assign(base, rebased);
    // 因为 io.readJSON 返回新 Document，需重新获取 root
    const newAnims = base.getRoot().listAnimations().map(a => a.getName());
    console.log('After merge:', newAnims.join(', '));

    existing.add(name);
  }

  await io.write('assets/models/player.glb', base);
  console.log('Written player.glb with merged animations');
}

main().catch(e => { console.error(e); process.exit(1); });
