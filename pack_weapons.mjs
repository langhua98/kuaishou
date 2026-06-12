import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, weld, quantize } from '@gltf-transform/functions';
import fs from 'fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const FILES = ['sword_1handed','shield_round','crossbow_2handed','arrow','quiver',
               'Skeleton_Blade','Skeleton_Crossbow','Skeleton_Shield_Small_A','Skeleton_Arrow'];
fs.mkdirSync('/home/user/kuaishou/assets/models/army', { recursive: true });
for (const f of FILES) {
  const doc = await io.read(`/tmp/kaykit_wpn/${f}.gltf`);
  await doc.transform(weld(), quantize(), prune());
  const out = `/home/user/kuaishou/assets/models/army/${f}.glb`;
  await io.write(out, doc);
  console.log(f, (fs.statSync(out).size/1024).toFixed(1)+'KB');
}
