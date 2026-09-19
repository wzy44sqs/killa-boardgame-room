import React, { useState } from 'react';
import { PALETTE } from '../wheel';

let sectorSeq = 0;
const newSector = () => ({
  id: ++sectorSeq,
  name: String(sectorSeq),
  size: 1,
  color: PALETTE[(sectorSeq - 1) % PALETTE.length],
});

export default function WheelSetup({ onSubmit, onClose }) {
  const [sectors, setSectors] = useState(() => [newSector(), newSector(), newSector(), newSector()]);
  const [allowRepeat, setAllowRepeat] = useState(false);
  const [oneDrawPerRole, setOneDrawPerRole] = useState(true);

  const update = (id, patch) =>
    setSectors((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const submit = () => {
    const valid = sectors.filter((s) => s.name.trim() && Number(s.size) > 0);
    if (valid.length < 2) return;
    onSubmit({
      sectors: valid.map((s) => ({ name: s.name.trim(), size: Number(s.size), color: s.color })),
      allowRepeat,
      oneDrawPerRole,
    });
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>创建轮盘抽签</h3>
        <div className="sector-list">
          {sectors.map((s) => (
            <div className="sector-row" key={s.id}>
              <input
                className="sector-name"
                value={s.name}
                maxLength={12}
                placeholder="名称"
                onChange={(e) => update(s.id, { name: e.target.value })}
              />
              <input
                className="sector-size"
                type="number"
                min="0.1"
                step="0.1"
                value={s.size}
                title="区域大小（权重）"
                onChange={(e) => update(s.id, { size: e.target.value })}
              />
              <div className="color-picks">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    className={`color-pick ${s.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => update(s.id, { color: c })}
                  />
                ))}
              </div>
              <button
                className="btn btn-small"
                disabled={sectors.length <= 2}
                onClick={() => setSectors((list) => list.filter((x) => x.id !== s.id))}
              >删</button>
            </div>
          ))}
        </div>
        <button className="btn btn-small" onClick={() => setSectors((l) => [...l, newSector()])}>
          + 添加区域
        </button>
        <label className="check-row">
          <input type="checkbox" checked={allowRepeat} onChange={(e) => setAllowRepeat(e.target.checked)} />
          允许重复抽取（勾选后抽中的区域保留，否则抽中即移除、其余区域等比放大）
        </label>
        <label className="check-row">
          <input type="checkbox" checked={oneDrawPerRole} onChange={(e) => setOneDrawPerRole(e.target.checked)} />
          每个角色（含虚拟角色）只能抽一次
        </label>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={submit} disabled={sectors.filter((s) => s.name.trim() && Number(s.size) > 0).length < 2}>
            开始抽签
          </button>
          <button className="btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
