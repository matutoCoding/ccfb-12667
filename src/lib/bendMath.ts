// 折弯工程计算：K 因子、展开(BA/BD/OSS)、空弯吨位、V 槽匹配、行程、偏载
import type { MaterialDef, BendStep, Part, BendLine, LowerDie, MachineConfig, BendCheck, FeasibilityReport, SimStep, SimSummary } from '../types';
import { clipLineToPolygon, dist, sub, norm, dot, scale, add, bbox, polygonArea } from './geometry';

const TON_KN = 9.80665; // 1 吨力 = 9.80665 kN

/** 按 R/T 在材料 K 因子表中线性插值 */
export function kFactorFor(mat: MaterialDef, R: number, T: number): number {
  const ratio = T > 0 ? R / T : 0;
  const tbl = [...mat.kTable].sort((a, b) => a.ratio - b.ratio);
  if (ratio <= tbl[0].ratio) return tbl[0].k;
  if (ratio >= tbl[tbl.length - 1].ratio) return tbl[tbl.length - 1].k;
  for (let i = 0; i < tbl.length - 1; i++) {
    const a = tbl[i], b = tbl[i + 1];
    if (ratio >= a.ratio && ratio <= b.ratio) {
      const t = (ratio - a.ratio) / (b.ratio - a.ratio);
      return a.k + (b.k - a.k) * t;
    }
  }
  return 0.33;
}

/** 折弯余量 BA（中性层弧长），mm */
export function bendAllowance(angleDeg: number, R: number, K: number, T: number): number {
  return (Math.PI / 180) * angleDeg * (R + K * T);
}

/** 外侧回弹距 OSS */
export function outsideSetback(angleDeg: number, R: number, T: number): number {
  return (R + T) * Math.tan((Math.PI / 180) * (angleDeg / 2));
}

/** 折弯扣除 BD = 2·OSS − BA */
export function bendDeduction(angleDeg: number, R: number, K: number, T: number): number {
  return 2 * outsideSetback(angleDeg, R, T) - bendAllowance(angleDeg, R, K, T);
}

export interface BendCalc {
  k: number;
  BA: number;
  OSS: number;
  BD: number;
}

export function calcBend(step: BendStep, mat: MaterialDef, T: number): BendCalc {
  const k = step.kFactor ?? kFactorFor(mat, step.innerRadius, T);
  return {
    k,
    BA: bendAllowance(step.angle, step.innerRadius, k, T),
    OSS: outsideSetback(step.angle, step.innerRadius, T),
    BD: bendDeduction(step.angle, step.innerRadius, k, T),
  };
}

/** 角度吨位修正系数（空弯：角度越小所需力越大） */
export function angleFactor(mat: MaterialDef, angleDeg: number): number {
  const tbl = [...mat.angleFactorTable].sort((a, b) => a.angle - b.angle);
  if (angleDeg <= tbl[0].angle) return tbl[0].factor;
  if (angleDeg >= tbl[tbl.length - 1].angle) return tbl[tbl.length - 1].factor;
  for (let i = 0; i < tbl.length - 1; i++) {
    const a = tbl[i], b = tbl[i + 1];
    if (angleDeg >= a.angle && angleDeg <= b.angle) {
      const t = (angleDeg - a.angle) / (b.angle - a.angle);
      return a.factor + (b.factor - a.factor) * t;
    }
  }
  return 1;
}

/**
 * 空弯自由折弯吨位（国际通用公式）
 * P(kN) = 1.42 · T² · L(m) · Rm / V · 角度系数
 * 注意：折弯线长度 L 由 mm 换算为 m 后代入
 * @returns 吨
 */
export function bendTonnage(T: number, L: number, Rm: number, V: number, angleDeg: number, mat: MaterialDef): number {
  if (V <= 0 || T <= 0 || L <= 0) return 0;
  const kN = (1.42 * T * T * (L / 1000) * Rm) / V * angleFactor(mat, angleDeg);
  return kN / TON_KN;
}

/** 推荐 V 槽宽区间（按材料倍数 × 料厚） */
export function recommendedV(mat: MaterialDef, T: number): { min: number; max: number; preferred: number } {
  return {
    min: mat.vMinMult * T,
    max: mat.vMaxMult * T,
    preferred: ((mat.vMinMult + mat.vMaxMult) / 2) * T,
  };
}

export function vMatchSeverity(V: number, mat: MaterialDef, T: number): 'error' | 'warn' | 'ok' {
  const r = recommendedV(mat, T);
  if (V < r.min * 0.8 || V > r.max * 1.25) return 'error';
  if (V < r.min || V > r.max) return 'warn';
  return 'ok';
}

