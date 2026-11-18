// 手动验证 U 形折叠的旋转链
// 面0: x∈[160,200] 固定；线1 x=160；面1: x∈[40,160]；线2 x=40；面2: x∈[0,40]
// 绕 Y 轴旋转 θ：Ry(θ) 对向量 (x,0,0) 的作用：x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ
// 面1 相对面0 绕 x=160 的 Y 轴转 +90°
function rotY(p, pivot, deg) {
  const t = deg * Math.PI / 180;
  const dx = p.x - pivot.x, dz = p.z - pivot.z;
  return {
    x: pivot.x + dx * Math.cos(t) + dz * Math.sin(t),
    z: pivot.z - dx * Math.sin(t) + dz * Math.cos(t),
  };
}
// 面1 上 x=40 线的点，相对 x=160 距离 -120
const line2AfterBend1 = rotY({ x: 40, z: 0 }, { x: 160, z: 0 }, 90);
console.log('折完刀1后，刀2线位置:', line2AfterBend1); // 期望 (160, 120)
// 面2 要成为另一个法兰：从刀2线再折90°，使其与面0平行。
// 试 +90°（同向）：面2上 x=0 点先随面1变换，再绕刀2线（已在(160,120)）转
const p0 = rotY({ x: 0, z: 0 }, { x: 160, z: 0 }, 90);
console.log('面2远点随刀1后:', p0);
const p0b = rotY(p0, line2AfterBend1, 90);
console.log('再绕刀2转+90:', p0b);
const p0c = rotY(p0, line2AfterBend1, -90);
console.log('再绕刀2转-90:', p0c);
// U 形期望面2落在 z=120 高度且 x≈200 附近（与面0平行朝上开口）
