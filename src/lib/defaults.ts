// 默认配置：机床、上/下模具库、材料（SPCC、SUS304 分开存 K 因子表）
import type { Settings, MaterialDef } from '../types';

const spcc: MaterialDef = {
  name: 'SPCC',
  tensileStrength: 340,
  yieldStrength: 210,
  vMinMult: 6,
  vMaxMult: 10,
  kTable: [
    { ratio: 0.5, k: 0.30 },
    { ratio: 1.0, k: 0.33 },
    { ratio: 2.0, k: 0.38 },
    { ratio: 3.0, k: 0.42 },
    { ratio: 5.0, k: 0.46 },
  ],
  angleFactorTable: [
    { angle: 30, factor: 1.45 },
    { angle: 45, factor: 1.25 },
    { angle: 60, factor: 1.12 },
    { angle: 90, factor: 1.00 },
    { angle: 120, factor: 0.85 },
    { angle: 150, factor: 0.65 },
  ],
};

const sus304: MaterialDef = {
  name: 'SUS304',
  tensileStrength: 620,
  yieldStrength: 275,
  vMinMult: 7,
  vMaxMult: 12,
  kTable: [
    { ratio: 0.5, k: 0.32 },
    { ratio: 1.0, k: 0.35 },
    { ratio: 2.0, k: 0.40 },
    { ratio: 3.0, k: 0.44 },
    { ratio: 5.0, k: 0.48 },
  ],
  angleFactorTable: [
    { angle: 30, factor: 1.50 },
    { angle: 45, factor: 1.28 },
    { angle: 60, factor: 1.14 },
    { angle: 90, factor: 1.00 },
    { angle: 120, factor: 0.84 },
    { angle: 150, factor: 0.62 },
  ],
};

const al5052: MaterialDef = {
  name: 'AL5052',
  tensileStrength: 230,
  yieldStrength: 170,
  vMinMult: 6,
  vMaxMult: 10,
  kTable: [
    { ratio: 0.5, k: 0.31 },
    { ratio: 1.0, k: 0.34 },
    { ratio: 2.0, k: 0.39 },
    { ratio: 3.0, k: 0.43 },
    { ratio: 5.0, k: 0.47 },
  ],
  angleFactorTable: [
    { angle: 30, factor: 1.4 },
    { angle: 45, factor: 1.22 },
    { angle: 60, factor: 1.1 },
    { angle: 90, factor: 1.0 },
    { angle: 120, factor: 0.86 },
    { angle: 150, factor: 0.66 },
  ],
};

export function defaultSettings(): Settings {
  return {
    machines: [
      {
        id: 'm_100t',
        name: 'WC67K-100T/3200 数控折弯机',
        ratedTonnage: 100,
        maxOpenHeight: 420,
        ramStroke: 180,
        rapidSpeed: 120,
        workSpeed: 9,
        returnSpeed: 90,
        eccentricLimitPct: 30,
        shutHeight: 260,
      },
      {
        id: 'm_160t',
        name: 'WE67K-160T/4000 电液伺服折弯机',
        ratedTonnage: 160,
        maxOpenHeight: 480,
        ramStroke: 220,
        rapidSpeed: 140,
        workSpeed: 10,
        returnSpeed: 110,
        eccentricLimitPct: 25,
        shutHeight: 300,
      },
    ],
    activeMachineId: 'm_100t',
    upperDies: [
      { id: 'u_goose', name: '鹅颈上模 H=120 R0.8', angle: 88, tipRadius: 0.8, height: 120 },
      { id: 'u_straight', name: '直剑上模 H=150 R1.0', angle: 88, tipRadius: 1.0, height: 150 },
      { id: 'u_small', name: '小尖上模 H=100 R0.3', angle: 30, tipRadius: 0.3, height: 100 },
    ],
    lowerDies: [
      { id: 'l_v6', name: 'V6 下模', vWidth: 6, angle: 88, minFlange: 5, height: 26, tonnageRated: 50 },
      { id: 'l_v8', name: 'V8 下模', vWidth: 8, angle: 88, minFlange: 7, height: 28, tonnageRated: 80 },
      { id: 'l_v10', name: 'V10 下模', vWidth: 10, angle: 88, minFlange: 8, height: 30, tonnageRated: 100 },
      { id: 'l_v12', name: 'V12 下模', vWidth: 12, angle: 88, minFlange: 10, height: 32, tonnageRated: 130 },
      { id: 'l_v16', name: 'V16 下模', vWidth: 16, angle: 88, minFlange: 13, height: 36, tonnageRated: 160 },
      { id: 'l_v20', name: 'V20 下模', vWidth: 20, angle: 88, minFlange: 16, height: 40, tonnageRated: 200 },
    ],
    materials: [spcc, sus304, al5052],
    defaultFingerClearance: 5,
    recycleDays: 7,
  };
}
