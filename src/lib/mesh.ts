// 展开件三角网格构建 + 逐刀折叠 3D 变换
import type { Part, Vec2 } from '../types';
import { buildLoops, splitPolygon, triangulate, clipLineToPolygon, dist, sub, norm } from './geometry';
import { uid } from './geometry';

export interface Face {
  id: string;
  poly: Vec2[];                 // 平面坐标（mm）
  neighbor: { faceId: string; bendLineId: string }[];
  center: Vec2;
  area: number;
}

export interface FlatMesh {
  faces: Face[];
  vertices: Float32Array;       // 平面 xyz（z=0）
  indices: Uint32Array;
  faceOfVertex: number[];       // 每个顶点所属面索引
  bendSegments: { a: Vec2; b: Vec2; bendLineId: string }[];
}

export function buildFaces(part: Part): Face[] {
  const loops = buildLoops(part.entities);
  if (!loops.closed || loops.loops.length === 0) return [];
  let polys: Vec2[][] = [loops.loops[0]];
  const bendSeg: { a: Vec2; b: Vec2; bendLineId: string }[] = [];

  for (const bl of part.bendLines) {
    const next: Vec2[][] = [];
    for (const poly of polys) {
      const clip = clipLineToPolygon(bl, poly);
      if (!clip) { next.push(poly); continue; }
      const pieces = splitPolygon(poly, clip.a, clip.b);
      if (pieces.length === 2) bendSeg.push({ a: clip.a, b: clip.b, bendLineId: bl.id });
      next.push(...pieces);
    }
    polys = next;
  }

  const faces: Face[] = polys.map((poly) => {
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    return {
      id: uid('face'),
      poly,
      neighbor: [],
      center: { x: cx, y: cy },
      area: polygonAreaAbs(poly),
    };
  });

  // 共享折弯线段的两个面互为邻居
  for (const seg of bendSeg) {
    const owners: string[] = [];
    for (const f of faces) {
      const onEdge = f.poly.some((p) => dist(p, seg.a) < 0.5) && f.poly.some((p) => dist(p, seg.b) < 0.5);
      if (onEdge) owners.push(f.id);
    }
    if (owners.length === 2) {
      faces.find((f) => f.id === owners[0])!.neighbor.push({ faceId: owners[1], bendLineId: seg.bendLineId });
      faces.find((f) => f.id === owners[1])!.neighbor.push({ faceId: owners[0], bendLineId: seg.bendLineId });
    }
  }
  return faces;
}

function polygonAreaAbs(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - a.y * b.x;
  }
  return Math.abs(s / 2);
}

export function buildFlatMesh(part: Part): FlatMesh | null {
  const faces = buildFaces(part);
  if (faces.length === 0) return null;
  const verts: number[] = [];
  const idx: number[] = [];
  const faceOfVertex: number[] = [];
  let base = 0;
  faces.forEach((f, fi) => {
    for (const p of f.poly) {
      verts.push(p.x, p.y, 0);
      faceOfVertex.push(fi);
    }
    const local = triangulate(f.poly);
    for (const i of local) idx.push(base + i);
    base += f.poly.length;
  });
  const bendSegments: FlatMesh['bendSegments'] = [];
  for (const bl of part.bendLines) {
    for (const f of faces) {
      const clip = clipLineToPolygon(bl, f.poly);
      if (clip) bendSegments.push({ a: clip.a, b: clip.b, bendLineId: bl.id });
    }
  }
  return {
    faces,
    vertices: new Float32Array(verts),
    indices: new Uint32Array(idx),
    faceOfVertex,
    bendSegments,
  };
}

// ---------- 3D 折叠 ----------
export interface Mat4 { m: Float32Array }

export function identity4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return { m };
}

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a.m[0 * 4 + r] * b.m[c * 4 + 0] +
        a.m[1 * 4 + r] * b.m[c * 4 + 1] +
        a.m[2 * 4 + r] * b.m[c * 4 + 2] +
        a.m[3 * 4 + r] * b.m[c * 4 + 3];
    }
  }
  return { m: out };
}

