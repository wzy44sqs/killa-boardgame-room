// 轮盘角度与结果计算。轮盘指针固定在正上方（屏幕坐标 -90°）。

export const TAU = Math.PI * 2;

export const PALETTE = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#22d3ee', '#818cf8', '#e879f9', '#f472b6',
];

export function normAngle(a) {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}

// 每个区域的起止角（轮盘自身坐标系，按 size 等比占满整圆）
export function sectorBounds(sectors) {
  const total = sectors.reduce((s, x) => s + Number(x.size || 0), 0) || 1;
  let acc = 0;
  return sectors.map((s) => {
    const start = acc;
    const width = (Number(s.size || 0) / total) * TAU;
    acc += width;
    return { start, end: acc };
  });
}

// 给定轮盘旋转角 rot，返回指针指向的区域下标（相对 sectors 数组）
export function sectorAtRotation(sectors, rot) {
  const bounds = sectorBounds(sectors);
  const pointerWheelAngle = normAngle(-Math.PI / 2 - rot);
  for (let i = 0; i < bounds.length; i++) {
    if (pointerWheelAngle >= bounds[i].start && pointerWheelAngle < bounds[i].end) return i;
  }
  return bounds.length - 1;
}

// 松手后由当前角度与角速度计算最终角度（含随机圈数，保证不可预测）
export function computeSpin(rot, velocity) {
  const dir = velocity < -0.2 ? -1 : 1;
  const speedBoost = Math.min(Math.abs(velocity) * 0.9, TAU * 3);
  const baseTurns = TAU * (3 + Math.random() * 2);
  const delta = dir * (baseTurns + speedBoost + Math.random() * TAU);
  const finalAngle = rot + delta;
  const duration = 3000 + Math.min(Math.abs(delta) / TAU, 6) * 400;
  return { startAngle: rot, finalAngle, duration };
}

// 与两端一致的缓动函数，保证动画终点角度一致
export function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}
