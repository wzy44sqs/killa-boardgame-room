import React, { useEffect, useRef, useState } from 'react';
import { compressImage } from '../utils';

const PAGE = 30;

export default function ChatPanel({
  chat, isHost, nickname, roles, currentRoleKey, myRoleKey, avatars,
  onSendText, onSendImage, onSwitchRole, onAddRole, onRemoveRole,
  onImageClick,
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [text, setText] = useState('');
  const [showRoleMgr, setShowRoleMgr] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const nearBottomRef = useRef(true);

  const visible = chat.slice(-visibleCount);
  const hasMore = chat.length > visibleCount;

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  useEffect(() => {
    const el = listRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = () => {
    if (!text.trim()) return;
    onSendText(text);
    setText('');
    nearBottomRef.current = true;
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await compressImage(file, 1000, 0.8);
      onSendImage(dataUrl);
    } catch { /* ignore */ }
  };

  const myName = (key) => {
    if (key === 'p:host') return nickname;
    const r = roles.find((x) => x.key === key);
    return r ? r.name : nickname;
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">聊天室</div>

      {isHost && (
        <div className="role-bar">
          <span className="role-label">当前角色：</span>
          <div className="role-chips">
            <button
              className={`role-chip ${(!currentRoleKey || currentRoleKey === 'p:host') ? 'active' : ''}`}
              onClick={() => onSwitchRole('p:host')}
            >{nickname}（本人）</button>
            {roles.map((r) => (
              <button
                key={r.key}
                className={`role-chip ${currentRoleKey === r.key ? 'active' : ''}`}
                onClick={() => onSwitchRole(r.key)}
              >{r.name}</button>
            ))}
          </div>
          <button className="btn btn-small" onClick={() => setShowRoleMgr((v) => !v)}>管理角色</button>
        </div>
      )}
      {isHost && showRoleMgr && (
        <div className="role-mgr">
          <div className="role-add">
            <input
              value={newRoleName}
              maxLength={20}
              placeholder="虚拟角色名"
              onChange={(e) => setNewRoleName(e.target.value)}
            />
            <button
              className="btn btn-small"
              onClick={() => { onAddRole(newRoleName); setNewRoleName(''); }}
            >添加</button>
          </div>
          {roles.map((r) => (
            <div key={r.key} className="role-row">
              <span>{r.name}</span>
              <button className="btn btn-small" onClick={() => onRemoveRole(r.key)}>删除</button>
            </div>
          ))}
          {roles.length === 0 && <div className="role-empty">还没有虚拟角色</div>}
        </div>
      )}

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {hasMore && (
          <button className="load-more" onClick={() => setVisibleCount((c) => c + PAGE)}>
            加载更早的消息（还有 {chat.length - visibleCount} 条）
          </button>
        )}
        {visible.map((m) => {
          if (m.kind === 'system' || m.kind === 'result') {
            return (
              <div key={m.id} className={`msg ${m.kind}`}>
                <span>{m.text}</span>
                <span className="msg-time">{new Date(m.ts).toLocaleTimeString()}</span>
              </div>
            );
          }
          const mine = isHost
            ? (m.fromKey === 'p:host' || roles.some((r) => r.key === m.fromKey))
            : m.fromKey === myRoleKey;
          const avatar = avatars?.[m.fromKey];
          const avatarEl = (
            <span
              className={`msg-avatar ${avatar?.full ? 'clickable' : ''}`}
              title={avatar?.full ? '点击查看完整形象' : undefined}
              onClick={() => { if (avatar?.full) onImageClick(avatar.full); }}
            >
              {avatar?.square
                ? <img src={avatar.square} alt={m.fromName} />
                : <span className="msg-avatar-fallback">{String(m.fromName || '?')[0]}</span>}
            </span>
          );
          return (
            <div key={m.id} className={`msg ${mine ? 'mine' : 'theirs'}`}>
              {!mine && avatarEl}
              <div className="msg-body">
                <div className="msg-name">{m.fromName}</div>
                {m.kind === 'image' ? (
                  <img
                    className="msg-image"
                    src={m.dataUrl}
                    alt="图片"
                    onClick={() => onImageClick(m.dataUrl)}
                  />
                ) : (
                  <div className="msg-bubble">{m.text}</div>
                )}
                <div className="msg-time">{new Date(m.ts).toLocaleTimeString()}</div>
              </div>
              {mine && avatarEl}
            </div>
          );
        })}
        {chat.length === 0 && <div className="chat-empty">还没有消息，打个招呼吧</div>}
      </div>

      <div className="chat-input">
        <button className="btn btn-small" title="发送图片" onClick={() => fileRef.current?.click()}>图</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={pickImage}
        />
        <input
          value={text}
          placeholder={isHost ? `以「${myName(currentRoleKey || 'p:host')}」的身份发言` : '输入消息'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
        <button className="btn btn-primary btn-small" onClick={send}>发送</button>
      </div>
    </div>
  );
}
