// 自带示例零件：单折边、多道折弯、带凸台（台阶）件，打开即可演示
import type { Part, SketchEntity, BendLine, BendStep, Vec2 } from '../types';
import { uid } from './geometry';

function rect(x0: number, y0: number, x1: number, y1: number): SketchEntity[] {
  const mk = (p1: Vec2, p2: Vec2): SketchEntity => ({ id: uid('e'), type: 'line', p1, p2 });
  return [
    mk({ x: x0, y: y0 }, { x: x1, y: y0 }),
    mk({ x: x1, y: y0 }, { x: x1, y: y1 }),
    mk({ x: x1, y: y1 }, { x: x0, y: y1 }),
    mk({ x: x0, y: y1 }, { x: x0, y: y0 }),
  ];
}

function slot(cx: number, cy: number, length: number, width: number, angle = 0): SketchEntity {
  return { id: uid('e'), type: 'slot', center: { x: cx, y: cy }, length, width, angle };
}

function bend(x: number, y0: number, y1: number): BendLine {
  return { id: uid('bl'), p1: { x, y: y0 }, p2: { x, y: y1 } };
}

function step(bendLineId: string, lowerDieId: string, upperDieId: string, R: number, angle = 90, direction: 1 | -1 = 1): BendStep {
  return {
    id: uid('bn'), bendLineId, angle, direction, innerRadius: R, kFactor: null,
    upperDieId, lowerDieId, gaugeXManual: null, fingerClearanceManual: null, orderLocked: false,
  };
}

export function buildSampleParts(): Part[] {
  const now = Date.now();

  // 1. 单折边 L 支架（SPCC 1.5mm，120×80 展开，折弯线 x=30）
  const lEntities = rect(0, 0, 120, 80);
  lEntities.push(slot(75, 40, 20, 8));
  const lLine = bend(30, 0, 80);
  const lBend = step(lLine.id, 'l_v10', 'u_straight', 1.5);
  const partL: Part = {
    id: uid('part'),
    model: 'DEMO-L01',
    name: '单折边L支架',
    material: 'SPCC',
    thickness: 1.5,
    tags: ['示例', '单折'],
    favorite: true,
    status: 'active',
    createdAt: now - 3000,
    updatedAt: now - 3000,
    recycledAt: null,
    entities: lEntities,
    dimensions: [],
    bendLines: [lLine],
    bends: [lBend],
    manualFlatLength: 120,
    note: '示例：一道 90° 折弯，带长圆孔',
  };

  // 2. 多道折弯 U 型线槽（SPCC 2.0mm，展开 200×100，两条折弯线 40/160）
  const uEntities = rect(0, 0, 200, 100);
  uEntities.push(slot(100, 50, 30, 10));
  const uLine1 = bend(40, 0, 100);
  const uLine2 = bend(160, 0, 100);
  const partU: Part = {
    id: uid('part'),
    model: 'DEMO-U02',
    name: '多道折弯U型线槽',
    material: 'SPCC',
    thickness: 2.0,
    tags: ['示例', '多道'],
    favorite: false,
    status: 'active',
    createdAt: now - 2000,
    updatedAt: now - 2000,
    recycledAt: null,
    entities: uEntities,
    dimensions: [],
    bendLines: [uLine1, uLine2],
    bends: [step(uLine1.id, 'l_v12', 'u_goose', 2.0, 90, 1), step(uLine2.id, 'l_v12', 'u_goose', 2.0, 90, 1)],
    manualFlatLength: 200,
    note: '示例：两道对称 90° 折弯成 U 槽，演示偏载与顺序',
  };

  // 3. 带凸台（台阶）Z 型件（SUS304 1.2mm，展开 150×60，折弯线 25/55，同向折出台阶）
  const zEntities = rect(0, 0, 150, 60);
  zEntities.push(slot(110, 30, 16, 6));
  const zLine1 = bend(25, 0, 60);
  const zLine2 = bend(55, 0, 60);
  const partZ: Part = {
    id: uid('part'),
    model: 'DEMO-Z03',
    name: '带凸台Z型台阶件',
    material: 'SUS304',
    thickness: 1.2,
    tags: ['示例', '凸台'],
    favorite: false,
    status: 'active',
    createdAt: now - 1000,
    updatedAt: now - 1000,
    recycledAt: null,
    entities: zEntities,
    dimensions: [],
    bendLines: [zLine1, zLine2],
    bends: [step(zLine1.id, 'l_v8', 'u_small', 1.0), step(zLine2.id, 'l_v8', 'u_small', 1.0)],
    manualFlatLength: 150,
    note: '示例：两道同向折弯形成台阶凸台，演示先内后外排序',
  };

  return [partZ, partU, partL];
}