/** 绕过 point 的轴（axis 为单位向量）旋转 angleRad：T·R·T⁻¹ */
export function rotateAround(point: { x: number; y: number; z: number }, axis: { x: number; y: number; z: number }, angleRad: number): Mat4 {
  const c = Math.cos(angleRad), s = Math.sin(angleRad);
  const { x, y, z } = axis;
  const r = new Float32Array(16);
  r[0] = x * x * (1 - c) + c;
  r[1] = y * x * (1 - c) + z * s;
  r[2] = z * x * (1 - c) - y * s;
  r[4] = x * y * (1 - c) - z * s;
  r[5] = y * y * (1 - c) + c;
  r[6] = z * y * (1 - c) + x * s;
  r[8] = x * z * (1 - c) + y * s;
  r[9] = y * z * (1 - c) - x * s;
  r[10] = z * z * (1 - c) + c;
  r[15] = 1;
  const t = identity4(), ti = identity4();
  t.m[12] = point.x; t.m[13] = point.y; t.m[14] = point.z;
  ti.m[12] = -point.x; ti.m[13] = -point.y; ti.m[14] = -point.z;
  return multiply4(t, multiply4({ m: r }, ti));
}

export function applyMat4(mat: Mat4, x: number, y: number, z: number): [number, number, number] {
  const m = mat.m;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * 逐刀折叠后的顶点（全局坐标）。
 * @param progressPerBend 每道折弯的完成度 0..1（数组长度 = bends 数）
 */
export function foldedVertices(
  part: Part,
  mesh: FlatMesh,
  progressPerBend: number[],
): Float32Array {
  const faceTransforms = new Map<string, Mat4>();
  const root = mesh.faces[0];
  faceTransforms.set(root.id, identity4());
  const visited = new Set<string>([root.id]);
  const queue = [root.id];

  while (queue.length) {
    const fid = queue.shift()!;
    const face = mesh.faces.find((f) => f.id === fid)!;
    const parentMat = faceTransforms.get(fid)!;
    for (const nb of face.neighbor) {
      if (visited.has(nb.faceId)) continue;
      visited.add(nb.faceId);
      const bendIndex = part.bends.findIndex((b) => b.bendLineId === nb.bendLineId);
      const bl = part.bendLines.find((b) => b.id === nb.bendLineId)!;
      const progress = bendIndex >= 0 ? Math.max(0, Math.min(1, progressPerBend[bendIndex])) : 0;
      const angleDeg = bendIndex >= 0 ? part.bends[bendIndex].angle : 90;
      const stepDir = bendIndex >= 0 ? part.bends[bendIndex].direction : 1;
      // 折弯线轴在展开平面上是固定世界轴；嵌套折弯时父面旋转会带动子面，
      // 反向折弯指绕同一世界轴向相反方向旋转，实现 U 槽两侧对称立起
      const d = norm(sub(bl.p2, bl.p1));
      const axis = { x: d.x, y: d.y, z: 0 };
      const pivot = { x: (bl.p1.x + bl.p2.x) / 2, y: (bl.p1.y + bl.p2.y) / 2, z: 0 };
      const rot = rotateAround(pivot, axis, (Math.PI / 180) * angleDeg * progress * stepDir);
      faceTransforms.set(nb.faceId, multiply4(parentMat, rot));
      queue.push(nb.faceId);
    }
  }

  const out = new Float32Array(mesh.vertices.length);
  let fi = -1;
  let lastFace = -1;
  let mat = identity4();
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const vi = i / 3;
    fi = mesh.faceOfVertex[vi];
    if (fi !== lastFace) {
      mat = faceTransforms.get(mesh.faces[fi].id) ?? identity4();
      lastFace = fi;
    }
    const [x, y, z] = applyMat4(mat, mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]);
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

/** 透视 + 视图矩阵（简单轨道相机） */
export function perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return { m };
}

export function lookAt(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): Mat4 {
  const z = norm3(sub3(eye, target));
  const up = { x: 0, y: 0, z: 1 };
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0] = x.x; m[4] = x.y; m[8] = x.z; m[12] = -dot3(x, eye);
  m[1] = y.x; m[5] = y.y; m[9] = y.z; m[13] = -dot3(y, eye);
  m[2] = z.x; m[6] = z.y; m[10] = z.z; m[14] = -dot3(z, eye);
  m[15] = 1;
  return { m };
}

function sub3(a: any, b: any) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot3(a: any, b: any) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross3(a: any, b: any) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function norm3(a: any) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
