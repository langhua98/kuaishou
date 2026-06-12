# 军队战斗系统 — 模块架构 V1.0

配套《骑兵 AI 控制逻辑需求文档 V1.0》。本文档定义文件结构、数据结构、
状态机接口与现有引擎的对接点。**实现按阶段推进，骑兵 FSM 完整保留需求文档语义。**

---

## 0. 与需求文档的适配说明（必读）

| 需求文档概念 | 本引擎适配 | 原因 |
|---|---|---|
| 距离单位 m | 1 方块 = 1m，数值直接照抄 | 体素世界天然 1:1 |
| 长枪 Lance | V1 无长枪模型 → 冲锋伤害=「马匹冲撞」+ 挥剑 | KayKit 资源包无枪；武器切换系统保留接口，后续补模型即可 |
| Spearman/HeavySpearman 敌人 | V1 敌方为骷髅军（近战/轻步/弩手），枪兵权重表保留待用 | 现有敌方资源 |
| HorseHP | 马与骑手合并为一个单位的 hp（V1），字段预留 mountHp | 简化伤害结算 |
| ArmyMorale 士气 | V2 实现，触发条件先用 HP 与敌我比 | 控制 V1 范围 |
| 路径评分 | 不做 A*。射线采样 voxel 网格（getBlock 已 O(1)）+ 120° 扇形转向采样 | 手机性能；体素世界射线检测极廉价 |
| 调试输出 | URL 加 `?aidebug=1`，单位头顶显示状态文本 | 现有 sprite 血条同管线 |

资源已入库（`assets/models/army/`，全 CC0）：
骑士/蛮兵/游侠（我方）、骷髅战士/杂兵/弩手（敌方），各含 11 个战斗动画
（Idle/Walk/Run/横劈/劈砍/弩瞄准/弩射击/格挡/受击/死亡/欢呼）；
单手剑/圆盾/十字弩/箭/箭袋 + 骷髅武器；挥砍/金属/命中/弩 8 个音效。
坐骑复用现有 `assets/models/horse.glb`。

---

## 1. 文件结构

构建沿用 `inline.cjs` 平铺拼接，新增 6 个文件（顺序敏感，插在 models.js 之后、game.js 之前）：

```
src/combat_data.js    ① 配置层：兵种表/权重表/状态枚举/调参常量（纯数据，无逻辑）
src/combat_core.js    ② 单位层：单位池、骨骼网格克隆、动画切换、伤害结算、生死
src/combat_steer.js   ③ 转向层：120°扇形避障、到达转向、分离力（防互相堵塞）
src/combat_ai.js      ④ 决策层：步兵/弓手 FSM + 骑兵九状态 FSM + 目标评分
src/combat_cmd.js     ⑤ 指挥层：玩家命令（跟随/冲锋/驻守/撤退）+ 指挥 UI 按钮
src/combat_fx.js      ⑥ 表现层：箭矢抛物线、血条/调试 sprite、战斗音效、波次刷怪
```

依赖方向严格单向：⑥→⑤→④→③→②→①（上层只调下层，禁止反向引用）。
`game.js tick` 只调一个入口：`combatUpdate(dt, now)`。

---

## 2. 数据结构（ES5，与现有代码风格一致）

### 2.1 单位对象（对象池复用，禁止战斗中 new）

```js
var Unit = {
  id: 0,
  side: 0,            // 0=玩家方 1=敌方
  kind: 'knight',     // UNIT_TYPES 键
  // 运动
  x:0, y:0, z:0, yaw:0,
  vx:0, vz:0,         // 当前速度向量（骑兵动能核心字段）
  speed: 0,           // |v| 缓存，CHARGE 进出判定用
  // 战斗
  hp: 10, mountHp: 0, // mountHp 预留
  weapon: 'sword',    // sword|crossbow（切换冷却 weaponCd）
  atkCd: 0,           // 攻击冷却计时
  // FSM
  state: 'IDLE',      // 主状态（唯一）
  sub: null,          // 子状态 AvoidObstacle|WeaponSwitch|MountedCombat
  stateT: 0,          // 当前状态持续时间（MELEE 10s 上限等）
  target: null,       // 当前目标 Unit
  // 决策节流（需求文档 §2）
  nextDecide: 0,      // 0.2s 决策 tick
  nextScore: 0,       // 0.5s 评分 tick
  // 骑兵专用
  mounted: false,
  chargeFrom: null,   // POSITION 选定的冲锋起点 {x,z}
  breakDir: null,     // BREAKAWAY 撤离方向
  regroupT: 0,        // REGROUP 等待计时（15s 上限）
  // 渲染
  mesh: null, mixer: null, anims: {}, curAnim: '',
  hpBar: null, dbgTag: null,
};
```

