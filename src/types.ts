// 钣金折弯工艺系统 —— 核心数据类型定义

export interface Vec2 { x: number; y: number }

/** 手绘轮廓实体：直线 / 圆弧 / 长圆孔（长圆孔为闭合槽，由两条直线+两个半圆构成） */
export type SketchEntityType = 'line' | 'arc' | 'slot';

export interface LineEntity {
  id: string;
  type: 'line';
  p1: Vec2;
  p2: Vec2;
}

export interface ArcEntity {
  id: string;
  type: 'arc';
  center: Vec2;
  radius: number;
  startAngle: number; // 弧度
  endAngle: number;
  ccw: boolean;
}

export interface SlotEntity {
  id: string;
  type: 'slot';
  center: Vec2;       // 长圆孔中心
  length: number;     // 总长
  width: number;      // 总宽（= 2r）
  angle: number;      // 长轴方向（弧度）
}

export type SketchEntity = LineEntity | ArcEntity | SlotEntity;

/** 标注：外形尺寸 / 孔位坐标，与轮廓实体联动 */
export type DimensionKind = 'outer' | 'hole';
export interface Dimension {
  id: string;
  kind: DimensionKind;
  entityId?: string;      // 关联实体（孔位）
  p1: Vec2;               // 测量起点（绝对坐标，mm）
  p2: Vec2;               // 测量终点
  label: string;          // 自动生成的标注文字
}

/** 折弯线（展开件上的直线，必须横跨轮廓内部） */
export interface BendLine {
  id: string;
  p1: Vec2;
  p2: Vec2;
}

/** 单道折弯参数 */
export interface BendStep {
  id: string;
  bendLineId: string;
  /** 折弯角：成品夹角的补角，单位度。90° 直角件 → angle=90 */
  angle: number;
  /** 折弯方向：+1 正向（折向上）/ -1 反向（折向下），决定相邻面旋转方向 */
  direction: 1 | -1;
  /** 内弯曲半径 R (mm) */
  innerRadius: number;
  /** 折弯系数 K（中性层系数），null = 按牌号默认 K 因子表取值 */
  kFactor: number | null;
  /** 折弯扣除/折弯系数备注用：实际展开按 BA 公式计算 */
  upperDieId: string | null;
  lowerDieId: string | null;
  /** 人工调整过的后挡料 X（mm），null = 自动计算 */
  gaugeXManual: number | null;
  /** 挡指避让距离人工覆盖（mm），null = 自动 */
  fingerClearanceManual: number | null;
  /** 人工锁定顺序后，自动排序不得覆盖 */
  orderLocked: boolean;
}

export type PartStatus = 'active' | 'recycled';

export interface Part {
  id: string;
  model: string;            // 产品型号（分组键）
  name: string;
  material: string;         // 牌号，如 SPCC / SUS304
  thickness: number;        // 料厚 mm
  tags: string[];
  favorite: boolean;
  status: PartStatus;
  createdAt: number;
  updatedAt: number;
  recycledAt: number | null;
  entities: SketchEntity[];
  dimensions: Dimension[];
  bendLines: BendLine[];
  bends: BendStep[];        // 数组顺序即刀次顺序
  /** 手工核算的展开长度（mm），用于与系统计算值校核，null=未填 */
  manualFlatLength: number | null;
  note: string;
}

export interface UpperDie {
  id: string;
  name: string;
  angle: number;            // 刀尖角度（度）
  tipRadius: number;        // 刀尖 R
  height: number;           // 模具闭合高度（mm）
}

export interface LowerDie {
  id: string;
  name: string;
  vWidth: number;           // V 槽宽度 mm
  angle: number;            // V 槽角度（度，通常 88）
  minFlange: number;        // 允许最小法兰边 mm
  height: number;           // 下模高度 mm
  tonnageRated: number;     // 该模具额定承压（吨）
}

export interface MachineConfig {
  id: string;
  name: string;
  ratedTonnage: number;         // 额定吨位（吨）
  maxOpenHeight: number;        // 最大开启高度（mm）
  ramStroke: number;            // 滑块最大行程（mm）
  rapidSpeed: number;           // 快下速度 mm/s
  workSpeed: number;            // 工进速度 mm/s
  returnSpeed: number;          // 回程速度 mm/s
  eccentricLimitPct: number;    // 左右负载差报警比例（%）
  shutHeight: number;           // 模具闭合高度需求（mm）
}

/** K 因子表：按 R/T 区间插值 */
export interface KFactorPoint { ratio: number; k: number }

export interface MaterialDef {
  name: string;                  // SPCC / SUS304 ...
  tensileStrength: number;       // 抗拉强度 Rm (MPa)
  yieldStrength: number;         // 屈服 (MPa)
  /** 推荐 V 槽宽 = vMinMult*T ~ vMaxMult*T */
  vMinMult: number;
  vMaxMult: number;
  kTable: KFactorPoint[];
  /** 角度吨位修正系数（按折弯角查表，线性插值） */
  angleFactorTable: { angle: number; factor: number }[];
}

export interface Settings {
  machines: MachineConfig[];
  activeMachineId: string;
  upperDies: UpperDie[];
  lowerDies: LowerDie[];
  materials: MaterialDef[];
  defaultFingerClearance: number; // 默认挡指避让 mm
  recycleDays: number;
}

/** 单刀可行性校验结果 */
export type Severity = 'error' | 'warn' | 'ok';

export interface BendCheck {
  bendIndex: number;
  vMatch: Severity;
  vSuggest: number | null;
  tonnageRequired: number;       // 吨
  tonnageRatio: number;          // 需求/额定
  tonnageOk: boolean;
  dieTonnageOk: boolean;
  minFlangeOk: boolean;
  minFlangeRequired: number;
  shutHeightOk: boolean;
  shutHeightRequired: number;
  strokeOk: boolean;
  strokeRequired: number;
  eccentric: boolean;            // 偏载
  eccentricPct: number;
  gaugeX: number;
  fingerClearance: number;
  messages: string[];
}

export interface FeasibilityReport {
  checks: BendCheck[];
  hasError: boolean;
  hasWarn: boolean;
}

/** 仿真刀次结果 */
export interface SimStep {
  bendIndex: number;
  gaugeX: number;
  fingerClearance: number;
  tonnagePeak: number;
  rapidDist: number;
  workDist: number;
  returnDist: number;
  rapidTime: number;
  workTime: number;
  returnTime: number;
  /** 工进段吨位-行程曲线（归一化 0..1 → 吨位系数） */
  tonnageCurve: { s: number; f: number }[];
}

export interface SimSummary {
  totalTime: number;
  workTime: number;
  idleTime: number;
  idlePct: number;
  peakTonnage: number;
}
