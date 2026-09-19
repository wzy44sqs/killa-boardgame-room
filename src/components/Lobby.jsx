import React, { useState } from 'react';
import { loadRecent } from '../storage';

export default function Lobby({ error, connecting, onCreate, onJoin }) {
  const [nickname, setNickname] = useState('');
  const [roomId, setRoomId] = useState('');
  const [roomName, setRoomName] = useState('');
  const [roomIntro, setRoomIntro] = useState('');
  const [mode, setMode] = useState(null); // 'create' | 'join'
  const recent = loadRecent();

  return (
    <div className="lobby">
      <h2 className="lobby-title">Killa的桌游室</h2>
      {!mode && (
        <div className="lobby-buttons">
          <button className="btn btn-primary" onClick={() => setMode('create')}>创建房间</button>
          <button className="btn btn-primary" onClick={() => setMode('join')}>加入房间</button>
        </div>
      )}
      {mode && (
        <div className="lobby-form">
          {mode === 'create' && (
            <>
              <label className="field">
                <span>房间名</span>
                <input
                  value={roomName}
                  maxLength={20}
                  placeholder="例如：莉可丽丝"
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>房间简介（可选）</span>
                <input
                  value={roomIntro}
                  maxLength={60}
                  placeholder="一句话介绍这个房间"
                  onChange={(e) => setRoomIntro(e.target.value)}
                />
              </label>
            </>
          )}
          <label className="field">
            <span>你的昵称</span>
            <input
              value={nickname}
              maxLength={20}
              placeholder="输入昵称"
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          {mode === 'join' && (
            <label className="field">
              <span>房间号</span>
              <input
                value={roomId}
                maxLength={8}
                placeholder="例如 AB3K9Q"
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              />
            </label>
          )}
          {error && <div className="error-text">{error}</div>}
          <div className="lobby-buttons">
            <button
              className="btn btn-primary"
              disabled={connecting}
              onClick={() => (mode === 'create'
                ? onCreate(nickname, roomName, roomIntro)
                : onJoin(roomId, nickname))}
            >
              {connecting ? '连接中…' : mode === 'create' ? '创建并进入' : '加入房间'}
            </button>
            <button className="btn" disabled={connecting} onClick={() => setMode(null)}>返回</button>
          </div>
        </div>
      )}
      {!mode && recent.length > 0 && (
        <div className="recent">
          <div className="recent-title">最近进入的房间</div>
          {recent.map((r) => (
            <button
              key={r.roomId}
              className="recent-item"
              onClick={() => { setMode('join'); setRoomId(r.roomId); setNickname(r.nickname); }}
            >
              <span className="recent-id">{r.roomId}</span>
              <span className="recent-time">{new Date(r.ts).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
