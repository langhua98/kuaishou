// ─── combat_data.js ───────────────────────────────────────────────────────────
// 战斗系统配置层（纯数据，无逻辑）。架构见 docs/battle-architecture.md。
// P1：步兵/弓手。骑兵（cavalry）配置预留，P2 启用。

// 兵种表：model = assets/models/army/<model>.glb
//   hp 血量 / dmg 伤害 / range 攻击距离 / spd 移速 / atkCd 攻击冷却秒 / ranged 远程
var UNIT_TYPES = {
  // 我方
  knight:    { model: 'Knight',           h: 1.80, hp: 14, dmg: 4, range: 1.9, spd: 4.2, atkCd: 1.1, ranged: false,
               wpnR: 'sword_1handed', wpnL: 'shield_round', name: '骑士' },
  barbarian: { model: 'Barbarian',        h: 1.85, hp: 16, dmg: 5, range: 2.0, spd: 4.0, atkCd: 1.3, ranged: false,
               wpnR: 'sword_1handed', wpnL: null,           name: '蛮兵' },
  ranger:    { model: 'Rogue',            h: 1.75, hp: 9,  dmg: 3, range: 13,  spd: 4.4, atkCd: 2.2, ranged: true,
               wpnR: 'crossbow_2handed', wpnL: null,        name: '游侠' },
  // 敌方（骷髅军）
  skel_war:  { model: 'Skeleton_Warrior', h: 1.75, hp: 12, dmg: 4, range: 1.9, spd: 3.8, atkCd: 1.2, ranged: false,
               wpnR: 'Skeleton_Blade', wpnL: 'Skeleton_Shield_Small_A', name: '骷髅战士' },
  skel_min:  { model: 'Skeleton_Minion',  h: 1.60, hp: 7,  dmg: 2, range: 1.7, spd: 4.2, atkCd: 1.0, ranged: false,
               wpnR: 'Skeleton_Blade', wpnL: null,          name: '骷髅杂兵' },
  skel_rog:  { model: 'Skeleton_Rogue',   h: 1.70, hp: 8,  dmg: 3, range: 12,  spd: 3.6, atkCd: 2.5, ranged: true,
               wpnR: 'Skeleton_Crossbow', wpnL: null,       name: '骷髅弩手' },
};

// 战斗调参（需求文档 §2 节流 + P1 步兵参数）
var BTL = {
  decideIv: 0.2,        // 决策更新间隔（秒）
  detectR: 28,          // 索敌半径
  followNear: 3,        // FOLLOW 距离带
  followFar: 9,
  rangedNear: 6,        // 弓手保持距离带
  rangedFar: 12,
  sepR: 1.2,            // 单位间分离半径
  meleeDmgDelay: 0.45,  // 挥砍动画起手到伤害判定的延迟
  arrowSpd: 22,         // 箭矢初速
  playerHp: 20,
  playerDmg: 4,         // 玩家挥剑伤害
  playerReach: 2.8,     // 玩家攻击距离
  maxEnemies: 12,       // 同屏敌人上限（性能预算）
  corpseT: 3,           // 尸体保留秒数
};

// 我方编制 / 敌方波次
var SQUAD = ['knight', 'knight', 'knight', 'barbarian', 'ranger', 'ranger'];
function waveComp(n) {     // 第 n 波（1 起）敌人构成
  var c = ['skel_war', 'skel_war', 'skel_min', 'skel_rog'];
  var extra = Math.min(n - 1, 4), i;
  for (i = 0; i < extra; i++) c.push(i % 2 ? 'skel_min' : 'skel_war');
  if (n >= 3) c.push('skel_rog');
  return c.slice(0, BTL.maxEnemies);
}

// 动画名（KayKit 全系角色通用）
var ANIM = {
  idle: 'Idle', walk: 'Walking_A', run: 'Running_A',
  atk1: '1H_Melee_Attack_Slice_Horizontal', atk2: '1H_Melee_Attack_Chop',
  aim: '2H_Ranged_Aiming', shoot: '2H_Ranged_Shoot',
  hit: 'Hit_A', death: 'Death_A', cheer: 'Cheer', block: 'Block',
};