### 2.2 兵种配置表（combat_data.js）

```js
var UNIT_TYPES = {
  // 我方
  knight:   { model:'Knight',           hp:14, dmg:4, range:1.8, spd:4.2, atkCd:1.1, ranged:false },
  barbarian:{ model:'Barbarian',        hp:16, dmg:5, range:2.0, spd:4.0, atkCd:1.3, ranged:false },
  ranger:   { model:'Rogue',            hp:9,  dmg:3, range:14,  spd:4.4, atkCd:2.2, ranged:true  },
  cavalry:  { model:'Knight', mount:'horse', hp:18, dmg:5, range:2.2,
              spd:8.5,        // > 冲锋阈值 7m/s（需求文档 §4.5）
              atkCd:1.0, ranged:false },
  // 敌方
  skel_war: { model:'Skeleton_Warrior', hp:12, dmg:4, range:1.8, spd:3.8, atkCd:1.2, ranged:false },
  skel_min: { model:'Skeleton_Minion',  hp:7,  dmg:2, range:1.6, spd:4.2, atkCd:1.0, ranged:false },
  skel_rog: { model:'Skeleton_Rogue',   hp:8,  dmg:3, range:13,  spd:3.6, atkCd:2.5, ranged:true  },
};
```

### 2.3 评分权重表（数值照抄需求文档 §4.3/§4.4）

```js
var SCORE_ENEMY   = { archer:90, commander:100, infantry:40, spearman:-80,
                      heavy_spearman:-120, cavalry:50 };
var SCORE_DIST    = [ [20,+20], [50,+10], [1e9,-20] ];      // 0~20 / 20~50 / 50+
var SCORE_FLANK   = { back:+50, side:+30, front:-30 };      // SCAN 选目标
var SCORE_CHG_ANG = { rear:+80, flank:+60, front:+10 };     // POSITION 冲锋角
var TERRAIN_RISK  = { open:+50, hill:-20, forest:-60, urban:-80 };
var OBST_W        = { tree:100, rock:80, wall:200, friendly:30 };  // §5 避障权重
var CAV = {        // 骑兵调参集中处（需求文档关键数值）
  chargeMinDist: 30, chargeGoodDist: 50,
  chargeSpdEnter: 7, chargeSpdFail: 3,
  meleeMaxT: 10, meleeCrowd: 4,
  breakDist: [40, 80], regroupMaxT: 15, regroupRatio: 0.5,
  retreatHp: 0.25, retreatMountHp: 0.20, retreatOutnum: 3,
  groupChargeN: 3, weaponSwapCd: 2,
  scanIv: 0.5, decideIv: 0.2,
};
```

### 2.4 状态枚举

```js
// 通用步兵/弓手（简化 FSM）
var ST_INF = ['IDLE','FOLLOW','SEEK','FIGHT','HOLD','DEAD'];
// 骑兵（需求文档 §3 九状态完整保留）
var ST_CAV = ['IDLE','FOLLOW','SCAN','POSITION','CHARGE','MELEE',
              'BREAKAWAY','REGROUP','RETREAT','DEAD'];
```

---

## 3. 各模块接口

### ① combat_data.js
纯配置，零函数。上面 2.2~2.4 全部内容。

### ② combat_core.js
```js
spawnUnit(kind, side, x, z) → Unit     // 从池取；骨骼网格用 cloneSkinned()
killUnit(u)                            // Death_A 动画 → 3s 后回池
damageUnit(u, dmg, from)               // 扣血、Hit_A、播命中音效、死亡判定
playAnim(u, name, fade)                // mixer crossFade 封装（去重：同名不重播）
cloneSkinned(gltfScene)                // SkeletonUtils.clone 精简版（共享几何体，克隆骨骼）
combatUnits[]                          // 全部活动单位（AI 层遍历）
```
**技术要点**：skinned mesh 不能 `mesh.clone()`，必须按骨骼重绑（three r147 无内置
SkeletonUtils，嵌 ~40 行实现）。武器 GLB 挂到手部骨骼
（KayKit 骨架含 `handslot.l/r` 空节点，`getObjectByName` 直接挂）。

