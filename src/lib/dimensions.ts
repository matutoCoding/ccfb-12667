// 标注管理：外形尺寸（自动生成）与孔位坐标，与轮廓实体联动重算
import type { Part, Dimension, Vec2, SlotEntity } from '../types';
import { bbox, round2, uid, tessellate, dist } from './geometry';

/** 重新生成所有外形尺寸标注（随轮廓联动） */
export function rebuildOuterDimensions(part: Part): Dimension[] {
  const pts = part.entities.flatMap((e) => tessellate(e));
  if (pts.length < 2) return part.dimensions.filter((d) => d.kind === 'hole');
  const box = bbox(pts);
  const outer: Dimension[] = [
    {
      id: uid('dim'), kind: 'outer',
      p1: box.min, p2: { x: box.max.x, y: box.min.y },
      label: `外形 ${round2(box.w)} mm`,
    },
    {
      id: uid('dim'), kind: 'outer',
      p1: box.min, p2: { x: box.min.x, y: box.max.y },
      label: `外形 ${round2(box.h)} mm`,
    },
  ];
  const holes = part.dimensions.filter((d) => d.kind === 'hole');
  return [...outer, ...holes];
}

/** 为长圆孔生成/更新孔位坐标标注（相对外形左下角） */
export function rebuildHoleDimensions(part: Part): void {
  const pts = part.entities.flatMap((e) => tessellate(e));
  if (pts.length < 2) return;
  const box = bbox(pts);
  const kept: Dimension[] = part.dimensions.filter((d) => d.kind === 'outer');
  for (const e of part.entities) {
    if (e.type !== 'slot') continue;
    const slot = e as SlotEntity;
    kept.push({
      id: uid('dim'),
      kind: 'hole',
      entityId: slot.id,
      p1: box.min,
      p2: slot.center,
      label: `孔位 X=${round2(slot.center.x - box.min.x)} Y=${round2(slot.center.y - box.min.y)}  ${round2(slot.length)}×${round2(slot.width)}`,
    });
  }
  part.dimensions = kept;
}

/** 轮廓变更后统一刷新标注（外形 + 孔位联动） */
export function refreshDimensions(part: Part): void {
  const holes = part.entities.filter((e) => e.type === 'slot');
  const base = rebuildOuterDimensions(part).filter((d) => d.kind === 'outer');
  const pts = part.entities.flatMap((e) => tessellate(e));
  if (pts.length >= 2) {
    const box = bbox(pts);
    for (const e of holes) {
      const slot = e as SlotEntity;
      base.push({
        id: uid('dim'), kind: 'hole', entityId: slot.id,
        p1: box.min, p2: slot.center,
        label: `孔位 X=${round2(slot.center.x - box.min.x)} Y=${round2(slot.center.y - box.min.y)}  ${round2(slot.length)}×${round2(slot.width)}`,
      });
    }
  }
  part.dimensions = base;
}

export function distanceLabel(p1: Vec2, p2: Vec2): string {
  return `${round2(dist(p1, p2))} mm`;
}
