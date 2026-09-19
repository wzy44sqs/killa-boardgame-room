// 纯前端无法直接写本地文件夹，这里用 localStorage 按房间号分键保存，
// 另提供“导出记录”下载为 房间号-聊天记录.txt。

const CHAT_LIMIT = 400;

function safeSet(key, value, trim) {
  let v = value;
  for (let i = 0; i < 5; i++) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
      return true;
    } catch {
      v = trim ? trim(v) : null;
      if (!v) return false;
    }
  }
  return false;
}

export function loadRoomState(roomId) {
  try {
    const raw = localStorage.getItem(`killa:room:${roomId}:state`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveRoomState(roomId, state) {
  safeSet(`killa:room:${roomId}:state`, state, (v) => {
    // 空间不足时优先丢弃图片
    if (v.mainImage) return { ...v, mainImage: null };
    if (v.bgImage) return { ...v, bgImage: null };
    return null;
  });
}

export function loadChat(roomId) {
  try {
    const raw = localStorage.getItem(`killa:room:${roomId}:chat`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveChat(roomId, msgs) {
  const trimmed = msgs.slice(-CHAT_LIMIT);
  safeSet(`killa:room:${roomId}:chat`, trimmed, (v) => {
    // 空间不足时把最早的图片消息替换为占位
    const idx = v.findIndex((m) => m.kind === 'image');
    if (idx >= 0) {
      const next = v.slice();
      next[idx] = { ...next[idx], kind: 'text', text: '[图片因存储空间不足未保存]' };
      return next;
    }
    return v.slice(Math.floor(v.length / 2));
  });
}

export function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem('killa:recent') || '[]');
  } catch {
    return [];
  }
}

export function pushRecent(roomId, nickname) {
  const list = loadRecent().filter((r) => r.roomId !== roomId);
  list.unshift({ roomId, nickname, ts: Date.now() });
  try {
    localStorage.setItem('killa:recent', JSON.stringify(list.slice(0, 8)));
  } catch { /* ignore */ }
}

export function exportChat(roomId, msgs) {
  const lines = msgs.map((m) => {
    const time = new Date(m.ts).toLocaleString();
    if (m.kind === 'system') return `[${time}] 【系统】${m.text}`;
    if (m.kind === 'result') return `[${time}] 【抽签结果】${m.text}`;
    if (m.kind === 'image') return `[${time}] ${m.fromName}: [图片]`;
    return `[${time}] ${m.fromName}: ${m.text}`;
  });
  const blob = new Blob([`房间号: ${roomId}\n\n` + lines.join('\n')], {
    type: 'text/plain;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${roomId}-聊天记录.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