### ③ combat_steer.js
```js
steer(u, tx, tz, dt)        // 朝目标转向+移动；内部叠加避障与分离力
avoidScan(u) → {dir, risk}  // §5：前方120°扇形5条射线、10m，OBST_W 加权
separation(u) → {fx, fz}    // 邻近友军排斥力（§8 防互堵）
terrainRisk(x, z) → number  // §4.3 地形风险：采样周边 voxel（树=forest，建筑方块=urban，坡度=hill）
```
射线即 `getBlock` 步进采样，每条 10 次查表，5 条/帧/单位，24 单位 ≈ 1200 次查表/帧，可忽略。

### ④ combat_ai.js
```js
combatUpdate(dt, now)       // 总入口：遍历 combatUnits，节流调度
aiInfantry(u, dt, now)      // 步兵/弓手简化 FSM
aiCavalry(u, dt, now)       // 骑兵九状态 FSM（§4 全部语义）
scoreTarget(u, enemy)       // §4.3 公式：EnemyValue+SuccessRate+Tactical-Terrain-Danger
pickChargePath(u, tgt)      // §4.4：30m 最短/50m 推荐、路径障碍检查、角度评分
groupCharge(u)              // §7：附近友骑≥3 时统一目标与方向
```
节流（§2）：决策 0.2s、评分 0.5s、避障每帧——`nextDecide/nextScore` 时间戳实现。
**禁止行为（§8）由机制保证**而非补丁：MELEE 计时强制 BREAKAWAY（不无限缠斗）、
BREAKAWAY 选敌最少方向（不停敌阵中心）、枪兵权重 -80/-120（不硬冲枪阵）、
RETREAT 触发表（不低血送死）、分离力（不互堵）。

### ⑤ combat_cmd.js
```js
cmdSetOrder(order)          // 'follow'|'charge'|'hold'|'retreat' → 广播我方单位
buildCmdUI()                // 右侧四按钮（移动端大触区），当前命令高亮
```
命令到状态映射：follow→FOLLOW(8~20m 距离带)、charge→SCAN（骑兵）/SEEK（步兵）、
hold→HOLD 原地驻守、retreat→RETREAT。

### ⑥ combat_fx.js
```js
shootArrow(from, to, dmg, side)  // 抛物线箭矢（复用 arrow.glb，池化 8 支）
updateArrows(dt)
makeHpBar(u) / updateHpBar(u)    // 头顶 sprite 血条（canvas 纹理）
makeDbgTag(u)                    // ?aidebug=1：State/Target/Score/Speed/ChargeAngle/BreakReason（§9）
battleSfx(name)                  // atk_swing/clang/hit/bow → 现有 _playSfx 管线
spawnWave(n)                     // 敌方波次：与昼夜联动——夜晚骷髅军来袭，黎明欢呼(Cheer)
```

---

## 4. 实施阶段（每阶段独立可玩、独立提交）

| 阶段 | 内容 | 量级 |
|---|---|---|
| **P1 步战核心** | ②③⑥基础 + 步兵/弓手 FSM + 指挥按钮 + 血条 + 玩家挥剑伤害接入现有挖掘键 + 夜袭波次 | ~800 行 |
| **P2 骑兵 FSM** | 马+骑手组装、九状态完整实现、目标评分、冲锋路径、群体冲锋、调试面板 | ~600 行 |
| **P3 打磨** | 士气系统、武器切换（补长枪模型）、阵型保持、战场清扫优化 | 按需 |

性能预算：同屏 ≤ 24 个骨骼动画单位（12v12，KayKit 低面数 ~3k 三角形/个），
中端手机实测预期 ≥ 45fps；超预算时弓手降为静态姿态合批。

---

## 5. 风险与决策点

1. **骑兵在 P2 才出现**——P1 先用步兵把战斗管线跑通，骑兵 FSM 才有可靠地基。
2. **马+骑手为刚性组合**（骑手挂在马的 spine 节点上），不做上下马（V1）。
3. **长枪（Lance）模型缺失**——冲锋伤害走马匹冲撞通道，公式与枪刺一致，后续换皮。
4. **敌方骑兵**——V1 不做（骷髅无马），权重表已留 cavalry 条目。
```
