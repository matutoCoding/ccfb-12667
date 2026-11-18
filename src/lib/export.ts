// 导出：折弯机程序文件（每刀角度+挡料坐标）、JSON 图纸、PDF 工艺单（自研写入器，零依赖）
import type { Part, Settings, BendCheck, SimStep } from '../types';
import { calcBend, bendGeometry } from './bendMath';
import { buildLoops } from './geometry';

function download(filename: string, content: string | Blob, mime = 'application/octet-stream'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportPartJson(part: Part): void {
  download(`${part.model}_${part.name}.json`, JSON.stringify({ app: 'bend-system', version: 1, part }, null, 2), 'application/json');
}

/** 折弯机可读程序文件：每刀角度、下模 V 槽、后挡料 X、挡指避让、吨位 */
export function exportPressProgram(part: Part, settings: Settings, checks: BendCheck[], sims: SimStep[]): void {
  const machine = settings.machines.find((m) => m.id === settings.activeMachineId);
  const lines: string[] = [];
  lines.push('( ============================================ )');
  lines.push('(  折弯机程序  本系统导出  本地生成无外部接口 )');
  lines.push(`(  机型: ${machine?.name ?? '未知'}  额定: ${machine?.ratedTonnage ?? '?'}T )`);
  lines.push(`(  零件: ${part.model} ${part.name}  材料: ${part.material} T=${part.thickness}mm )`);
  lines.push(`(  生成时间: ${new Date().toLocaleString('zh-CN')} )`);
  lines.push('( ============================================ )');
  lines.push(`O${(part.model.replace(/\W/g, '') || 'PART').slice(0, 8)}`);
  lines.push(`G90 G21 (绝对坐标 毫米)`);
  lines.push(`M300 (机床复位)`);
  part.bends.forEach((b, i) => {
    const die = settings.lowerDies.find((d) => d.id === b.lowerDieId);
    const upper = settings.upperDies.find((d) => d.id === b.upperDieId);
    const sim = sims[i];
    const chk = checks[i];
    lines.push('( ------------------------------ )');
    lines.push(`N${10 + i * 10} (刀次 ${i + 1})`);
    lines.push(`G00 X${sim?.gaugeX.toFixed(2) ?? '0.00'} (后挡料X定位)`);
    lines.push(`G00 Y0.00 (挡指基准)`);
    lines.push(`M210 F${sim?.fingerClearance.toFixed(1) ?? '5.0'} (挡指避让距离mm)`);
    lines.push(`G01 A${b.angle.toFixed(2)} (折弯角度 方向${b.direction > 0 ? '正向↑' : '反向↓'})`);
    lines.push(`( 内R=${b.innerRadius.toFixed(2)} 上模=${upper?.name ?? '未选'} 下模=${die?.name ?? '未选'} V=${die?.vWidth ?? '?'} )`);
    lines.push(`( 预估压力=${sim?.tonnagePeak.toFixed(2) ?? '0.00'}T 负载率=${chk ? (chk.tonnageRatio * 100).toFixed(0) : '?'}% )`);
    lines.push(`M100 (执行工进折弯)`);
    lines.push(`G00 Y${(sim?.returnDist ?? 0).toFixed(2)} (回程)`);
  });
  lines.push('( ====== 程序结束 ====== )');
  lines.push('M30');
  download(`${part.model}_折弯程序.txt`, lines.join('\r\n'), 'text/plain');
}

// ---------- 极简 PDF 写入器（嵌入 JPEG，单页/多页 A4） ----------
function jpegFromCanvas(canvas: HTMLCanvasElement, quality = 0.92): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const bin = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function exportPdfFromCanvases(canvases: HTMLCanvasElement[], filename: string): void {
  const objects: string[] = [];
  const binaries: Uint8Array[] = [];

  // 对象 1：目录；2：页树；页面/内容/图片对象随后
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const pageCount = canvases.length;
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  const imageObjNums: number[] = [];
  let nextNum = 3;
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(nextNum++);
    contentObjNums.push(nextNum++);
    imageObjNums.push(nextNum++);
  }
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Count ${pageCount} /Kids [ ${kids} ] >>`);

  canvases.forEach((canvas, i) => {
    const w = canvas.width, h = canvas.height;
    const img = jpegFromCanvas(canvas);
    binaries.push(img);
    // A4 纵向 595 x 842 pt，图片铺满
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${imageObjNums[i]} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`,
    );
    const stream = `q 595 0 0 842 0 0 cm /Im${i} Do Q`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>`);
  });

  // 组装字节（二进制对象直接拼接）
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const header = enc.encode('%PDF-1.4\n%\xff\xff\xff\xff\n');
  chunks.push(header);
  const offsets: number[] = [];
  let pos = header.length;
  const pushBytes = (b: Uint8Array) => { chunks.push(b); pos += b.length; };
  const pushStr = (s: string) => pushBytes(enc.encode(s));

  for (let i = 0; i < objects.length; i++) {
    const objNum = i + 1;
    offsets.push(pos);
    pushStr(`${objNum} 0 obj\n`);
    if (imageObjNums.includes(objNum)) {
      const binIndex = imageObjNums.indexOf(objNum);
      pushStr(objects[i].split(' >>')[0]);
      pushStr(' >>\nstream\n');
      pushBytes(binaries[binIndex]);
      pushStr('\nendstream\nendobj\n');
    } else {
      pushStr(objects[i] + '\nendobj\n');
    }
  }
  const xrefStart = pos;
  const xrefLines: string[] = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (const off of offsets) xrefLines.push(`${String(off).padStart(10, '0')} 00000 n \n`);
  xrefLines.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  pushStr(xrefLines.join(''));

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const merged = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { merged.set(c, o); o += c.length; }
  download(filename, new Blob([merged], { type: 'application/pdf' }), 'application/pdf');
}

/** 把工艺单 DOM 内容绘制到 A4 画布（中文直接走系统字体，无乱码） */
export function buildProcessSheetCanvases(part: Part, settings: Settings, checks: BendCheck[], sims: SimStep[]): HTMLCanvasElement[] {
  const W = 1240, H = 1754; // 150dpi A4
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('钣金折弯工艺单', 60, 70);
  ctx.font = '20px sans-serif';
  const machine = settings.machines.find((m) => m.id === settings.activeMachineId);
  const head: [string, string][] = [
    ['产品型号', part.model], ['零件名称', part.name],
    ['材料牌号', part.material], ['料厚 mm', String(part.thickness)],
    ['机床', machine?.name ?? ''], ['额定吨位', `${machine?.ratedTonnage ?? ''} t`],
    ['折弯刀数', String(part.bends.length)], ['生成时间', new Date().toLocaleString('zh-CN')],
  ];
  let y = 120;
  head.forEach(([k, val], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 60 + col * 580;
    const yy = y + row * 40;
    ctx.fillStyle = '#555';
    ctx.fillText(`${k}：`, x, yy);
    ctx.fillStyle = '#111';
    ctx.fillText(val, x + 110, yy);
  });
  y += 120;

  // 表格
  const cols = [60, 130, 220, 320, 420, 540, 680, 820, 960, 1100, 1180];
  const headers = ['刀次', '角度°', '内R', '上模', '下模/V', '定位X', '避让', '压力t', '负载%', '校验', ''];
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#eef2f6';
  ctx.fillRect(50, y - 24, W - 100, 36);
  ctx.fillStyle = '#111';
  headers.slice(0, 10).forEach((h, i) => ctx.fillText(h, cols[i] + 6, y));
  y += 30;
  ctx.font = '17px sans-serif';
  const loops = buildLoops(part.entities);
  const outer = loops.loops[0] ?? [];
  part.bends.forEach((b, i) => {
    const die = settings.lowerDies.find((d) => d.id === b.lowerDieId);
    const upper = settings.upperDies.find((d) => d.id === b.upperDieId);
    const chk = checks[i];
    const sim = sims[i];
    const calc = calcBend(b, settings.materials.find((m) => m.name === part.material)!, part.thickness);
    const line = part.bendLines.find((bl) => bl.id === b.bendLineId);
    const geo = line ? bendGeometry(line, outer) : null;
    const ok = chk?.messages.length === 0;
    const row = [
      String(i + 1),
      `${b.angle.toFixed(1)}${b.direction > 0 ? '↑' : '↓'}`,
      b.innerRadius.toFixed(1),
      (upper?.name ?? '未选').slice(0, 8),
      die ? `V${die.vWidth}` : '未选',
      sim?.gaugeX.toFixed(1) ?? geo?.gaugeX.toFixed(1) ?? '-',
      sim?.fingerClearance.toFixed(1) ?? '-',
      sim?.tonnagePeak.toFixed(2) ?? '-',
      chk ? `${(chk.tonnageRatio * 100).toFixed(0)}` : '-',
      ok ? '合格' : chk?.messages[0]?.slice(0, 12) ?? '-',
    ];
    ctx.fillStyle = ok ? '#111' : '#c62828';
    row.forEach((t, ci) => ctx.fillText(t, cols[ci] + 6, y));
    ctx.fillStyle = '#ddd';
    ctx.fillRect(50, y + 8, W - 100, 1);
    y += 34;
    if (y > H - 260) return; // 单页容量保护
  });

  // 汇总与展开校核
  y += 20;
  ctx.fillStyle = '#111';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('展开与节拍汇总', 60, y);
  y += 34;
  ctx.font = '17px sans-serif';
  const totalBA = part.bends.reduce((s, b) => {
    const mat = settings.materials.find((m) => m.name === part.material)!;
    return s + calcBend(b, mat, part.thickness).BA;
  }, 0);
  const totalBD = part.bends.reduce((s, b) => {
    const mat = settings.materials.find((m) => m.name === part.material)!;
    return s + calcBend(b, mat, part.thickness).BD;
  }, 0);
  const totalTime = sims.reduce((s, x) => s + x.rapidTime + x.workTime + x.returnTime, 0);
  const peak = Math.max(0, ...sims.map((s) => s.tonnagePeak));
  const summary = [
    `折弯余量 BA 合计：${totalBA.toFixed(2)} mm`,
    `折弯扣除 BD 合计：${totalBD.toFixed(2)} mm`,
    `加工节拍：${totalTime.toFixed(1)} s，峰值吨位：${peak.toFixed(2)} t`,
    part.manualFlatLength != null ? `手工展开校核：${part.manualFlatLength.toFixed(2)} mm（系统按 BA 法逐刀计算，见编辑页对照）` : '手工展开校核：未填写',
  ];
  summary.forEach((t) => { ctx.fillStyle = '#333'; ctx.fillText(t, 60, y); y += 30; });

  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#888';
  ctx.fillText('本工艺单由浏览器本地系统生成，所有计算未经过外部接口。审核：__________  日期：__________', 60, H - 60);
  return [canvas];
}
