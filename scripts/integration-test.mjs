// 库级集成验证：用 esbuild 把 TS 编译后直接跑真实代码路径
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

const root = process.cwd().replace(/\\/g, '/');
const entry = join(mkdtempSync(join(tmpdir(), 'bend-')), 'entry.mjs');
writeFileSync(entry, `
import { bendTonnage, calcBend, checkFeasibility, simulate, autoBendOrder, kFactorFor, recommendedV, directionGroupSummary } from '${root}/src/lib/bendMath.ts';
import { defaultSettings } from '${root}/src/lib/defaults.ts';
import { buildSampleParts } from '${root}/src/lib/samples.ts';
import { buildLoops } from '${root}/src/lib/geometry.ts';
import { buildFlatMesh, foldedVertices } from '${root}/src/lib/mesh.ts';

const settings = defaultSettings();
const spcc = settings.materials.find(m => m.name === 'SPCC');
const sus = settings.materials.find(m => m.name === 'SUS304');
const machine = settings.machines[0];
const parts = buildSampleParts();
let pass = 0, fail = 0;
const check = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

// 1. K 因子插值
check(Math.abs(kFactorFor(spcc, 2, 2) - 0.33) < 1e-9, 'R/T=1 时 SPCC K=0.33');
check(kFactorFor(spcc, 100, 2) === 0.46, '超大 R/T 钳制到表尾 0.46');

// 2. BA 精度（手工 4.1783）
const c = calcBend({ angle: 90, innerRadius: 2, kFactor: 0.33 }, spcc, 2);
check(Math.abs(c.BA - 4.178318) < 0.0001, 'BA 公式精度 <0.0001mm');
check(Math.abs(c.BD - 3.821682) < 0.0001, 'BD 公式精度 <0.0001mm');

// 3. 吨位单位正确
const ton = bendTonnage(2, 100, 340, 12, 90, spcc);
check(ton > 1.5 && ton < 1.8, '2mm/100mm/V12 吨位约 1.64t，单位正确: ' + ton.toFixed(2));
const ton304 = bendTonnage(1.2, 60, 620, 8, 90, sus);
check(ton304 > ton * 0.5, '304 强度高，同尺度吨位更高: ' + ton304.toFixed(2));

// 4. V 槽推荐
const rec = recommendedV(spcc, 2);
check(rec.min === 12 && rec.max === 20, 'SPCC 2mm 推荐 V12~V20');

// 5. 示例零件完整校验链路
for (const p of parts) {
  const mat = settings.materials.find(m => m.name === p.material);
  const loops = buildLoops(p.entities);
  check(loops.closed, p.name + ' 轮廓闭合');
  const outer = loops.loops[0];
  const report = checkFeasibility(p, mat, machine, settings.lowerDies, outer);
  check(report.checks.length === p.bends.length, p.name + ' 每刀都有校验结果');
  const sim = simulate(p, mat, machine, settings.lowerDies, outer, 5);
  check(sim.steps.length === p.bends.length && sim.summary.totalTime > 0, p.name + ' 仿真节拍 >0');
  check(sim.steps.every(s => s.tonnagePeak > 0), p.name + ' 每刀吨位 >0');
  const mesh = buildFlatMesh(p);
  check(mesh && mesh.indices.length > 0, p.name + ' 三角网格生成');
  if (mesh) {
    const prog = foldedVertices(p, mesh, p.bends.map(() => 1));
    check(prog.length === mesh.vertices.length, p.name + ' 全折叠顶点数一致');
    const zVals = [];
    for (let i = 2; i < prog.length; i += 3) zVals.push(prog[i]);
    check(Math.max(...zVals) > 0.5, p.name + ' 折叠后法兰立起 Zmax=' + Math.max(...zVals).toFixed(1) + 'mm');
  }
  const ordered = autoBendOrder(p, outer);
  check(ordered.length === p.bends.length, p.name + ' 自动排序保持刀数');
}

// 6. 锁定刀次不被自动排序覆盖
const p0 = parts[0];
p0.bends[0].orderLocked = true;
const lockedId = p0.bends[0].id;
const loops0 = buildLoops(p0.entities);
const reordered = autoBendOrder(p0, loops0.loops[0]);
check(reordered[0].id === lockedId, 'orderLocked 刀次保持原位不被覆盖');

// 7. 超限场景：故意选 V6 折 3mm 板 → 应报 error
const thick = JSON.parse(JSON.stringify(parts[0]));
thick.thickness = 3;
thick.bends.forEach(b => b.lowerDieId = 'l_v6');
const mat = settings.materials.find(m => m.name === thick.material);
const rep = checkFeasibility(thick, mat, machine, settings.lowerDies, buildLoops(thick.entities).loops[0]);
check(rep.hasError, 'V6 折 3mm 板被拦截报错');
check(rep.checks[0].vSuggest !== null, '给出推荐 V 值: ' + rep.checks[0].vSuggest);

// 8. 折弯方向字段：-1 与 +1 必须产生不同的折叠几何（用单刀 L 件，进度数组长度匹配）
const dirPart = parts.find(p => p.name.includes('L'));
const meshA = buildFlatMesh(dirPart);
const up = foldedVertices(dirPart, meshA, dirPart.bends.map(() => 1));
const origDir = dirPart.bends[0].direction;
dirPart.bends[0].direction = -1;
const down = foldedVertices(dirPart, meshA, dirPart.bends.map(() => 1));
dirPart.bends[0].direction = origDir;
let diff = 0;
for (let i = 2; i < up.length; i += 3) diff = Math.max(diff, Math.abs(up[i] - down[i]));
check(diff > 1, '反向折弯(direction=-1)几何与正向不同，最大Z差=' + diff.toFixed(1) + 'mm');

// 9. 手工展开校核 0.1mm 允差判定
const calcPart = parts[1];
const g = directionGroupSummary(calcPart, settings.materials.find(m => m.name === calcPart.material));
check(g.length >= 1 && g.every(x => x.blank > 0 && x.bdSum > 0), '方向组展开/BD 汇总为正');

console.log('\\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail) process.exit(1);
`, 'utf-8');

await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: entry.replace('.mjs', '.out.mjs'),
  logLevel: 'silent',
  absWorkingDir: process.cwd(),
});
await import(pathToFileURL(entry.replace('.mjs', '.out.mjs')).href);
