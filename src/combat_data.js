// ─── combat_data.js ───────────────────────────────────────────────────────────
// 战斗系统配置层（纯数据，无逻辑）。架构见 docs/battle-architecture.md。
// P1：步兵/弓手。骑兵（cavalry）配置预留，P2 启用。

// 兵种表：model = assets/models/army/<model>.glb
//   hp 血量 / dmg 伤害 / range 攻击距离 / spd 移速 / atkCd 攻击冷却秒 / ranged 远程
var UNIT_TYPES = {
  // 我方
  knight:    { model: 'Knight',           h: 1.80, hp: 28, dmg: 3, range: 1.9, spd: 4.2, atkCd: 1.1, ranged: false,
               wpnR: 'sword_1handed', wpnL: 'shield_round', shield: true, name: '骑士' },
  barbarian: { model: 'Barbarian',        h: 1.85, hp: 32, dmg: 4, range: 2.0, spd: 4.0, atkCd: 1.3, ranged: false,
               wpnR: 'sword_1handed', wpnL: null,           name: '蛮兵' },
  ranger:    { model: 'Rogue',            h: 1.75, hp: 20, dmg: 2, range: 13,  spd: 4.4, atkCd: 2.2, ranged: true,
               wpnR: 'crossbow_2handed', wpnL: null,        name: '游侠' },
  cavalry:   { model: 'Knight', mount: 'horse', h: 3.30, hp: 40, dmg: 4, range: 2.2, spd: 8.5,
               chargeDmg: 8, atkCd: 1.0, ranged: false,
               wpnR: 'sword_1handed', wpnL: null, name: '骑兵', cavalry: true },
  // 敌方（骷髅军）
  skel_war:  { model: 'Skeleton_Warrior', h: 1.75, hp: 26, dmg: 3, range: 1.9, spd: 3.8, atkCd: 1.2, ranged: false,
               wpnR: 'Skeleton_Blade', wpnL: 'Skeleton_Shield_Small_A', shield: true, name: '骷髅战士' },
  skel_min:  { model: 'Skeleton_Minion',  h: 1.60, hp: 16, dmg: 1, range: 1.7, spd: 4.2, atkCd: 1.0, ranged: false,
               wpnR: 'Skeleton_Blade', wpnL: null,          name: '骷髅杂兵' },
  skel_rog:  { model: 'Skeleton_Rogue',   h: 1.70, hp: 18, dmg: 2, range: 12,  spd: 3.6, atkCd: 2.5, ranged: true,
               wpnR: 'Skeleton_Crossbow', wpnL: null,       name: '骷髅弩手' },
  // 村民（平民，无战斗 AI）
  farmer:   { model: 'Barbarian', h: 1.75, hp: 20, isCivilian: true, spd: 2.5, name: '农民' },
  merchant: { model: 'Rogue',     h: 1.75, hp: 18, isCivilian: true, spd: 2.2, name: '商人' },
  guard:    { model: 'Knight',    h: 1.80, hp: 30, isCivilian: true, spd: 3.0, name: '守卫' },
};

// 骑兵调参（需求文档关键数值）
var CAV = {
  chargeMinDist: 25,    // 冲锋起点最短距离
  chargeGoodDist: 40,   // 冲锋起点推荐距离
  chargeDmgMult: 2.5,   // 冲锋伤害倍率
  meleeMaxT: 10,        // MELEE 最长持续（s）
  meleeCrowd: 4,        // 触发 BREAKAWAY 的包围人数
  breakDist: 35,        // BREAKAWAY 撤离最短距离
  breakFarDist: 70,     // BREAKAWAY 撤离目标距离
  regroupMaxT: 15,      // REGROUP 最长等待（s）
  retreatHp: 0.25,      // 触发 RETREAT 的血量比
  retreatOutnum: 3,     // 触发 RETREAT 的包围人数（低血量时）
  scanIv: 0.5,          // 目标评分刷新间隔
};

// 骑兵目标评分权重（需求文档 §4.3）
var SCORE_ENEMY = { skel_rog: 90, skel_war: 40, skel_min: 30, knight: 50, barbarian: 45, ranger: 80 };

// 士气系统：各兵种纪律值（0-100，越高越抗崩溃）。重甲/骑士最稳，杂兵最易溃。
var DISCIPLINE = {
  knight: 82, barbarian: 58, ranger: 50, cavalry: 76,
  skel_war: 62, skel_min: 34, skel_rog: 46,
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
  playerDmg: 4,         // 玩家挥剑伤害（玩家完全免伤，无 HP）
  playerReach: 2.8,     // 玩家攻击距离
  maxEnemies: 12,       // 同屏敌人上限（性能预算）
  corpseT: 3,           // 尸体保留秒数
};

// 动画名（KayKit 全系角色通用）
var ANIM = {
  idle: 'Idle', walk: 'Walking_A', run: 'Running_A',
  atk1: '1H_Melee_Attack_Slice_Horizontal', atk2: '1H_Melee_Attack_Chop',
  aim: '2H_Ranged_Aiming', shoot: '2H_Ranged_Shoot',
  hit: 'Hit_A', death: 'Death_A', cheer: 'Cheer', block: 'Block',
};
