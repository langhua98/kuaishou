/**
 * extract_arms.cjs
 * 从 player.glb 中提取手臂部分，生成 assets/models/player_arms.glb。
 * 按骨骼权重过滤：顶点对手臂骨的总权重 > 0.3 则保留，
 * 三角形三个顶点全部保留才保留该三角形。
 *
 * 用法：node extract_arms.cjs
 */

'use strict';
const { NodeIO }   = require('@gltf-transform/core');
const { prune }    = require('@gltf-transform/functions');
const path         = require('path');

// ── 手臂骨骼索引（只保留前臂+手，去掉肩/上臂，防躯干漏入）────────────────
// LeftArm(12) LeftForeArm(13) LeftHand(14) + 左手指(15-34)
// RightArm(36) RightForeArm(37) RightHand(38) + 右手指(39-58)
// 不含 Shoulder(11/35)，避免肩部权重渗入躯干几何体
const ARM_BONES = new Set([
  12, 13, 14,
  15,16,17,18,19,20,21,22,23,24,
  25,26,27,28,29,30,31,32,33,34,
  36, 37, 38,
  39,40,41,42,43,44,45,46,47,48,
  49,50,51,52,53,54,55,56,57,58
]);

// 阈值 0.5：顶点手臂权重总和 > 50% 才保留，严格排除躯干过渡区
const WEIGHT_THRESHOLD = 0.5;

async function main() {
  const io  = new NodeIO();
  const doc = await io.read('assets/models/player.glb');

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const joints0  = prim.getAttribute('JOINTS_0');
      const weights0 = prim.getAttribute('WEIGHTS_0');
      const idxAcc   = prim.getIndices();
      if (!joints0 || !weights0 || !idxAcc) continue;

      const jArr = joints0.getArray();   // Uint16 / Uint8,  4 per vertex
      const wArr = weights0.getArray();  // Float32,         4 per vertex
      const iArr = idxAcc.getArray();    // Uint16 / Uint32

      const vertCount = joints0.getCount();

      // ── 1. 标记手臂顶点 ─────────────────────────────────────────────────
      const keepV = new Uint8Array(vertCount);
      for (let v = 0; v < vertCount; v++) {
        let armW = 0;
        for (let b = 0; b < 4; b++) {
          if (ARM_BONES.has(jArr[v * 4 + b])) armW += wArr[v * 4 + b];
        }
        if (armW >= WEIGHT_THRESHOLD) keepV[v] = 1;
      }

      // ── 2. 过滤三角形（三个顶点都保留才保留该面）────────────────────────
      const triCount  = iArr.length / 3;
      const newIList  = [];
      for (let t = 0; t < triCount; t++) {
        const i0 = iArr[t * 3], i1 = iArr[t * 3 + 1], i2 = iArr[t * 3 + 2];
        if (keepV[i0] && keepV[i1] && keepV[i2]) {
          newIList.push(i0, i1, i2);
        }
      }

      if (newIList.length === 0) {
        // 没有手臂三角形 → 删掉整个 primitive 内容（设为空索引）
        idxAcc.setArray(new Uint32Array(0));
        continue;
      }

      // ── 3. 紧凑化：只保留被引用的顶点 ──────────────────────────────────
      const usedSet   = new Set(newIList);
      const oldToNew  = new Int32Array(vertCount).fill(-1);
      let   newIdx    = 0;
      for (const v of usedSet) oldToNew[v] = newIdx++;

      // 更新索引数组
      const newIArr = new Uint32Array(newIList.length);
      for (let i = 0; i < newIList.length; i++) newIArr[i] = oldToNew[newIList[i]];
      idxAcc.setArray(newIArr);

      // ── 4. 紧凑化各属性 ──────────────────────────────────────────────────
      const attrNames = prim.listSemantics();
      for (const sem of attrNames) {
        const acc = prim.getAttribute(sem);
        if (!acc) continue;
        const old   = acc.getArray();
        const elSz  = acc.getElementSize();
        const newA  = new old.constructor(newIdx * elSz);
        for (let v = 0; v < vertCount; v++) {
          if (oldToNew[v] < 0) continue;
          const src = v * elSz, dst = oldToNew[v] * elSz;
          for (let k = 0; k < elSz; k++) newA[dst + k] = old[src + k];
        }
        acc.setArray(newA);
      }

      console.log('Primitive: kept', newIdx, '/', vertCount, 'vertices,',
                  newIList.length / 3, '/', triCount, 'triangles');
    }
  }

  // ── 5. 删除头部网格节点（Soldier_head 无 JOINTS 属性，脚本未过滤）─────
  for (const node of doc.getRoot().listNodes()) {
    if (node.getName() === 'Soldier_head') {
      node.setMesh(null);
      console.log('Removed head mesh from node:', node.getName());
    }
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    if (mesh.getName() === 'Soldier_head') {
      mesh.dispose();
      console.log('Disposed mesh:', 'Soldier_head');
    }
  }

  // ── 6. 删除空 primitive 及无用数据 ──────────────────────────────────────
  await doc.transform(prune());

  await io.write('assets/models/player_arms.glb', doc);
  console.log('Written: assets/models/player_arms.glb');
}

main().catch(e => { console.error(e); process.exit(1); });
