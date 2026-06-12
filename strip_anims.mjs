// 裁剪 KayKit 角色：动画 75→11 + 清除孤儿数据 + 焊接量化，输出 assets/models/army/
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample, weld, quantize } from '@gltf-transform/functions';
import fs from 'fs';

const KEEP = new Set([
  'Idle', 'Walking_A', 'Running_A',
  '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop',
  '2H_Ranged_Shoot', '2H_Ranged_Aiming',
  'Hit_A', 'Death_A', 'Block', 'Cheer',
]);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync('/home/user/kuaishou/assets/models/army', { recursive: true });

for (const name of ['Knight','Barbarian','Rogue','Skeleton_Warrior','Skeleton_Minion','Skeleton_Rogue']) {
  const doc = await io.read(`/tmp/kaykit_glb/${name}.glb`);
  const root = doc.getRoot();
  for (const anim of root.listAnimations()) {
    if (KEEP.has(anim.getName())) continue;
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
  }
  // 手动清孤儿 accessor：只保留 mesh/skin/保留动画 引用的
  const used = new Set();
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    for (const a of p.listAttributes()) used.add(a);
    if (p.getIndices()) used.add(p.getIndices());
    for (const t of p.listTargets()) for (const a of t.listAttributes()) used.add(a);
  }
  for (const an of root.listAnimations()) for (const s of an.listSamplers()) {
    used.add(s.getInput()); used.add(s.getOutput());
  }
  for (const sk of root.listSkins()) { const i = sk.getInverseBindMatrices(); if (i) used.add(i); }
  for (const a of root.listAccessors()) if (!used.has(a)) a.dispose();

  await doc.transform(resample(), weld(), quantize(), prune());
  const out = `/home/user/kuaishou/assets/models/army/${name}.glb`;
  await io.write(out, doc);
  console.log(`${name}: ${(fs.statSync(out).size/1024).toFixed(0)} KB`);
}
