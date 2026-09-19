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
  // Metered TURN 中转（跨运营商/CGNAT 必走这里）
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: 'turn:global.relay.metered.ca:80',
    username: 'fae8be22e1e5fbe33f49b1ec',
    credential: '5c96fW12EUPSVCPk',
  },
  {
    urls: 'turn:global.relay.metered.ca:80?transport=tcp',
    username: 'fae8be22e1e5fbe33f49b1ec',
    credential: '5c96fW12EUPSVCPk',
  },
  {
    urls: 'turn:global.relay.metered.ca:443',
    username: 'fae8be22e1e5fbe33f49b1ec',
    credential: '5c96fW12EUPSVCPk',
  },
  {
    urls: 'turns:global.relay.metered.ca:443?transport=tcp',
    username: 'fae8be22e1e5fbe33f49b1ec',
    credential: '5c96fW12EUPSVCPk',
  },
  // 国内 STUN 兜底（同 NAT/宽松 NAT 时可直连，省 TURN 流量）
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.chat.bilibili.com:3478' },
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
   *  onLog(message)              诊断日志
   */
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map(); // guestPeerId -> DataConnection (房主侧)
    this.hostConn = null;   // 玩家侧
    this.isHost = false;
    this.peer = null;
    this.destroyed = false;
  }

  _log(msg) {
    try { this.h.onLog?.(msg); } catch { /* ignore */ }
  }

  // 监听 WebRTC ICE 状态变化，这是跨网络失败时最关键的诊断信息
  _watchIce(conn, tag) {
    conn.on('iceStateChanged', (state) => {
      this._log(`[ICE] ${tag}: ${state}`);
    });
  }

  enter(roomId, nickname) {
    this.roomId = roomId;
    this.nickname = nickname;
    this.destroyed = false;
    this._hostRetries = 0;
    this._tryHost();
  }

  _tryHost() {
    this._log(`尝试注册房主 ID: ${PEER_PREFIX + this.roomId}`);
    const peer = makePeer(PEER_PREFIX + this.roomId);
    this.peer = peer;
    peer.on('open', () => {
      if (this.destroyed) return;
      this._log('房主注册成功（信令通道正常）');
      this.isHost = true;
      this.myId = 'host';
      peer.on('connection', (conn) => this._accept(conn));
      this.h.onBecameHost(this.roomId);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      this._log(`房主端错误: ${err.type}`);
      if (err.type === 'unavailable-id') {
        // 已存在房主（或房主异常退出留下的幽灵注册），转为玩家加入
        this._log('房间已有房主，转为玩家加入');
        try { peer.destroy(); } catch { /* ignore */ }
        this._joinAsGuest();
      } else if (err.type === 'network' || err.type === 'server-error') {
        this.h.onError(`无法连接信令服务器（${err.type}）。如手机持续失败，可启用局域网信令：电脑运行 npm run signal，并把 src/peer.js 中 USE_LOCAL_SIGNAL 改为 true`);
      } else if (!this.isHost) {
        this.h.onError(`连接失败: ${err.type}`);
      }
    });
    peer.on('disconnected', () => {
      this._log('与信令服务器断开（disconnected）');
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
      this._log(`玩家注册成功，id=${id}（信令通道正常），正在 P2P 连接房主…`);
      this.myId = id;
      const conn = peer.connect(PEER_PREFIX + this.roomId, { reliable: true });
      this.hostConn = conn;
      this._watchIce(conn, '玩家→房主');
      const timer = setTimeout(() => {
        if (!this.isHost && !this._welcomed) {
          this._log('连接房主超时（8秒无响应）');
          // 连接不上房主：可能是幽灵注册。过几秒等云端清理后重试成为房主。
          if (this._hostRetries < 3) {
            this._hostRetries += 1;
            this._log(`重试第 ${this._hostRetries} 次：重新尝试成为房主`);
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
        this._log('P2P 通道已建立，发送 hello');
        conn.send({ t: 'hello', nickname: this.nickname });
      });
      conn.on('data', (data) => {
        if (data && data.t === 'welcome') {
          this._welcomed = true;
          this._log('收到房主 welcome，加入成功');
          clearTimeout(timer);
        }
        this.h.onHostMessage(data);
      });
      conn.on('close', () => {
        this._log('与房主的连接关闭');
        clearTimeout(timer);
        if (!this.destroyed) this.h.onHostClosed();
      });
      conn.on('error', () => {
        this._log('与房主的连接出错');
        clearTimeout(timer);
        if (!this._welcomed) this.h.onError('无法连接到该房间');
      });
    });
    peer.on('error', (err) => {
      this._log(`玩家端错误: ${err.type}`);
      if (!this.destroyed && !this.isHost && !this._welcomed) {
        this.h.onError(`连接失败: ${err.type}`);
      }
    });
    peer.on('disconnected', () => {
      this._log('与信令服务器断开（disconnected）');
      if (!this.destroyed && !this.isHost) {
        try { peer.reconnect(); } catch { /* ignore */ }
      }
    });
  }

  _accept(conn) {
    this._log(`有玩家连入: ${conn.peer}`);
    this._watchIce(conn, `房主←${String(conn.peer).slice(0, 8)}`);
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
