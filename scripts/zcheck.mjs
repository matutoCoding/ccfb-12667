import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
const root = process.cwd().replace(/\\/g, '/');
const entry = join(mkdtempSync(join(tmpdir(), 'bend-')), 'e.mjs');
writeFileSync(entry, `
import { buildSampleParts } from '${root}/src/lib/samples.ts';
import { buildFlatMesh, foldedVertices } from '${root}/src/lib/mesh.ts';
const parts = buildSampleParts();
for (const p of parts) {
  const mesh = buildFlatMesh(p);
  const prog = foldedVertices(p, mesh, p.bends.map(() => 1));
  const z = [];
  for (let i = 2; i < prog.length; i += 3) z.push(prog[i]);
  console.log(p.name, 'faces=', mesh.faces.length, 'Zmin=', Math.min(...z).toFixed(2), 'Zmax=', Math.max(...z).toFixed(2), 'dirs=', p.bends.map(b => b.direction).join(','));
}
`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: entry.replace('.mjs', '.out.mjs'), logLevel: 'silent', absWorkingDir: process.cwd() });
await import(pathToFileURL(entry.replace('.mjs', '.out.mjs')).href);
