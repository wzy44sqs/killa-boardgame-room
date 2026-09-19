import React, { useEffect, useRef, useState } from 'react';
import ChatPanel from './ChatPanel';
import WheelPanel from './WheelPanel';
import WheelSetup from './WheelSetup';
import CropModal from './CropModal';
import { compressImage } from '../utils';
import { exportChat } from '../storage';

export default function Room({
  session, myRoleKey,
  onLeave, onSendText, onSendImage,
  onAddRole, onRemoveRole, onSwitchRole,
  onCreateWheel, onEndWheel, onRequestSpin,
  onSetBg, onSetMain, onSetAvatar, onDismissNotice,
}) {
  const [showWheelSetup, setShowWheelSetup] = useState(false);
  const [showMain, setShowMain] = useState(false);
  const [showAvatars, setShowAvatars] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [copied, setCopied] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);       // {dataUrl, targetKey}
  const [avatarTarget, setAvatarTarget] = useState(null);
  const bgInputRef = useRef(null);
  const mainInputRef = useRef(null);
  const avatarInputRef = useRef(null);

  const { isHost, roomId, nickname, players, roles, currentRoleKey, wheel, avatars } = session;
  const closed = session.status === 'closed';

  // 房主上传主图后，所有端弹出展示
  const seenVersionRef = useRef(session.mainImageVersion);
  useEffect(() => {
    if (session.mainImageVersion !== seenVersionRef.current) {
      seenVersionRef.current = session.mainImageVersion;
      if (session.mainImage) setShowMain(true);
    }
  }, [session.mainImageVersion, session.mainImage]);

  const currentRole = roles.find((r) => r.key === currentRoleKey);
  const myRoleName = isHost ? (currentRole ? currentRole.name : nickname) : nickname;

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const pickBg = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { onSetBg(await compressImage(file, 1600, 0.8)); } catch { /* ignore */ }
  };

  const pickMain = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { onSetMain(await compressImage(file, 1400, 0.82)); } catch { /* ignore */ }
  };

  // 形象上传：先压缩为完整图，再进入裁剪框选头像
  const pickAvatar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !avatarTarget) return;
    try {
      const dataUrl = await compressImage(file, 1000, 0.85);
      setCropSrc({ dataUrl, targetKey: avatarTarget });
    } catch { /* ignore */ }
  };

  // 所有可设置形象的角色：房主本人 + 虚拟角色 + 玩家
  const avatarTargets = [
    { key: 'p:host', name: `${nickname}（房主本人）` },
    ...roles.map((r) => ({ key: r.key, name: r.name })),
    ...players.filter((p) => p.id !== 'host').map((p) => ({ key: `p:${p.id}`, name: p.nickname })),
  ];

  const roomStyle = session.bgImage
    ? { backgroundImage: `url(${session.bgImage})` }
    : undefined;

  return (
    <div className="room" style={roomStyle}>
      <div className="room-overlay">
        <header className="room-header">
          <div className="room-meta">
            <div className="room-title-block">
              <span className="room-name">{session.roomName || '未命名房间'}</span>
              {session.roomIntro && <span className="room-intro">{session.roomIntro}</span>}
            </div>
            <button className="room-id" title="点击复制房间号" onClick={copyRoomId}>
              房间号 {roomId}{copied ? ' ✓' : ''}
            </button>
            <span className="room-me">{nickname}{isHost ? '（房主）' : ''}</span>
          </div>
          <div className="room-actions">
            {isHost && (
              <>
                <button className="btn btn-small" onClick={() => setShowWheelSetup(true)} disabled={!!wheel || closed}>
                  创建抽签
                </button>
                <button className="btn btn-small" onClick={() => setShowAvatars(true)}>角色形象</button>
                <button className="btn btn-small" onClick={() => bgInputRef.current?.click()}>背景图</button>
                <button className="btn btn-small" onClick={() => mainInputRef.current?.click()}>主图</button>
              </>
            )}
            {session.mainImage && (
              <button className="btn btn-small" onClick={() => setShowMain(true)}>查看主图</button>
            )}
            <button className="btn btn-small" onClick={() => exportChat(roomId, session.chat)}>导出记录</button>
            <button className="btn btn-small btn-danger" onClick={onLeave}>退出房间</button>
          </div>
          <input ref={bgInputRef} type="file" accept="image/*" hidden onChange={pickBg} />
          <input ref={mainInputRef} type="file" accept="image/*" hidden onChange={pickMain} />
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
        </header>

        <div className="room-body">
          <main className="room-main">
            {wheel ? (
              <WheelPanel
                wheel={wheel}
                myRoleKey={myRoleKey}
                myRoleName={myRoleName}
                isHost={isHost}
                onRequestSpin={onRequestSpin}
                onEndWheel={onEndWheel}
              />
            ) : (
              <div className="room-placeholder">
                <h3>{session.roomName || `房间 ${roomId}`}</h3>
                <p>把房间号告诉伙伴即可加入。房主可在右侧创建虚拟角色、发起轮盘抽签。</p>
                <div className="player-list">
                  {players.map((p) => (
                    <span key={p.id} className={`player-tag ${p.connected ? '' : 'offline'}`}>
                      {p.nickname}{p.id === 'host' ? '（房主）' : ''}{p.connected ? '' : '（已离开）'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </main>
          <ChatPanel
            chat={session.chat}
            isHost={isHost}
            nickname={nickname}
            roles={roles}
            currentRoleKey={currentRoleKey}
            myRoleKey={myRoleKey}
            avatars={avatars}
            wheelActive={!!wheel}
            onSendText={onSendText}
            onSendImage={onSendImage}
            onSwitchRole={onSwitchRole}
            onAddRole={onAddRole}
            onRemoveRole={onRemoveRole}
            onImageClick={setLightbox}
          />
        </div>
      </div>

      {showWheelSetup && (
        <WheelSetup
          onClose={() => setShowWheelSetup(false)}
          onSubmit={(config) => { onCreateWheel(config); setShowWheelSetup(false); }}
        />
      )}

      {showAvatars && (
        <div className="modal-mask" onClick={() => setShowAvatars(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>角色形象管理</h3>
            <p className="avatar-tip">上传形象图片后，框选一个方形区域作为聊天头像；点击聊天中的头像可查看完整形象。</p>
            {avatarTargets.map((t) => (
              <div key={t.key} className="avatar-row">
                {avatars[t.key]?.square ? (
                  <img className="avatar-mini" src={avatars[t.key].square} alt={t.name} />
                ) : (
                  <span className="avatar-mini avatar-empty">无</span>
                )}
                <span className="avatar-name">{t.name}</span>
                <button
                  className="btn btn-small"
                  onClick={() => { setAvatarTarget(t.key); avatarInputRef.current?.click(); }}
                >上传形象</button>
              </div>
            ))}
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowAvatars(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {cropSrc && (
        <CropModal
          imageSrc={cropSrc.dataUrl}
          onClose={() => setCropSrc(null)}
          onDone={(square) => {
            onSetAvatar(cropSrc.targetKey, cropSrc.dataUrl, square);
            setCropSrc(null);
          }}
        />
      )}

      {showMain && session.mainImage && (
        <div className="modal-mask" onClick={() => setShowMain(false)}>
          <div className="modal image-modal" onClick={(e) => e.stopPropagation()}>
            <img src={session.mainImage} alt="房间主图" />
            <button className="btn" onClick={() => setShowMain(false)}>关闭</button>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="modal-mask" onClick={() => setLightbox(null)}>
          <img className="lightbox-img" src={lightbox} alt="查看图片" />
        </div>
      )}

      {(session.notice || session.status === 'connecting') && (
        <div className="modal-mask">
          <div className="modal notice-modal">
            {session.status === 'connecting' && <p>正在连接房间…</p>}
            {session.notice && (
              <>
                <p>{session.notice}</p>
                <button
                  className="btn btn-primary"
                  onClick={() => { onDismissNotice(); if (closed) onLeave(); }}
                >知道了</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