/** 从下模库中挑最接近推荐值的 V 槽 */
export function suggestDie(mat: MaterialDef, T: number, dies: LowerDie[]): LowerDie | null {
  const target = recommendedV(mat, T).preferred;
  let best: LowerDie | null = null;
  let bd = Infinity;
  for (const d of dies) {
    const dd = Math.abs(d.vWidth - target);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

/** 折弯线长度（裁剪到轮廓内）与两侧法兰宽度（沿法线到轮廓边的距离） */
export interface BendGeometry {
  line: BendLine;
  clipped: { a: { x: number; y: number }; b: { x: number; y: number } } | null;
  bendLength: number;
  flangeA: number;
  flangeB: number;
  /** 后挡料默认定位 = 较短侧法兰宽 */
  gaugeX: number;
  center: { x: number; y: number };
}

export function bendGeometry(line: BendLine, outerPoly: { x: number; y: number }[]): BendGeometry {
  const clipped = clipLineToPolygon(line, outerPoly as any);
  const d = norm(sub(line.p2, line.p1));
  const n = { x: -d.y, y: d.x };
  const center = clipped ? { x: (clipped.a.x + clipped.b.x) / 2, y: (clipped.a.y + clipped.b.y) / 2 } : { x: (line.p1.x + line.p2.x) / 2, y: (line.p1.y + line.p2.y) / 2 };
  const bendLength = clipped ? dist(clipped.a, clipped.b) : dist(line.p1, line.p2);

  // 沿法线两侧投射，求到轮廓边的距离
  const reach = bbox(outerPoly as any).w + bbox(outerPoly as any).h;
  const span = (sign: number): number => {
    const far = add(center, scale(n, sign * reach));
    let best = reach;
    for (let i = 0; i < outerPoly.length; i++) {
      const a = outerPoly[i], b = outerPoly[(i + 1) % outerPoly.length];
      const r = sub(far, center);
      const s = sub(b, a);
      const denom = r.x * s.y - r.y * s.x;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((a.x - center.x) * s.y - (a.y - center.y) * s.x) / denom;
      const u = ((a.x - center.x) * r.y - (a.y - center.y) * r.x) / denom;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) best = Math.min(best, t * reach);
    }
    return best;
  };
  const flangeA = span(1);
  const flangeB = span(-1);
  return {
    line, clipped, bendLength, flangeA, flangeB,
    gaugeX: Math.min(flangeA, flangeB),
    center,
  };
}

/** 空弯工进压深（mm） */
export function penetration(angleDeg: number, V: number): number {
  return (V / 2) / Math.tan((Math.PI / 180) * (angleDeg / 2)) * 0.8;
}

/** 偏载百分比：按折弯线中心相对机床中心，长度折算左右负载 */
export function eccentricPct(geo: BendGeometry, outerPoly: { x: number; y: number }[]): number {
  const box = bbox(outerPoly as any);
  const machineCenter = box.min.x + box.w / 2;
  const d = norm(sub(geo.line.p2, geo.line.p1));
  // 折弯线方向在 X 轴上的投影决定左右分布
  const axisX = Math.abs(d.x);
  if (axisX < 0.3) return 0; // 折弯线近似竖直方向时不分左右
  const half = geo.bendLength * axisX / 2;
  const c = (geo.center.x - machineCenter) * axisX;
  const left = Math.max(0, half - c);
  const right = Math.max(0, half + c);
  const sum = left + right;
  return sum > 0 ? (Math.abs(left - right) / sum) * 100 : 0;
}

/** 全套刀次可行性校验 */
export function checkFeasibility(
  part: Part,
  mat: MaterialDef,
  machine: MachineConfig,
  lowerDies: LowerDie[],
  outerPoly: { x: number; y: number }[],
): FeasibilityReport {
  const T = part.thickness;
  const checks: BendCheck[] = part.bends.map((step, idx) => {
    const line = part.bendLines.find((b) => b.id === step.bendLineId);
    const messages: string[] = [];
    const empty: BendCheck = {
      bendIndex: idx, vMatch: 'error', vSuggest: null, tonnageRequired: 0, tonnageRatio: 0,
      tonnageOk: false, dieTonnageOk: false, minFlangeOk: false, minFlangeRequired: 0,
      shutHeightOk: false, shutHeightRequired: 0, strokeOk: false, strokeRequired: 0,
      eccentric: false, eccentricPct: 0, gaugeX: 0, fingerClearance: 0, messages,
    };
    if (!line) { messages.push('折弯线缺失'); return empty; }
    const geo = bendGeometry(line, outerPoly);
    const die = lowerDies.find((d) => d.id === step.lowerDieId);
    if (!die) { messages.push('未选下模'); return { ...empty, gaugeX: geo.gaugeX, fingerClearance: step.fingerClearanceManual ?? 0 }; }

    const sev = vMatchSeverity(die.vWidth, mat, T);
    const rec = recommendedV(mat, T);
    if (sev === 'error') messages.push(`V${die.vWidth} 与料厚 ${T}mm 严重不匹配，推荐 V${rec.min.toFixed(1)}~V${rec.max.toFixed(1)}`);
    else if (sev === 'warn') messages.push(`V${die.vWidth} 偏离推荐区间 V${rec.min.toFixed(1)}~V${rec.max.toFixed(1)}`);

    const ton = bendTonnage(T, geo.bendLength, mat.tensileStrength, die.vWidth, step.angle, mat);
    const ratio = machine.ratedTonnage > 0 ? ton / machine.ratedTonnage : 0;
    const tonnageOk = ratio <= 1;
    if (!tonnageOk) messages.push(`需求 ${ton.toFixed(1)}t 超过机床额定 ${machine.ratedTonnage}t（${(ratio * 100).toFixed(0)}%）`);
    const dieTonnageOk = ton <= die.tonnageRated;
    if (!dieTonnageOk) messages.push(`需求 ${ton.toFixed(1)}t 超过下模 ${die.name} 承压 ${die.tonnageRated}t`);

    const flange = Math.min(geo.flangeA, geo.flangeB);
    const minFlangeOk = flange >= die.minFlange;
    if (!minFlangeOk) messages.push(`法兰边 ${flange.toFixed(1)}mm 低于 V${die.vWidth} 最小法兰边 ${die.minFlange}mm`);

    const upperH = 0; // 由调用方补充上模高度需要模具库，这里用闭合高度配置
    void upperH;
    const shutHeightRequired = die.height + T + machine.shutHeight;
    const shutHeightOk = shutHeightRequired <= machine.maxOpenHeight;
    if (!shutHeightOk) messages.push(`闭合高度需求 ${shutHeightRequired.toFixed(1)}mm > 机床最大开启 ${machine.maxOpenHeight}mm（超 ${(shutHeightRequired - machine.maxOpenHeight).toFixed(1)}mm）`);

    const strokeRequired = penetration(step.angle, die.vWidth);
    const strokeOk = strokeRequired <= machine.ramStroke;
    if (!strokeOk) messages.push(`工进压深 ${strokeRequired.toFixed(1)}mm > 滑块行程 ${machine.ramStroke}mm（超 ${(strokeRequired - machine.ramStroke).toFixed(1)}mm）`);

    const ep = eccentricPct(geo, outerPoly);
    const eccentric = ep > machine.eccentricLimitPct;
    if (eccentric) messages.push(`偏载 ${ep.toFixed(1)}% 超过限值 ${machine.eccentricLimitPct}%`);

    const gaugeX = step.gaugeXManual ?? geo.gaugeX;
    const fingerClearance = step.fingerClearanceManual ?? 0;
    return {
      bendIndex: idx, vMatch: sev, vSuggest: sev === 'ok' ? null : rec.preferred,
      tonnageRequired: ton, tonnageRatio: ratio, tonnageOk, dieTonnageOk,
      minFlangeOk, minFlangeRequired: die.minFlange,
      shutHeightOk, shutHeightRequired, strokeOk, strokeRequired,
      eccentric, eccentricPct: ep, gaugeX, fingerClearance, messages,
    };
  });
  return {
    checks,
    hasError: checks.some((c) => c.messages.length > 0 && (!c.tonnageOk || !c.minFlangeOk || !c.shutHeightOk || !c.strokeOk || !c.dieTonnageOk || c.vMatch === 'error')),
    hasWarn: checks.some((c) => c.messages.length > 0),
  };
}

/** 仿真：行程时间曲线、后挡料、节拍汇总 */
export function simulate(
  part: Part,
  mat: MaterialDef,
  machine: MachineConfig,
  lowerDies: LowerDie[],
  outerPoly: { x: number; y: number }[],
  defaultClearance: number,
): { steps: SimStep[]; summary: SimSummary } {
  const T = part.thickness;
  const steps: SimStep[] = part.bends.map((step, idx) => {
    const line = part.bendLines.find((b) => b.id === step.bendLineId)!;
    const geo = bendGeometry(line, outerPoly);
    const die = lowerDies.find((d) => d.id === step.lowerDieId);
    const V = die?.vWidth ?? T * 8;
    const ton = die ? bendTonnage(T, geo.bendLength, mat.tensileStrength, V, step.angle, mat) : 0;
    const workDist = penetration(step.angle, V);
    const rapidDist = Math.max(0, machine.ramStroke - workDist) * 0.6;
    const returnDist = rapidDist + workDist;
    const rapidTime = rapidDist / machine.rapidSpeed;
    const workTime = workDist / machine.workSpeed;
    const returnTime = returnDist / machine.returnSpeed;
    const curve: { s: number; f: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      const s = i / 20;
      curve.push({ s, f: Math.pow(s, 0.7) }); // 吨位随工进行程增长示意曲线
    }
    return {
      bendIndex: idx,
      gaugeX: step.gaugeXManual ?? geo.gaugeX,
      fingerClearance: step.fingerClearanceManual ?? defaultClearance,
      tonnagePeak: ton,
      rapidDist, workDist, returnDist,
      rapidTime, workTime, returnTime,
      tonnageCurve: curve,
    };
  });
  const totalTime = steps.reduce((s, x) => s + x.rapidTime + x.workTime + x.returnTime, 0);
  const workTime = steps.reduce((s, x) => s + x.workTime, 0);
  const idleTime = totalTime - workTime;
  return {
    steps,
    summary: {
      totalTime, workTime, idleTime,
      idlePct: totalTime > 0 ? (idleTime / totalTime) * 100 : 0,
      peakTonnage: Math.max(0, ...steps.map((s) => s.tonnagePeak)),
    },
  };
}

/** 自动折弯顺序：先短后长、先内后外。orderLocked 的刀次保持原位 */
export function autoBendOrder(part: Part, outerPoly: { x: number; y: number }[]): BendStep[] {
  const geos = part.bendLines.map((line) => {
    const geo = bendGeometry(line, outerPoly);
    return { line, geo };
  });
  const indexed = part.bends.map((step, idx) => {
    const g = geos.find((x) => x.line.id === step.bendLineId)!;
    return {
      step,
      idx,
      length: g.geo.bendLength,
      depth: Math.max(g.geo.flangeA, g.geo.flangeB), // 外侧刀次深度大
    };
  });
  const locked = new Set(indexed.filter((x) => x.step.orderLocked).map((x) => x.idx));
  const movable = indexed.filter((x) => !locked.has(x.idx)).sort((a, b) => {
    if (Math.abs(a.length - b.length) > 1) return a.length - b.length; // 先短后长
    return a.depth - b.depth;                                          // 先内后外（浅的先折）
  });
  const result: BendStep[] = new Array(part.bends.length);
  indexed.filter((x) => locked.has(x.idx)).forEach((x) => { result[x.idx] = x.step; });
  const freeSlots = result.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
  movable.forEach((x, k) => { result[freeSlots[k]] = x.step; });
  return result;
}

/** 一组平行折弯的展开/折成尺寸汇总（沿折弯线法线方向） */
export function directionGroupSummary(part: Part, mat: MaterialDef): {
  direction: string; blank: number; bdSum: number; folded: number; baSum: number; bends: string[];
}[] {
  const groups: { key: number; direction: string; blank: number; bdSum: number; baSum: number; bends: string[]; norm: { x: number; y: number } }[] = [];
  if (!part.entities.length) return [];
  const outer = part.entities.filter((e) => e.type !== 'slot');
  const pts = outer.flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : []));
  if (!pts.length) return [];
  const box = bbox(pts);
  for (const step of part.bends) {
    const line = part.bendLines.find((b) => b.id === step.bendLineId);
    if (!line) continue;
    const d = norm(sub(line.p2, line.p1));
    const n = { x: -d.y, y: d.x };
    const key = Math.abs(n.x) > 0.7 ? 0 : 1; // 0=水平线方向折(法线沿X)，1=竖直
    const calc = calcBend(step, mat, part.thickness);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, direction: key === 0 ? 'X 向（左右折弯）' : 'Y 向（上下折弯）', blank: 0, bdSum: 0, baSum: 0, bends: [], norm: n };
      groups.push(g);
    }
    g.bdSum += calc.BD;
    g.baSum += calc.BA;
    g.bends.push(`#${part.bends.indexOf(step) + 1}`);
  }
  return groups.map((g) => {
    const blank = Math.abs(g.norm.x) > 0.7 ? box.w : box.h;
    return {
      direction: g.direction,
      blank,
      bdSum: g.bdSum,
      folded: blank - g.bdSum,
      baSum: g.baSum,
      bends: g.bends,
    };
  });
}

export function polygonAreaMm2(poly: { x: number; y: number }[]): number {
  return Math.abs(polygonArea(poly as any));
}

export { TON_KN };
