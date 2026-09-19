import { Peer } from 'peerjs';

// 房间号即 PeerJS 节点 id 的一部分：能注册成功就是房主，否则作为玩家连接房主。
// 房主退出后 id 释放，第一个重新进入的玩家自动成为房主。
export const PEER_PREFIX = 'killa-boardgame-v1-';

// 默认使用 PeerJS 公共云做信令，并补充国内可达的 STUN 服务器。
// 手机端若因网络环境连不上公共云，可改用局域网信令：先运行 `npm run signal`，
// 然后把 USE_LOCAL_SIGNAL 置为 true（此时所有设备必须连同一 Wi-Fi，
// 且通过电脑的局域网 IP 访问页面）。
const USE_LOCAL_SIGNAL = false;

const CLOUD_ICE = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

export function makePeer(id) {
  if (USE_LOCAL_SIGNAL) {
    const opts = {
      host: location.hostname,
      port: 9000,
      path: '/',
      secure: false,
      config: { iceServers: [] },
    };
    return id ? new Peer(id, opts) : new Peer(opts);
  }
  const opts = { config: { iceServers: CLOUD_ICE } };
  return id ? new Peer(id, opts) : new Peer(opts);
}

export function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export class PeerNet {
  /**
   * handlers:
   *  onBecameHost(roomId)
   *  onJoined(youMsg)            作为玩家成功进入（收到房主 welcome 由上层处理）
   *  onHostMessage(data)         玩家收到房主消息
   *  onHostClosed()              房主连接断开
   *  onGuestMessage(conn, data)  房主收到玩家消息
   *  onGuestLeft(peerId)
   *  onError(message)
   */
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map(); // guestPeerId -> DataConnection (房主侧)
    this.hostConn = null;   // 玩家侧
    this.isHost = false;
    this.peer = null;
    this.destroyed = false;
  }

  enter(roomId, nickname) {
    this.roomId = roomId;
    this.nickname = nickname;
    this.destroyed = false;
    this._hostRetries = 0;
    this._tryHost();
  }

  _tryHost() {
    const peer = makePeer(PEER_PREFIX + this.roomId);
    this.peer = peer;
    peer.on('open', () => {
      if (this.destroyed) return;
      this.isHost = true;
      this.myId = 'host';
      peer.on('connection', (conn) => this._accept(conn));
      this.h.onBecameHost(this.roomId);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        // 已存在房主（或房主异常退出留下的幽灵注册），转为玩家加入
        try { peer.destroy(); } catch { /* ignore */ }
        this._joinAsGuest();
      } else if (err.type === 'network' || err.type === 'server-error') {
        this.h.onError(`无法连接信令服务器（${err.type}）。如手机持续失败，可启用局域网信令：电脑运行 npm run signal，并把 src/peer.js 中 USE_LOCAL_SIGNAL 改为 true`);
      } else if (!this.isHost) {
        this.h.onError(`连接失败: ${err.type}`);
      }
    });
    peer.on('disconnected', () => {
      if (!this.destroyed && this.isHost) {
        try { peer.reconnect(); } catch { /* ignore */ }
      }
    });
  }

  _joinAsGuest() {
    const peer = makePeer();
    this.peer = peer;
    peer.on('open', (id) => {
      if (this.destroyed) return;
      this.myId = id;
      const conn = peer.connect(PEER_PREFIX + this.roomId, { reliable: true });
      this.hostConn = conn;
      const timer = setTimeout(() => {
        if (!this.isHost && !this._welcomed) {
          // 连接不上房主：可能是幽灵注册。过几秒等云端清理后重试成为房主。
          if (this._hostRetries < 3) {
            this._hostRetries += 1;
            try { peer.destroy(); } catch { /* ignore */ }
            setTimeout(() => { if (!this.destroyed) this._tryHost(); }, 2500);
          } else {
            this.h.onError('加入超时，房间可能不存在或房主网络异常');
            this.leave();
          }
        }
      }, 8000);
      this._joinTimer = timer;
      conn.on('open', () => {
        conn.send({ t: 'hello', nickname: this.nickname });
      });
      conn.on('data', (data) => {
        if (data && data.t === 'welcome') {
          this._welcomed = true;
          clearTimeout(timer);
        }
        this.h.onHostMessage(data);
      });
      conn.on('close', () => {
        clearTimeout(timer);
        if (!this.destroyed) this.h.onHostClosed();
      });
      conn.on('error', () => {
        clearTimeout(timer);
        if (!this._welcomed) this.h.onError('无法连接到该房间');
      });
    });
    peer.on('error', (err) => {
      if (!this.destroyed && !this.isHost && !this._welcomed) {
        this.h.onError(`连接失败: ${err.type}`);
      }
    });
    peer.on('disconnected', () => {
      if (!this.destroyed && !this.isHost) {
        try { peer.reconnect(); } catch { /* ignore */ }
      }
    });
  }

  _accept(conn) {
    conn.on('data', (data) => this.h.onGuestMessage(conn, data));
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.h.onGuestLeft(conn.peer);
    });
    conn.on('error', () => {
      this.conns.delete(conn.peer);
      this.h.onGuestLeft(conn.peer);
    });
  }

  registerGuest(conn, nickname) {
    this.conns.set(conn.peer, conn);
    return { id: conn.peer, nickname };
  }

  sendHost(msg) {
    if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  }

  sendTo(conn, msg) {
    if (conn && conn.open) conn.send(msg);
  }

  broadcast(msg) {
    for (const conn of this.conns.values()) {
      if (conn.open) {
        try { conn.send(msg); } catch { /* ignore */ }
      }
    }
  }

  leave() {
    this.destroyed = true;
    clearTimeout(this._joinTimer);
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conns.clear();
    this.hostConn = null;
  }
}
