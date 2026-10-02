/*
 * ノーサンキュー！オンライン 設定ファイル（必要なときだけ編集してください）
 *
 * - peer: PeerJS シグナリングサーバーの設定。空なら PeerJS 公式の無料クラウド（0.peerjs.com）を使います。
 *         自前の PeerJS サーバーを使う例: { host: 'example.com', port: 443, path: '/myapp', secure: true }
 * - iceServers: WebRTC の STUN / TURN サーバー。
 *         モバイル回線同士などで「接続できない」場合は TURN サーバーを追加してください。
 *         例（Metered / Cloudflare などで取得した認証情報）:
 *         { urls: 'turns:turn.example.com:443?transport=tcp', username: 'xxx', credential: 'yyy' }
 */
window.NT_CONFIG = {
  peer: {},
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};
