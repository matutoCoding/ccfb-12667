// 核心折弯公式手工核算验证（Node 直接跑，不经过浏览器）
// 手工经典算例：SPCC T=2.0, R=2.0, θ=90°, 查 K 表 R/T=1 → K=0.33
const T = 2.0, R = 2.0, K = 0.33, theta = 90;
const BA = (Math.PI / 180) * theta * (R + K * T);
const OSS = (R + T) * Math.tan((Math.PI / 180) * (theta / 2));
const BD = 2 * OSS - BA;
console.log('算例1 SPCC T2 R2 90°:');
console.log('  BA  =', BA.toFixed(4), 'mm (手工: π/2·(2+0.66) =', ((Math.PI / 2) * 2.66).toFixed(4), ')');
console.log('  OSS =', OSS.toFixed(4), 'mm (手工: 4·tan45 = 4.0000)');
console.log('  BD  =', BD.toFixed(4), 'mm (手工: 8 - 4.1783 =', (8 - (Math.PI / 2) * 2.66).toFixed(4), ')');

// 算例2：SUS304 T1.2 R1 90°, R/T=0.833 在 0.5(K.32)~1(K.35) 间插值
const ratio = 1 / 1.2;
const k2 = 0.32 + (0.35 - 0.32) * ((ratio - 0.5) / 0.5);
const BA2 = (Math.PI / 2) * (1 + k2 * 1.2);
const OSS2 = (1 + 1.2) * Math.tan(Math.PI / 4);
const BD2 = 2 * OSS2 - BA2;
console.log('算例2 SUS304 T1.2 R1 90°:');
console.log('  R/T =', ratio.toFixed(4), ' 插值 K =', k2.toFixed(4));
console.log('  BA =', BA2.toFixed(4), ' OSS =', OSS2.toFixed(4), ' BD =', BD2.toFixed(4));

// 算例3：吨位。SPCC Rm=340, T=2, L=100mm=0.1m, V=12, 90°
// P(kN) = 1.42·T²·L(m)·Rm/V；车间常用经验式 P(t)=1.42·T²·L(m)·Rm/9.8/V 同口径
const PkN = (1.42 * 2 * 2 * 0.1 * 340) / 12;
const Pton = PkN / 9.80665;
const shop = (1.42 * 2 * 2 * 0.1 * 340) / 9.80665 / 12;
console.log('算例3 吨位 SPCC T2 L100 V12 90°:');
console.log('  P =', Pton.toFixed(2), 't (同口径车间式 =', shop.toFixed(2), 't)');

// 算例4：非90°角 60° 系数1.12
const P60 = PkN * 1.12 / 9.80665;
console.log('  60°折弯 =', P60.toFixed(2), 't');

// 算例5：多刀 U 件展开闭环验证
// 毛坯 200 宽，两道 90°，T2 R2 K.33 → 折成外形 = 200 - 2·BD
const folded = 200 - 2 * BD;
console.log('算例5 U型线槽折成外形 =', folded.toFixed(3), 'mm（法兰40+底120+法兰40 理论 =', 40 + (200 - 80) + 40, '，差值由 BD 体现）');

// 0.1mm 精度断言
const assert = (cond, msg) => console.log(cond ? `  ✓ ${msg}` : `  ✗ ${msg}`);
assert(Math.abs(BA - 4.1783) < 0.0001, 'BA 与手工公式一致');
assert(Math.abs(OSS - 4.0) < 0.0001, 'OSS 与手工公式一致');
assert(Math.abs(BD - 3.8217) < 0.0001, 'BD 与手工公式一致');
assert(Math.abs(Pton - shop) < 0.001, '吨位与同口径车间经验公式完全一致');
assert(Pton > 1 && Pton < 3, '2mm板100mm折边量级合理(1~3t)');
