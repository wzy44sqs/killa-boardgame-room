import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TAU, sectorBounds, computeSpin, easeOutQuint } from '../wheel';

const SIZE = 480;

function drawWheel(ctx, rot, sectors) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = SIZE / 2 - 12;
  ctx.clearRect(0, 0, SIZE, SIZE);

  const bounds = sectorBounds(sectors);
  sectors.forEach((s, i) => {
    const start = bounds[i].start + rot;
    const end = bounds[i].end + rot;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, start, end);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 名称沿半径方向绘制
    const mid = (start + end) / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(mid);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 18px sans-serif';
    let name = String(s.name);
    if (name.length > 8) name = name.slice(0, 8) + '…';
    ctx.fillText(name, R - 16, 0);
    ctx.restore();
  });

  // 中心圆
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, TAU);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = '#d1d5db';
  ctx.stroke();

  // 顶部指针
  ctx.beginPath();
  ctx.moveTo(cx, 2);
  ctx.lineTo(cx - 13, 26);
  ctx.lineTo(cx + 13, 26);
  ctx.closePath();
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.strokeStyle = '#b91c1c';
  ctx.stroke();
}

export default function WheelPanel({ wheel, myRoleKey, myRoleName, isHost, onRequestSpin, onEndWheel }) {
  const canvasRef = useRef(null);
  const rotRef = useRef(0);
  const dragRef = useRef(null);
  const animRef = useRef(null);
  const [armed, setArmed] = useState(false);

  const sectors = wheel.remaining.map((i) => wheel.config.sectors[i]);
  const spinning = !!wheel.spin;
  const alreadyDrew = wheel.config.oneDrawPerRole && wheel.drawnRoles.includes(myRoleKey);
  const canDraw = !spinning && wheel.remaining.length > 0 && !alreadyDrew;

  const redraw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawWheel(ctx, rotRef.current, sectors);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheel.remaining, wheel.config]);

  // 播放同步转动动画：所有端从相同起点转到相同终点
  useEffect(() => {
    const spin = wheel.spin;
    if (!spin) {
      redraw();
      return undefined;
    }
    setArmed(false);
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / spin.duration);
      rotRef.current = spin.startAngle + (spin.finalAngle - spin.startAngle) * easeOutQuint(t);
      redraw();
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [wheel.spin, redraw]);

  // 区域被移除后轮盘重绘
  useEffect(() => { redraw(); }, [redraw]);

  const angleFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - SIZE / 2;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - SIZE / 2;
    return Math.atan2(y, x);
  };

  const onPointerDown = (e) => {
    if (!armed || !canDraw) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    dragRef.current = { lastAngle: angleFromEvent(e), vel: 0, lastT: performance.now() };
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const a = angleFromEvent(e);
    let delta = a - drag.lastAngle;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.vel = drag.vel * 0.7 + (delta / dt) * 1000 * 0.3;
    drag.lastAngle = a;
    drag.lastT = now;
    rotRef.current += delta;
    redraw();
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setArmed(false);
    const params = computeSpin(rotRef.current, drag.vel);
    onRequestSpin(params);
  };

  return (
    <div className="wheel-panel">
      <div className="wheel-info">
        <span className="wheel-tag">{wheel.config.allowRepeat ? '允许重复抽取' : '不重复（抽中区域移除）'}</span>
        <span className="wheel-tag">{wheel.config.oneDrawPerRole ? '每个角色限抽一次' : '角色可多次抽取'}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className={`wheel-canvas ${armed ? 'armed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="wheel-status">
        {spinning && `【${wheel.spin.byName}】抽签中…`}
        {!spinning && armed && '请按住轮盘拖动，然后松手！'}
        {!spinning && !armed && canDraw && `轮到你了（${myRoleName}），点击“抽签”后拖动轮盘`}
        {!spinning && !armed && !canDraw && !alreadyDrew && '等待他人抽签…'}
        {!spinning && alreadyDrew && '你当前的角色已经抽过了'}
      </div>
      <div className="wheel-actions">
        {!spinning && canDraw && !armed && (
          <button className="btn btn-primary" onClick={() => setArmed(true)}>抽签</button>
        )}
        {isHost && (
          <button className="btn btn-danger" onClick={onEndWheel} disabled={spinning}>结束抽签</button>
        )}
      </div>
      {wheel.config.oneDrawPerRole && wheel.drawnRoles.length > 0 && (
        <div className="wheel-drawn">已抽取：{wheel.drawnRoles.length} 个角色</div>
      )}
    </div>
  );
}
