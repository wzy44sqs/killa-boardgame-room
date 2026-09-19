import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PeerNet, genRoomId } from './peer';
import {
  loadRoomState, saveRoomState, loadChat, saveChat, pushRecent,
} from './storage';
import { sectorAtRotation } from './wheel';
import { uid } from './utils';
import Lobby from './components/Lobby';
import Room from './components/Room';

const emptySession = (roomId, nickname, isHost) => ({
  roomId,
  nickname,
  isHost,
  myId: null,
  status: 'connecting',
  players: [],
  roles: [],
  currentRoleKey: null,
  chat: [],
  wheel: null,
  bgImage: null,
  mainImage: null,
  mainImageVersion: 0,
  roomName: '',
  roomIntro: '',
  avatars: {},
  notice: null,
});

export default function App() {
  const [session, setSession] = useState(null);
  const [lobbyError, setLobbyError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);

  const netRef = useRef(null);
  const sessionRef = useRef(null);
  sessionRef.current = session;
  const spinTimerRef = useRef(null);

  const sync = useCallback((patch) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      sessionRef.current = next;
      return next;
    });
  }, []);

  const persistAll = useCallback((s) => {
    if (!s) return;
    saveRoomState(s.roomId, {
      roles: s.roles,
      wheel: s.wheel,
      bgImage: s.bgImage,
      mainImage: s.mainImage,
      currentRoleKey: s.currentRoleKey,
      roomName: s.roomName,
      roomIntro: s.roomIntro,
      avatars: s.avatars,
    });
    saveChat(s.roomId, s.chat);
  }, []);

  const appendChat = useCallback((msg) => {
    const s = sessionRef.current;
    const chat = [...s.chat, msg];
    sync({ chat });
    persistAll({ ...s, chat });
  }, [sync, persistAll]);

  // ---------- 房主逻辑 ----------

  const hostSnapshot = useCallback((s) => ({
    players: s.players,
    roles: s.roles,
    currentRoleKey: s.currentRoleKey,
    chat: s.chat,
    wheel: s.wheel,
    bgImage: s.bgImage,
    mainImage: s.mainImage,
    roomName: s.roomName,
    roomIntro: s.roomIntro,
    avatars: s.avatars,
  }), []);

  const hostFinishSpin = useCallback(() => {
    const s = sessionRef.current;
    const wheel = s?.wheel;
    if (!s?.isHost || !wheel?.spin) return;
    const spin = wheel.spin;
    const remainingSectors = wheel.remaining.map((i) => wheel.config.sectors[i]);
    const hit = sectorAtRotation(remainingSectors, spin.finalAngle);
    const sector = remainingSectors[hit];
    const sectorIndex = wheel.remaining[hit];

    let remaining = wheel.remaining;
    if (!wheel.config.allowRepeat) {
      remaining = wheel.remaining.filter((i) => i !== sectorIndex);
    }
    let drawnRoles = wheel.drawnRoles;
    if (wheel.config.oneDrawPerRole && !drawnRoles.includes(spin.byRole)) {
      drawnRoles = [...drawnRoles, spin.byRole];
    }
    const newWheel = { ...wheel, remaining, drawnRoles, spin: null };

    const msg = {
      id: uid(), ts: Date.now(), kind: 'result',
      fromName: spin.byName,
      text: `【${spin.byName}】抽到了「${sector.name}」`,
    };
    const chat = [...s.chat, msg];
    sync({ wheel: newWheel, chat });
    persistAll({ ...s, wheel: newWheel, chat });
    netRef.current?.broadcast({ t: 'spin-end', wheel: newWheel, msg });

    if (remaining.length === 0) {
      const endMsg = {
        id: uid(), ts: Date.now(), kind: 'system',
        text: '所有区域均已抽完，抽签结束',
      };
      const chat2 = [...chat, endMsg];
      sync({ wheel: null, chat: chat2 });
      persistAll({ ...sessionRef.current, wheel: null, chat: chat2 });
      netRef.current?.broadcast({ t: 'wheel', wheel: null });
      netRef.current?.broadcast({ t: 'chat', msg: endMsg });
    }
  }, [sync, persistAll]);

  const hostStartSpin = useCallback((byRole, byName, spinParams) => {
    const s = sessionRef.current;
    const wheel = s?.wheel;
    if (!wheel || wheel.spin) return;
    if (wheel.config.oneDrawPerRole && wheel.drawnRoles.includes(byRole)) return;
    if (wheel.remaining.length === 0) return;
    const spin = { ...spinParams, byRole, byName };
    const newWheel = { ...wheel, spin };
    sync({ wheel: newWheel });
    netRef.current?.broadcast({ t: 'spin', wheel: newWheel });
    clearTimeout(spinTimerRef.current);
    spinTimerRef.current = setTimeout(hostFinishSpin, spin.duration + 150);
  }, [sync, hostFinishSpin]);

  const onGuestMessage = useCallback((conn, data) => {
    const s = sessionRef.current;
    const net = netRef.current;
    if (!s?.isHost || !net) return;
    if (data.t === 'hello') {
      const player = net.registerGuest(conn, String(data.nickname || '玩家').slice(0, 20));
      const players = [
        ...s.players.filter((p) => p.id !== player.id),
        { ...player, connected: true },
      ];
      sync({ players });
      net.sendTo(conn, {
        t: 'welcome',
        you: player,
        snapshot: hostSnapshot({ ...s, players }),
      });
      net.broadcast({ t: 'players', players });
      const joinMsg = {
        id: uid(), ts: Date.now(), kind: 'system',
        text: `${player.nickname} 加入了房间`,
      };
      appendChat(joinMsg);
      net.broadcast({ t: 'chat', msg: joinMsg });
    } else if (data.t === 'chat') {
      const player = s.players.find((p) => p.id === conn.peer);
      const msg = {
        ...data.msg,
        id: uid(),
        ts: Date.now(),
        fromKey: `p:${conn.peer}`,
        fromName: player?.nickname || '玩家',
      };
      appendChat(msg);
      net.broadcast({ t: 'chat', msg });
    } else if (data.t === 'spin') {
      const player = s.players.find((p) => p.id === conn.peer);
      if (!player) return;
      hostStartSpin(`p:${conn.peer}`, player.nickname, {
        startAngle: data.startAngle,
        finalAngle: data.finalAngle,
        duration: data.duration,
      });
    }
  }, [sync, hostSnapshot, appendChat, hostStartSpin]);

  const onGuestLeft = useCallback((peerId) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    const player = s.players.find((p) => p.id === peerId);
    if (!player) return;
    const players = s.players.map((p) =>
      p.id === peerId ? { ...p, connected: false } : p);
    sync({ players });
    netRef.current?.broadcast({ t: 'players', players });
  }, [sync]);

  // ---------- 玩家逻辑 ----------

  const onHostMessage = useCallback((data) => {
    const s = sessionRef.current;
    if (!s || s.isHost) return;
    switch (data.t) {
      case 'welcome': {
        const snap = data.snapshot;
        const next = {
          ...s,
          status: 'connected',
          myId: data.you.id,
          players: snap.players,
          roles: snap.roles,
          currentRoleKey: snap.currentRoleKey,
          chat: snap.chat,
          wheel: snap.wheel,
          bgImage: snap.bgImage,
          mainImage: snap.mainImage,
          mainImageVersion: snap.mainImage ? s.mainImageVersion + 1 : s.mainImageVersion,
          roomName: snap.roomName || '',
          roomIntro: snap.roomIntro || '',
          avatars: snap.avatars || {},
        };
        sync(next);
        persistAll(next);
        break;
      }
      case 'players':
        sync({ players: data.players });
        break;
      case 'roles':
        sync({ roles: data.roles, currentRoleKey: data.currentRoleKey });
        persistAll({ ...sessionRef.current, roles: data.roles });
        break;
      case 'chat':
        appendChat(data.msg);
        break;
      case 'wheel':
      case 'spin':
        sync({ wheel: data.wheel });
        persistAll({ ...sessionRef.current, wheel: data.wheel });
        break;
      case 'spin-end': {
        const chat = [...sessionRef.current.chat, data.msg];
        sync({ wheel: data.wheel, chat });
        persistAll({ ...sessionRef.current, wheel: data.wheel, chat });
        break;
      }
      case 'bg':
        sync({ bgImage: data.dataUrl });
        persistAll({ ...sessionRef.current, bgImage: data.dataUrl });
        break;
      case 'main':
        sync({ mainImage: data.dataUrl, mainImageVersion: s.mainImageVersion + 1 });
        persistAll({ ...sessionRef.current, mainImage: data.dataUrl });
        break;
      case 'avatars':
        sync({ avatars: data.avatars });
        persistAll({ ...sessionRef.current, avatars: data.avatars });
        break;
      case 'host-left':
        persistAll(sessionRef.current);
        sync({ status: 'closed', notice: '房主已退出，房间解散。记录已保存，可用房间号再次进入（先进者成为房主）。' });
        break;
      default:
        break;
    }
  }, [sync, persistAll, appendChat]);

  const onHostClosed = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.isHost) return;
    persistAll(s);
    sync({ status: 'closed', notice: '与房主断开连接。记录已保存，可用房间号再次进入（先进者成为房主）。' });
  }, [sync, persistAll]);

  // ---------- 进入 / 退出房间 ----------

  const enterRoom = useCallback((roomIdRaw, nickname, roomMeta = null) => {
    const roomId = roomIdRaw.trim().toUpperCase();
    if (!nickname.trim()) { setLobbyError('请输入昵称'); return; }
    if (!roomId) { setLobbyError('请输入房间号'); return; }
    setLobbyError('');
    setConnecting(true);
    setDebugLogs([]);

    const net = new PeerNet({
      onLog: (msg) => {
        setDebugLogs((prev) => [...prev.slice(-99), `${new Date().toLocaleTimeString()} ${msg}`]);
      },
      onBecameHost: (rid) => {
        const saved = loadRoomState(rid);
        const chat = loadChat(rid);
        const base = emptySession(rid, nickname.trim(), true);
        const restored = saved ? {
          roles: saved.roles || [],
          wheel: saved.wheel && saved.wheel.remaining?.length ? { ...saved.wheel, spin: null } : null,
          bgImage: saved.bgImage || null,
          mainImage: saved.mainImage || null,
          currentRoleKey: saved.currentRoleKey || null,
          roomName: saved.roomName || '',
          roomIntro: saved.roomIntro || '',
          avatars: saved.avatars || {},
        } : { roles: [], wheel: null, bgImage: null, mainImage: null, currentRoleKey: null, roomName: '', roomIntro: '', avatars: {} };
        // 创建房间时传入的名称/简介优先（仅全新房间时存在）
        if (roomMeta?.roomName) restored.roomName = roomMeta.roomName;
        if (roomMeta?.roomIntro) restored.roomIntro = roomMeta.roomIntro;
        const players = [{ id: 'host', nickname: nickname.trim(), connected: true }];
        sync({
          ...base, ...restored,
          status: 'connected', myId: 'host', players, chat,
          currentRoleKey: restored.currentRoleKey || 'p:host',
        });
        setConnecting(false);
        pushRecent(rid, nickname.trim());
        persistAll({ ...sessionRef.current });
      },
      onHostMessage,
      onHostClosed,
      onGuestMessage,
      onGuestLeft,
      onError: (message) => {
        setConnecting(false);
        setSession(null);
        sessionRef.current = null;
        setLobbyError(message);
      },
    });
    netRef.current = net;
    setSession(emptySession(roomId, nickname.trim(), false));
    net.enter(roomId, nickname.trim());
    pushRecent(roomId, nickname.trim());
  }, [onHostMessage, onHostClosed, onGuestMessage, onGuestLeft, sync, persistAll]);

  const createRoom = useCallback((nickname, roomName, roomIntro) => {
    if (!nickname.trim()) { setLobbyError('请输入昵称'); return; }
    enterRoom(genRoomId(), nickname, {
      roomName: (roomName || '').trim().slice(0, 20),
      roomIntro: (roomIntro || '').trim().slice(0, 60),
    });
  }, [enterRoom]);

  const leaveRoom = useCallback(() => {
    const s = sessionRef.current;
    if (s) {
      if (s.isHost) netRef.current?.broadcast({ t: 'host-left' });
      persistAll(s);
    }
    clearTimeout(spinTimerRef.current);
    netRef.current?.leave();
    netRef.current = null;
    sessionRef.current = null;
    setSession(null);
  }, [persistAll]);

  useEffect(() => {
    const onUnload = () => {
      const s = sessionRef.current;
      if (s?.isHost) netRef.current?.broadcast({ t: 'host-left' });
      if (s) persistAll(s);
      netRef.current?.leave();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [persistAll]);

  // ---------- 房间内操作 ----------

  const sendChatText = useCallback((text) => {
    const s = sessionRef.current;
    if (!s || !text.trim()) return;
    if (s.isHost) {
      const roleKey = s.currentRoleKey || 'p:host';
      const role = s.roles.find((r) => r.key === roleKey);
      const msg = {
        id: uid(), ts: Date.now(), kind: 'text', text: text.trim(),
        fromKey: roleKey, fromName: role ? role.name : s.nickname,
      };
      appendChat(msg);
      netRef.current?.broadcast({ t: 'chat', msg });
    } else {
      netRef.current?.sendHost({ t: 'chat', msg: { kind: 'text', text: text.trim() } });
    }
  }, [appendChat]);

  const sendChatImage = useCallback((dataUrl) => {
    const s = sessionRef.current;
    if (!s) return;
    if (s.isHost) {
      const roleKey = s.currentRoleKey || 'p:host';
      const role = s.roles.find((r) => r.key === roleKey);
      const msg = {
        id: uid(), ts: Date.now(), kind: 'image', dataUrl,
        fromKey: roleKey, fromName: role ? role.name : s.nickname,
      };
      appendChat(msg);
      netRef.current?.broadcast({ t: 'chat', msg });
    } else {
      netRef.current?.sendHost({ t: 'chat', msg: { kind: 'image', dataUrl } });
    }
  }, [appendChat]);

  const addRole = useCallback((name) => {
    const s = sessionRef.current;
    if (!s?.isHost || !name.trim()) return;
    const roles = [...s.roles, { key: `r:${uid()}`, name: name.trim().slice(0, 20) }];
    sync({ roles });
    persistAll({ ...s, roles });
    netRef.current?.broadcast({ t: 'roles', roles, currentRoleKey: s.currentRoleKey });
  }, [sync, persistAll]);

  const removeRole = useCallback((key) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    const roles = s.roles.filter((r) => r.key !== key);
    const currentRoleKey = s.currentRoleKey === key ? 'p:host' : s.currentRoleKey;
    sync({ roles, currentRoleKey });
    persistAll({ ...s, roles, currentRoleKey });
    netRef.current?.broadcast({ t: 'roles', roles, currentRoleKey });
  }, [sync, persistAll]);

  const switchRole = useCallback((key) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    sync({ currentRoleKey: key });
    persistAll({ ...s, currentRoleKey: key });
    netRef.current?.broadcast({ t: 'roles', roles: s.roles, currentRoleKey: key });
  }, [sync, persistAll]);

  const createWheel = useCallback((config) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    const wheel = {
      config,
      remaining: config.sectors.map((_, i) => i),
      drawnRoles: [],
      spin: null,
    };
    sync({ wheel });
    persistAll({ ...s, wheel });
    netRef.current?.broadcast({ t: 'wheel', wheel });
  }, [sync, persistAll]);

  const endWheel = useCallback(() => {
    const s = sessionRef.current;
    if (!s?.isHost || !s.wheel) return;
    clearTimeout(spinTimerRef.current);
    const msg = { id: uid(), ts: Date.now(), kind: 'system', text: '房主结束了本次抽签' };
    const chat = [...s.chat, msg];
    sync({ wheel: null, chat });
    persistAll({ ...s, wheel: null, chat });
    netRef.current?.broadcast({ t: 'wheel', wheel: null });
    netRef.current?.broadcast({ t: 'chat', msg });
  }, [sync, persistAll]);

  const requestSpin = useCallback((spinParams) => {
    const s = sessionRef.current;
    if (!s?.wheel || s.wheel.spin) return;
    if (s.isHost) {
      const roleKey = s.currentRoleKey || 'p:host';
      const role = s.roles.find((r) => r.key === roleKey);
      hostStartSpin(roleKey, role ? role.name : s.nickname, spinParams);
    } else {
      netRef.current?.sendHost({ t: 'spin', ...spinParams });
    }
  }, [hostStartSpin]);

  const setBgImage = useCallback((dataUrl) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    sync({ bgImage: dataUrl });
    persistAll({ ...s, bgImage: dataUrl });
    netRef.current?.broadcast({ t: 'bg', dataUrl });
  }, [sync, persistAll]);

  const setMainImage = useCallback((dataUrl) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    sync({ mainImage: dataUrl, mainImageVersion: s.mainImageVersion + 1 });
    persistAll({ ...s, mainImage: dataUrl });
    netRef.current?.broadcast({ t: 'main', dataUrl });
  }, [sync, persistAll]);

  // 房主为角色（含玩家角色）设置形象：full 完整图，square 方形头像
  const setAvatar = useCallback((roleKey, full, square) => {
    const s = sessionRef.current;
    if (!s?.isHost) return;
    const avatars = { ...s.avatars, [roleKey]: { full, square } };
    sync({ avatars });
    persistAll({ ...s, avatars });
    netRef.current?.broadcast({ t: 'avatars', avatars });
  }, [sync, persistAll]);

  // ---------- 渲染 ----------

  if (session) {
    return (
      <Room
        session={session}
        onLeave={leaveRoom}
        onSendText={sendChatText}
        onSendImage={sendChatImage}
        onAddRole={addRole}
        onRemoveRole={removeRole}
        onSwitchRole={switchRole}
        onCreateWheel={createWheel}
        onEndWheel={endWheel}
        onRequestSpin={requestSpin}
        onSetBg={setBgImage}
        onSetMain={setMainImage}
        onSetAvatar={setAvatar}
        onDismissNotice={() => sync({ notice: null })}
        myRoleKey={session.isHost ? (session.currentRoleKey || 'p:host') : `p:${session.myId}`}
      />
    );
  }

  return (
    <Lobby
      error={lobbyError}
      connecting={connecting}
      onCreate={createRoom}
      onJoin={enterRoom}
      debugLogs={debugLogs}
    />
  );
}
