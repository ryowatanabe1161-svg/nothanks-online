/* ノーサンキュー！ オンライン版
 * 構成：WebRTC（PeerJS）による P2P。ホストのブラウザが唯一の正（authoritative）で、
 * 山札・全員のチップ・CPU（ふーさん🐻）の判断をすべてホスト側で処理します。
 * 各プレイヤーには「その人に見せてよい情報だけ」を送ります（他人のチップ枚数・山札の中身は送らない）。
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Q = new URLSearchParams(location.search);
  var CFG = window.NT_CONFIG || {};
  var ICE = (CFG.iceServers && CFG.iceServers.length) ? CFG.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
  if (Q.get('ice')) ICE = Q.get('ice').split(',').map(function (u) { return { urls: u }; }); // テスト・独自環境用
  var PEER_OPTS = Object.assign({ debug: 1, config: { iceServers: ICE } }, CFG.peer || {});
  var ID_PREFIX = 'nothanks-jp-v1-';
  var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var TURBO = Q.has('turbo');
  var SPEEDS = [
    { key: 'slow', label: 'ゆっくり', think: 1600 },
    { key: 'normal', label: 'ふつう', think: 1000 },
    { key: 'fast', label: 'はやい', think: 450 }
  ];
  var BEAR = '🐻', CPU_BASE = 'ふーさん' + BEAR, CPU_DEFAULT_RE = /^ふーさん🐻\d*$/;
  var LINES = {
    take: ['もらうクマ！', 'いただきクマ〜！', 'これはもらっておくクマ', 'チップごといただくクマ！'],
    takeRun: ['つながったクマ〜！', 'ちょうど欲しかったクマ！', '連番だクマ！'],
    takeForced: ['チップがないクマ…', 'しかたないクマ…'],
    takeBig: ['チップがいっぱいクマ！', 'がっぽりクマ〜！'],
    pass: ['パスだクマ〜', 'いらないクマ…', 'チップ置いとくクマ', 'ノーサンキューだクマ！', 'うーん、パスクマ']
  };
  var HB_MS = 3000, LOST_MS = 10000;
  var LS_ID = 'nt-online-client-id', LS_NAME = 'nt-online-name', LS_HOST = 'nt-online-host-room', SS_CLIENT = 'nt-online-joined';

  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) {} }
  function load(k, json) { try { var v = localStorage.getItem(k); return json ? JSON.parse(v) : v; } catch (e) { return null; } }
  function sstore(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function sload(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }
  function rid(n) { var s = ''; for (var i = 0; i < n; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]; return s; }
  var myId = load(LS_ID) || (function () { var v = rid(16); store(LS_ID, v); return v; })();

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function san(name) { return (name === 'あなた' || name.indexOf('さん') >= 0) ? name : name + 'さん'; }
  function who(s) { return (s.kind === 'cpu' && s.name.indexOf(BEAR) < 0 ? BEAR : '') + s.name; }
  function hue(v) { return Math.round(140 - (v - 3) / 32 * 140); }
  function mini(v) { return '<span class="mc" style="--h:' + hue(v) + '">' + v + '</span>'; }
  function runsHTML(cards) {
    if (!cards || !cards.length) return '<span class="none">なし</span>';
    return Geschenk.groupRuns(cards).map(function (r) {
      return '<span class="run' + (r.length > 1 ? ' multi' : '') + '">' + r.map(mini).join('') + '</span>';
    }).join('');
  }
  function bigCard(v) {
    return '<div class="bigcard flipin" style="--h:' + hue(v) + '"><span class="bow">🎀</span><span class="cn tl">' + v + '</span><span class="num">' + v + '</span><span class="cn br">' + v + '</span></div>';
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function cleanName(n) { return String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8); }
  function genCode() { var c = ''; for (var i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return c; }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 4); }
  function inviteUrl(code) {
    var u = location.origin + location.pathname + '?room=' + code;
    if (Q.get('ice')) u += '&ice=' + encodeURIComponent(Q.get('ice'));
    return u;
  }

  // ---------- 汎用UI ----------
  function show(id) { ['title', 'lobby', 'game', 'end'].forEach(function (s) { $(s).classList.toggle('active', s === id); }); }
  function overlay(id, on) { $(id).classList.toggle('active', on); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3000); }
  function banner(msg) { var b = $('banner'); b.textContent = msg || ''; b.classList.toggle('show', !!msg); }
  function confirmBox(title, text, yes, cb) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfYes').textContent = yes;
    overlay('confirmModal', true);
    $('cfYes').onclick = function () { overlay('confirmModal', false); cb(); };
    $('cfNo').onclick = function () { overlay('confirmModal', false); };
  }
  function connecting(on, title, text, onCancel) {
    overlay('connecting', on);
    if (on) { $('connTitle').textContent = title || '接続中…'; $('connText').textContent = text || ''; $('connCancel').onclick = onCancel || function () { location.href = location.pathname; }; }
  }
  $('rulesBtn1').onclick = $('rulesBtn2').onclick = function () { overlay('rulesModal', true); };
  $('rulesClose').onclick = function () { overlay('rulesModal', false); };
  $('rulesModal').addEventListener('click', function (e) { if (e.target === this) overlay('rulesModal', false); });

  // =====================================================================
  //  ホスト（authoritative）
  // =====================================================================
  var host = null; // { peer, room, conns:{clientId:conn}, lastSeen:{}, timer }

  function hostId(code) { return ID_PREFIX + code; }

  function newRoom(name) {
    return {
      code: genCode(), phase: 'lobby', rounds: 1, speed: 'normal', nextSid: 2,
      seats: [{ sid: 1, name: name, kind: 'host', clientId: myId, connected: true }],
      match: null, G: null, log: [], evId: 0, ev: null, created: Date.now()
    };
  }

  function startHost(name, resumeRoom) {
    document.body.classList.add('is-host');
    host = { room: resumeRoom || newRoom(name), conns: {}, lastSeen: {}, timer: null, tries: 0, opened: false };
    if (resumeRoom) {
      host.room.seats.forEach(function (s) { if (s.kind === 'remote') s.connected = false; });
      if (host.room.phase === 'playing') addLog('🔄 ホストが部屋を再開しました');
    }
    connecting(true, '部屋を作っています…', 'シグナリングサーバーに接続中', function () { location.href = location.pathname; });
    openHostPeer();
    setInterval(hostHeartbeat, 2000);
  }

  function openHostPeer() {
    var R = host.room;
    var peer = new Peer(hostId(R.code), PEER_OPTS);
    host.peer = peer;
    peer.on('open', function () {
      host.opened = true; host.tries = 0;
      connecting(false); banner('');
      hostRender(); saveHost(); hostSchedule();
    });
    peer.on('connection', hostOnConnection);
    peer.on('disconnected', function () {
      // シグナリングから切れただけ（既存のP2P接続は生きている）。再接続を試みる
      if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000);
    });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') {
        try { peer.destroy(); } catch (x) {}
        if (!host.opened && R.phase === 'lobby' && !host.resuming) { R.code = genCode(); openHostPeer(); return; }
        // 再開時：古い接続がサーバーから消えるまで少し待って同じIDで再試行
        if (++host.tries > 25) { connecting(false); toast('部屋を再開できませんでした'); return; }
        connecting(true, '部屋を再開しています…', '少し時間がかかることがあります（' + host.tries + '）');
        setTimeout(openHostPeer, 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!host.opened) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); setTimeout(function () { try { peer.destroy(); } catch (x) {} openHostPeer(); }, 4000); }
        else banner('シグナリングサーバーとの接続が不安定です（ゲームは続行できます）');
      } else if (e.type === 'browser-incompatible') {
        connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
      }
    });
  }

  function hostOnConnection(conn) {
    conn.on('data', function (msg) { hostOnMessage(conn, msg); });
    conn.on('close', function () { hostConnClosed(conn); });
    conn.on('error', function () { hostConnClosed(conn); });
  }
  function seatByClient(cid) { return host.room.seats.filter(function (s) { return s.clientId === cid; })[0]; }
  function seatIndex(seat) { return host.room.seats.indexOf(seat); }

  function hostOnMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    var R = host.room;
    if (msg.t === 'join') return hostJoin(conn, msg);
    var seat = conn.clientId && seatByClient(conn.clientId);
    if (!seat || host.conns[conn.clientId] !== conn) return; // 未参加・古い接続は無視
    host.lastSeen[conn.clientId] = Date.now();
    if (msg.t === 'ping') return;
    if (msg.t === 'act') {
      if (R.phase !== 'playing' || !R.G || R.G.over) return;
      var i = seatIndex(seat);
      if (R.G.turn !== i || seat.kind !== 'remote') return conn.send({ t: 'error', msg: 'あなたの番ではありません' });
      if (msg.mv !== R.G.moves) return; // 二重送信・古い操作
      if (msg.kind !== 'take' && msg.kind !== 'pass') return;
      hostAct(msg.kind);
    } else if (msg.t === 'leave') {
      if (R.phase === 'lobby') { R.seats.splice(seatIndex(seat), 1); addLog(seat.name + 'が退出しました'); }
      else { seat.connected = false; seat.left = true; addLog(seat.name + 'が退出しました'); }
      delete host.conns[conn.clientId];
      try { conn.close(); } catch (e) {}
      hostBroadcast();
    }
  }

  function hostJoin(conn, msg) {
    var R = host.room;
    var name = cleanName(msg.name), cid = String(msg.clientId || '').slice(0, 40);
    function reject(text) { conn.send({ t: 'reject', msg: text }); setTimeout(function () { try { conn.close(); } catch (e) {} }, 500); }
    if (!name || !cid) return reject('ニックネームを入力してください');
    if (cid === myId) return reject('ホストと同じ端末・ブラウザからは参加できません');
    var seat = seatByClient(cid);
    if (!seat) {
      // 同じ名前の「切断中の席」があれば、その席に戻す
      seat = R.seats.filter(function (s) { return s.name === name && (s.kind === 'remote' || s.replaced) && !s.connected && s.kind !== 'host'; })[0];
      if (seat) seat.clientId = cid;
    }
    if (seat) {
      if (seat.kind === 'host') return reject('この名前は使えません');
      var restored = seat.kind === 'cpu' && seat.replaced;
      if (restored) { seat.kind = 'remote'; seat.replaced = false; if (R.G) R.G.players[seatIndex(seat)].cpu = false; }
      var old = host.conns[cid];
      if (old && old !== conn) { try { old.close(); } catch (e) {} }
      seat.connected = true; seat.left = false;
      addLog('🔌 ' + seat.name + 'が' + (restored ? '戻ってきました（ふーさん🐻と交代）' : '再接続しました'));
    } else {
      if (R.phase !== 'lobby') return reject('この部屋はゲーム中です。前に参加していた人は、同じニックネームで入ると元の席に戻れます。');
      if (R.seats.length >= 7) return reject('満員です（最大7人）');
      if (R.seats.some(function (s) { return s.name === name; })) return reject('その名前はすでに使われています。別のニックネームにしてください。');
      seat = { sid: R.nextSid++, name: name, kind: 'remote', clientId: cid, connected: true };
      R.seats.push(seat);
      renumberCpus();
      addLog('👋 ' + name + 'が参加しました');
    }
    conn.clientId = cid;
    host.conns[cid] = conn;
    host.lastSeen[cid] = Date.now();
    conn.send({ t: 'welcome', code: R.code, sid: seat.sid });
    hostBroadcast();
    hostSchedule();
  }

  function hostConnClosed(conn) {
    if (!conn.clientId || host.conns[conn.clientId] !== conn) return;
    delete host.conns[conn.clientId];
    var seat = seatByClient(conn.clientId);
    if (seat && seat.connected) { seat.connected = false; addLog('⚠️ ' + seat.name + 'の接続が切れました'); hostBroadcast(); }
  }

  function hostHeartbeat() {
    if (!host) return;
    var now = Date.now();
    Object.keys(host.conns).forEach(function (cid) {
      var c = host.conns[cid];
      try { c.send({ t: 'hb' }); } catch (e) {}
      if (now - (host.lastSeen[cid] || 0) > LOST_MS) { try { c.close(); } catch (e) {} hostConnClosed(c); }
    });
  }

  function addLog(t) { var R = host.room; R.log.unshift(t); if (R.log.length > 30) R.log.length = 30; }

  function renumberCpus() {
    var R = host.room;
    var cpus = R.seats.filter(function (s) { return s.kind === 'cpu' && !s.replaced && CPU_DEFAULT_RE.test(s.name); });
    cpus.forEach(function (s, k) { s.name = cpus.length === 1 ? CPU_BASE : CPU_BASE + (k + 1); });
  }

  // ---- 進行 ----
  function speedMs() { if (TURBO) return 60; var s = SPEEDS.filter(function (x) { return x.key === host.room.speed; })[0] || SPEEDS[1]; return s.think; }

  function hostStartMatch() {
    var R = host.room;
    if (R.seats.length < 3 || R.seats.length > 7) return;
    R.match = { rounds: R.rounds, round: 0, first: Math.floor(Math.random() * R.seats.length), scores: [], names: R.seats.map(function (s) { return { name: s.name, cpu: s.kind === 'cpu' }; }) };
    R.log = [];
    hostStartRound();
  }
  function hostStartRound() {
    var R = host.room, M = R.match;
    M.round++;
    M.recorded = false;
    var cfg = R.seats.map(function (s) { return { name: s.name, cpu: s.kind === 'cpu' }; });
    R.G = Geschenk.createGame(cfg, null, { start: Geschenk.roundStarter(M.first, M.round, cfg.length) });
    R.phase = 'playing';
    R.ev = null;
    addLog('🎁 ' + (M.rounds > 1 ? '第' + M.round + '回戦' : 'ゲーム') + '開始！ 最初は ' + san(who(R.seats[R.G.turn])) + ' から');
    hostBroadcast();
    hostSchedule();
  }

  function hostAct(kind) {
    var R = host.room, G = R.G;
    if (!G || G.over) return;
    var i = G.turn, seat = R.seats[i], p = G.players[i], card = G.card, pot = G.pot;
    if (kind === 'pass' && !Geschenk.canPass(G)) kind = 'take';
    var forced = !Geschenk.canPass(G), runFit = Geschenk.marginal(p.cards, card) < card;
    Geschenk.act(G, kind);
    var line = '';
    if (seat.kind === 'cpu') line = kind === 'pass' ? pick(LINES.pass) : forced ? pick(LINES.takeForced) : runFit ? pick(LINES.takeRun) : pot >= 8 ? pick(LINES.takeBig) : pick(LINES.take);
    var q = line ? '「' + line + '」' : '';
    if (kind === 'pass') addLog(who(seat) + '：' + card + ' をパス' + q + '（場のチップ ' + (pot + 1) + '枚）');
    else addLog(who(seat) + '：' + card + ' をもらった！' + q + (pot ? '（チップ +' + pot + '枚）' : '') + (G.card != null ? ' → 次は ' + G.card : ''));
    R.ev = { id: ++R.evId, type: kind, seat: i, card: card, line: line };
    if (G.over) hostEndRound();
    hostBroadcast();
    hostSchedule();
  }

  function hostEndRound() {
    var R = host.room, M = R.match;
    if (M.recorded) return;
    var row = [];
    Geschenk.results(R.G).forEach(function (r) { row[r.id] = r.score; });
    M.scores.push(row);
    M.recorded = true;
    R.phase = M.round >= M.rounds ? 'final' : 'roundEnd';
    addLog(M.rounds > 1 ? '第' + M.round + '回戦が終わりました' : 'ゲーム終了！');
  }

  function hostSchedule() {
    clearTimeout(host.timer);
    var R = host.room;
    if (!host.opened || R.phase !== 'playing' || !R.G || R.G.over) return;
    var seat = R.seats[R.G.turn];
    if (seat.kind === 'cpu') {
      var mv = R.G.moves;
      host.timer = setTimeout(function () {
        if (R.phase === 'playing' && R.G.moves === mv && R.seats[R.G.turn].kind === 'cpu') hostAct(Geschenk.cpuDecide(R.G));
      }, speedMs() * (0.7 + Math.random() * 0.6));
    }
  }

  function hostReplace(sid) {
    var R = host.room;
    var seat = R.seats.filter(function (s) { return s.sid === sid; })[0];
    if (!seat || seat.kind !== 'remote' || seat.connected) return;
    seat.kind = 'cpu'; seat.replaced = true;
    if (R.G) { var p = R.G.players[seatIndex(seat)]; p.cpu = true; p.persona = 0.5; }
    addLog('🐻 ' + seat.name + 'の代わりに、ふーさん🐻がプレイします');
    hostBroadcast();
    hostSchedule();
  }

  // ---- 各プレイヤー向けの「見せてよい情報だけ」のビュー ----
  function viewFor(sid) {
    var R = host.room, G = R.G, M = R.match;
    var you = -1;
    R.seats.forEach(function (s, i) { if (s.sid === sid) you = i; });
    var inGame = R.phase !== 'lobby' && G;
    var v = {
      t: 'state', phase: R.phase, code: R.code, rounds: R.rounds, speed: R.speed, you: you,
      seats: R.seats.map(function (s, i) {
        var o = { sid: s.sid, name: s.name, kind: s.kind, connected: s.kind !== 'remote' || s.connected, replaced: !!s.replaced };
        if (inGame) {
          o.cards = G.players[i].cards.slice();
          // チップ枚数は本人の分だけ（ゲーム終了後は全員公開）
          o.chips = (i === you || G.over) ? G.players[i].chips : null;
        }
        return o;
      }),
      log: R.log.slice(0, 6)
    };
    if (inGame) {
      v.card = G.card; v.pot = G.pot; v.deckLeft = G.deck.length; v.turn = G.over ? -1 : G.turn; v.mv = G.moves;
      v.round = M.round; v.matchRounds = M.rounds; v.ev = R.ev;
      if (G.over) {
        v.results = Geschenk.results(G);
        v.removed = G.removed.slice();
        v.scores = M.scores.map(function (r) { return r.slice(); });
        v.totals = Geschenk.matchResults(M.names, M.scores);
      }
    }
    return v;
  }

  function hostBroadcast() {
    var R = host.room;
    R.seats.forEach(function (s) {
      if (s.kind !== 'remote') return;
      var c = host.conns[s.clientId];
      if (c && c.open) { try { c.send(viewFor(s.sid)); } catch (e) {} }
    });
    hostRender();
    saveHost();
  }
  function hostRender() { render(viewFor(1)); }
  function saveHost() { var R = host.room; store(LS_HOST, { room: R, saved: Date.now() }); }

  // ---- ホストのロビー操作 ----
  $('addCpuBtn').onclick = function () {
    var R = host && host.room; if (!R || R.phase !== 'lobby' || R.seats.length >= 7) return;
    R.seats.push({ sid: R.nextSid++, name: CPU_BASE, kind: 'cpu', connected: true });
    renumberCpus(); hostBroadcast();
  };
  $('seatList').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sid]'); if (!b || !host) return;
    var R = host.room, sid = +b.dataset.sid;
    var seat = R.seats.filter(function (s) { return s.sid === sid; })[0];
    if (!seat || seat.kind === 'host' || R.phase !== 'lobby') return;
    var doRemove = function () {
      if (seat.kind === 'remote') {
        var c = host.conns[seat.clientId];
        if (c) { try { c.send({ t: 'kicked' }); } catch (x) {} setTimeout(function () { try { c.close(); } catch (x) {} }, 300); delete host.conns[seat.clientId]; }
      }
      R.seats.splice(R.seats.indexOf(seat), 1); renumberCpus(); hostBroadcast();
    };
    if (seat.kind === 'remote' && seat.connected) confirmBox(seat.name + 'を外しますか？', '部屋から退出させます。', '外す', doRemove); else doRemove();
  });
  $('roundSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host || host.room.phase !== 'lobby') return;
    host.room.rounds = +b.dataset.r; hostBroadcast();
  });
  $('speedSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host) return;
    host.room.speed = b.dataset.k; hostBroadcast();
  });
  $('startBtn').onclick = function () { if (host) hostStartMatch(); };
  $('nextBtn').onclick = function () {
    if (!host) return;
    var R = host.room;
    if (R.phase === 'roundEnd') hostStartRound();
    else if (R.phase === 'final') { R.phase = 'lobby'; R.G = null; R.match = null; R.ev = null; addLog('ロビーに戻りました'); hostBroadcast(); }
  };
  $('players').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-repl]'); if (!b || !host) return;
    hostReplace(+b.dataset.repl);
  });
  $('hostbar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !host) return;
    if (b.dataset.repl) hostReplace(+b.dataset.repl);
    else $('hostbar').dataset.dismiss = b.dataset.wait;
  });

  // =====================================================================
  //  参加者（クライアント）
  // =====================================================================
  var client = null; // { peer, conn, code, name, joined, lastMsg }
  var received = []; // テスト用：受信したstateの記録

  function startClient(code, name) {
    document.body.classList.remove('is-host');
    client = { code: code, name: name, joined: false, lastMsg: Date.now(), everJoined: false, retry: 0 };
    connecting(true, '部屋 ' + code + ' に接続中…', 'しばらくお待ちください', function () { leaveClient(true); });
    var peer = new Peer(PEER_OPTS);
    client.peer = peer;
    peer.on('open', function () { clientConnect(); });
    peer.on('disconnected', function () { if (!peer.destroyed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 2000); });
    peer.on('error', function (e) {
      if (e.type === 'peer-unavailable') {
        if (!client.everJoined) { connecting(false); toast('部屋が見つかりません。コードを確認してください。'); leaveClient(false); }
        // 参加後はホスト側の一時的な不在 → 再接続ループに任せる
        else clientLost();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].indexOf(e.type) >= 0) {
        if (!client.everJoined) { connecting(true, 'サーバーに接続できません', '通信環境を確認してください。再試行しています…'); }
      } else if (e.type === 'browser-incompatible') {
        connecting(true, 'このブラウザは対応していません', 'Chrome / Safari の最新版でお試しください');
      }
    });
    clearInterval(client.hbTimer);
    client.hbTimer = setInterval(clientHeartbeat, HB_MS);
    // 15秒でつながらなければ案内
    setTimeout(function () {
      if (client && !client.everJoined && $('connecting').classList.contains('active')) {
        $('connText').textContent = 'つながりにくいようです。コードが正しいか、ホストが部屋を開いているか確認してください。（通信環境によっては接続できない場合があります）';
      }
    }, 15000);
  }

  function clientConnect() {
    if (!client || !client.peer || client.peer.destroyed) return;
    if (client.conn) { try { client.conn.close(); } catch (e) {} }
    var conn = client.peer.connect(hostId(client.code), { reliable: true });
    client.conn = conn;
    conn.on('open', function () { conn.send({ t: 'join', name: client.name, clientId: myId }); });
    conn.on('data', function (m) { if (client && client.conn === conn) clientOnMessage(m); });
    conn.on('close', function () { if (client && client.conn === conn) clientLost(); });
    conn.on('error', function () { if (client && client.conn === conn) clientLost(); });
  }

  function clientOnMessage(m) {
    if (!m || typeof m !== 'object') return;
    client.lastMsg = Date.now();
    if (m.t === 'welcome') {
      client.joined = true; client.everJoined = true; client.retry = 0;
      actSent = -1;
      connecting(false); banner('');
      sstore(SS_CLIENT, { code: client.code, name: client.name });
    } else if (m.t === 'state') {
      received.push(m); if (received.length > 3000) received.shift();
      render(m);
    } else if (m.t === 'reject') {
      connecting(false); toast(m.msg); leaveClient(false); alertBox(m.msg);
    } else if (m.t === 'kicked') {
      sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストによって部屋から外されました。');
    } else if (m.t === 'closed') {
      sstore(SS_CLIENT, null); leaveClient(false); alertBox('ホストが部屋を閉じました。');
    } else if (m.t === 'error') {
      toast(m.msg);
    }
  }
  function alertBox(msg) { confirmBox('お知らせ', msg, 'OK', function () {}); $('cfNo').style.display = 'none'; setTimeout(function () { $('cfNo').style.display = ''; }, 0); }

  function clientHeartbeat() {
    if (!client) return;
    if (client.conn && client.conn.open) { try { client.conn.send({ t: 'ping' }); } catch (e) {} }
    if (client.everJoined && Date.now() - client.lastMsg > LOST_MS) clientLost();
  }
  function clientLost() {
    if (!client || !client.everJoined) return;
    client.joined = false;
    banner('ホストとの接続が切れました。再接続しています…');
    clearTimeout(client.retryT);
    client.retryT = setTimeout(function () {
      if (!client) return;
      client.retry++;
      client.lastMsg = Date.now();
      if (client.peer.disconnected && !client.peer.destroyed) { try { client.peer.reconnect(); } catch (e) {} }
      clientConnect();
    }, 3000);
  }
  function leaveClient(sendLeave) {
    if (!client) return;
    if (sendLeave && client.conn && client.conn.open) { try { client.conn.send({ t: 'leave' }); } catch (e) {} }
    clearInterval(client.hbTimer); clearTimeout(client.retryT);
    var p = client.peer; client = null;
    setTimeout(function () { try { p.destroy(); } catch (e) {} }, 300);
    banner(''); connecting(false);
    show('title'); renderTitle();
  }

  // ---- 操作 ----
  var lastView = null, actSent = -1;
  function sendAct(kind) {
    var v = lastView; if (!v || v.phase !== 'playing' || v.turn !== v.you || v.turn < 0) return;
    if (actSent === v.mv) return;
    if (kind === 'pass' && !(v.seats[v.you].chips > 0)) return;
    actSent = v.mv;
    $('takeBtn').disabled = $('passBtn').disabled = true;
    if (host) hostAct(kind);
    else if (client && client.conn && client.conn.open) client.conn.send({ t: 'act', kind: kind, mv: v.mv });
  }
  $('takeBtn').onclick = function () { sendAct('take'); };
  $('passBtn').onclick = function () { sendAct('pass'); };
  document.addEventListener('keydown', function (e) {
    if (!$('game').classList.contains('active') || document.querySelector('.overlay.active') || e.target.tagName === 'INPUT') return;
    if (e.key === 't' || e.key === 'T' || e.key === '1') $('takeBtn').click();
    if (e.key === 'p' || e.key === 'P' || e.key === '2') $('passBtn').click();
  });

  function leaveRoom() {
    if (host) {
      confirmBox('部屋を閉じますか？', '参加者全員の接続が切れ、ゲームは終了します。', '部屋を閉じる', function () {
        Object.keys(host.conns).forEach(function (cid) { try { host.conns[cid].send({ t: 'closed' }); } catch (e) {} });
        store(LS_HOST, null);
        setTimeout(function () { try { host.peer.destroy(); } catch (e) {} location.href = location.pathname; }, 400);
      });
    } else {
      confirmBox('部屋を出ますか？', 'ゲーム中に出た場合も、同じニックネームで入り直せば元の席に戻れます。', '部屋を出る', function () { sstore(SS_CLIENT, null); leaveClient(true); });
    }
  }
  $('leaveBtn1').onclick = $('leaveBtn2').onclick = $('menuBtn').onclick = leaveRoom;

  // =====================================================================
  //  描画（ホスト・参加者で共通。受け取ったビューだけを使う）
  // =====================================================================
  var lastCard = null, lastEvId = 0, lastPhase = null, lastRoundKey = '';
  function render(v) {
    lastView = v;
    window.__nt.view = v;
    if (v.phase === 'lobby') { show('lobby'); renderLobby(v); }
    else if (v.phase === 'playing') { show('game'); renderGame(v); }
    else { renderGame(v); show('end'); renderEnd(v); }
    lastPhase = v.phase;
  }

  function renderLobby(v) {
    var isHost = !!host;
    $('codeBig').textContent = v.code;
    var url = inviteUrl(v.code);
    $('inviteUrl').textContent = url;
    if ($('qr').dataset.url !== url) {
      try { var qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
      catch (e) { $('qr').textContent = ''; }
      $('qr').dataset.url = url;
    }
    $('seatCount').textContent = v.seats.length + ' / 7人';
    $('seatList').innerHTML = v.seats.map(function (s, i) {
      var tags = '';
      if (s.kind === 'host') tags += '<span class="tag host">ホスト</span>';
      if (s.kind === 'cpu') tags += '<span class="tag cpu">' + BEAR + ' CPU</span>';
      if (i === v.you) tags += '<span class="tag you">あなた</span>';
      if (s.kind === 'remote') tags += s.connected ? '<span class="tag on">接続中</span>' : '<span class="tag off">切断</span>';
      var x = isHost && s.kind !== 'host' ? '<button class="xbtn" data-sid="' + s.sid + '" aria-label="外す">×</button>' : '';
      return '<div class="seat' + (s.connected ? '' : ' offline') + '"><span class="av' + (s.kind === 'cpu' ? ' bear' : '') + '">' + (s.kind === 'cpu' ? BEAR : i + 1) + '</span>' +
        '<span class="nm">' + esc(s.name) + '</span>' + tags + x + '</div>';
    }).join('');
    var n = v.seats.length;
    $('addCpuBtn').disabled = n >= 7;
    $('seatHint').textContent = n < 3 ? 'あと' + (3 - n) + '人必要です（ふーさん🐻を追加できます）' : (n >= 7 ? '満員です' : '3〜7人で遊べます／チップ：各' + Geschenk.chipsFor(n) + '枚');
    var rs = '';
    for (var r = 1; r <= 5; r++) rs += '<button data-r="' + r + '" class="' + (r === v.rounds ? 'on' : '') + '"' + (isHost ? '' : ' disabled') + '>' + r + '回戦</button>';
    $('roundSeg').innerHTML = rs;
    $('roundSeg').classList.toggle('ro', !isHost);
    $('speedSeg').innerHTML = SPEEDS.map(function (s) { return '<button data-k="' + s.key + '" class="' + (s.key === v.speed ? 'on' : '') + '">' + s.label + '</button>'; }).join('');
    $('startBtn').disabled = n < 3 || n > 7;
    $('startBtn').textContent = n < 3 ? 'あと' + (3 - n) + '人でスタートできます' : 'ゲーム開始！（' + n + '人・' + v.rounds + '回戦）';
    $('leaveBtn1').textContent = isHost ? '部屋を閉じる' : '部屋を出る';
  }

  function renderGame(v) {
    if (v.card == null && v.phase === 'playing') return;
    var me = v.you >= 0 ? v.seats[v.you] : null;
    $('codeChip').textContent = v.code;
    $('deckLeft').textContent = v.deckLeft;
    $('deckCnt').textContent = v.deckLeft ? 'のこり' + v.deckLeft + '枚' : '最後の1枚';
    $('deckEl').style.visibility = v.deckLeft ? 'visible' : 'hidden';
    $('roundPill').textContent = v.matchRounds > 1 ? '第' + v.round + '回戦 / 全' + v.matchRounds + '回戦' : '';
    $('players').innerHTML = v.seats.map(function (s, i) {
      var vis = s.chips != null;
      var tags = '<span class="badge ' + (s.kind === 'cpu' ? 'cpu">' + BEAR + (s.replaced ? ' 代打' : ' CPU') : s.kind === 'host' ? 'hum">ホスト' : 'hum">参加者') + '</span>';
      if (i === v.you) tags += '<span class="badge me">あなた</span>';
      if (!s.connected) tags += '<span class="badge off">切断</span>';
      var repl = (host && s.kind === 'remote' && !s.connected) ? '<button class="repl" data-repl="' + s.sid + '">' + BEAR + 'に交代</button>' : '';
      return '<div class="prow' + (i === v.turn ? ' cur' : '') + (i === v.you ? ' me' : '') + (s.connected ? '' : ' offline') + '" data-i="' + i + '">' +
        '<div class="pname"><span class="nm">' + esc(s.name) + '</span><span class="tags">' + tags + '</span>' + repl + '</div>' +
        '<div class="pchips"><span class="chip' + (vis ? '' : ' hidden') + '"></span>' + (vis ? s.chips : '?') + '</div>' +
        '<div class="cards">' + runsHTML(s.cards) + '</div>' +
        '<div class="ppts"><b>' + Geschenk.cardPoints(s.cards || []) + '</b>点</div></div>';
    }).join('');
    if (v.card != null) { if (lastCard !== v.card) { $('curCard').innerHTML = bigCard(v.card); lastCard = v.card; } }
    else { $('curCard').innerHTML = ''; lastCard = null; }
    var pc = '';
    for (var k = 0; k < Math.min(v.pot || 0, 12); k++) pc += '<span class="chip"></span>';
    $('potChips').innerHTML = pc;
    $('potNum').innerHTML = 'チップ <b>' + (v.pot || 0) + '</b> 枚';
    $('log').innerHTML = (v.log || []).slice(0, 4).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('');
    // 手番表示
    var cur = v.turn >= 0 ? v.seats[v.turn] : null;
    var myTurn = cur && v.turn === v.you;
    if (!cur) $('status').innerHTML = 'ゲーム終了！';
    else if (myTurn) $('status').innerHTML = 'あなたの番です！';
    else if (cur.kind === 'cpu') $('status').innerHTML = esc(who(cur)) + 'が考え中クマ<span class="dots"></span>';
    else if (!cur.connected) $('status').innerHTML = esc(san(cur.name)) + 'の再接続を待っています<span class="dots"></span>';
    else $('status').innerHTML = esc(san(cur.name)) + 'の番です<span class="dots"></span>';
    if (me) $('myinfo').innerHTML = '<span><span class="chip lg"></span> 手持ち <b>' + me.chips + '</b> 枚</span><span>現在 <b>' + (Geschenk.cardPoints(me.cards || []) - me.chips) + '</b> 点</span>';
    else $('myinfo').innerHTML = '';
    var canAct = myTurn && actSent !== v.mv;
    $('takeBtn').disabled = !canAct;
    $('passBtn').disabled = !canAct || !(me && me.chips > 0);
    if (v.card != null) {
      $('takeSub').textContent = v.card + ' ＋ チップ' + v.pot + '枚';
      if (myTurn && !(me.chips > 0)) $('passSub').textContent = 'チップがありません';
      else if (myTurn) $('passSub').textContent = 'のこり ' + me.chips + '枚 → ' + (me.chips - 1) + '枚';
      else $('passSub').innerHTML = '&nbsp;';
    }
    // ホスト：手番の人が切断中なら交代を提案
    var hb = $('hostbar');
    if (host && cur && cur.kind === 'remote' && !cur.connected && hb.dataset.dismiss !== String(cur.sid)) {
      hb.innerHTML = '<span>⚠️ ' + esc(san(cur.name)) + 'の接続が切れています</span><button class="y" data-repl="' + cur.sid + '">' + BEAR + 'ふーさんに交代</button><button class="n" data-wait="' + cur.sid + '">待つ</button>';
      hb.classList.add('show');
    } else hb.classList.remove('show');
    // 演出
    if (v.ev && v.ev.id !== lastEvId) {
      lastEvId = v.ev.id;
      var row = document.querySelector('.prow[data-i="' + v.ev.seat + '"]');
      if (row) {
        var b = document.createElement('div');
        b.className = 'bubble ' + v.ev.type; b.textContent = v.ev.line || (v.ev.type === 'pass' ? 'パス' : 'もらう！');
        row.appendChild(b);
      }
      if (v.ev.type === 'pass') { var pn = $('potNum'); pn.classList.remove('bump'); void pn.offsetWidth; pn.classList.add('bump'); }
    }
    fitTable();
  }
  function fitTable() {
    var t = $('table'); if (!t || !$('game').classList.contains('active')) return;
    var h = t.clientHeight - 22;
    t.style.setProperty('--ch', Math.round(Math.max(96, Math.min(h, 220, window.innerWidth * 0.48))) + 'px');
  }
  window.addEventListener('resize', fitTable);

  function renderEnd(v) {
    var multi = v.matchRounds > 1, final = v.phase === 'final';
    var key = v.round + ':' + v.phase;
    var res = v.results || [];
    var winners = res.filter(function (r) { return r.rank === 1; });
    var seatOf = function (id) { return v.seats[id] || { name: '?', kind: 'remote' }; };
    var wnames = function (list) { return list.map(function (w) { return san(who(seatOf(w.id))); }).join('・'); };
    if (!multi) {
      $('endTitle').textContent = 'ゲーム終了！';
      $('winnerText').textContent = winners.length ? '🏆 ' + (winners.length > 1 ? '同点優勝：' : '優勝：') + wnames(winners) + '（' + winners[0].score + '点）' : '';
      $('totalBox').style.display = 'none';
      $('roundResTitle').textContent = '最終順位';
    } else {
      var tot = v.totals || [];
      var tw = tot.filter(function (r) { return r.rank === 1; });
      $('totalBox').style.display = '';
      if (final) {
        $('endTitle').textContent = '最終結果！';
        $('winnerText').textContent = '🏆 ' + (tw.length > 1 ? '同点で総合優勝：' : '総合優勝：') + wnames(tw) + '（合計' + tw[0].total + '点）';
        $('totalTitle').textContent = '総合順位（全' + v.matchRounds + '回戦の合計）';
        $('totalHint').textContent = '合計得点がいちばん低い人が総合優勝です。';
      } else {
        $('endTitle').textContent = '第' + v.round + '回戦 終了！';
        $('winnerText').textContent = '🎉 この回戦の' + (winners.length > 1 ? '同点1位：' : '1位：') + wnames(winners) + '（' + winners[0].score + '点）';
        $('totalTitle').textContent = '通算成績（第' + v.round + '回戦まで / 全' + v.matchRounds + '回戦）';
        $('totalHint').textContent = 'のこり ' + (v.matchRounds - v.round) + ' 回戦。次の回戦はカードとチップを配り直します。';
      }
      var head = '<tr><th>順位</th><th style="text-align:left">プレイヤー</th>';
      for (var r = 1; r <= v.matchRounds; r++) head += '<th>' + r + '回戦</th>';
      $('totalHead').innerHTML = head + '<th>合計</th></tr>';
      $('totalBody').innerHTML = tot.map(function (t) {
        var cells = '';
        for (var r = 0; r < v.matchRounds; r++) cells += r < t.perRound.length ? '<td class="rs' + (r === v.round - 1 ? ' now' : '') + '">' + t.perRound[r] + '</td>' : '<td class="rs pending">－</td>';
        var s = seatOf(t.id);
        return '<tr class="' + (t.rank === 1 ? 'win' : '') + (t.id === v.you ? ' me' : '') + '"><td><span class="medal r' + t.rank + '">' + t.rank + '</span></td>' +
          '<td class="pl"><div class="nm">' + esc(t.name) + (s.kind === 'cpu' ? ' <span class="badge cpu">' + BEAR + '</span>' : '') + (t.id === v.you ? ' <span class="badge me">あなた</span>' : '') + '</div></td>' + cells +
          '<td><div class="score">' + t.total + '</div></td></tr>';
      }).join('');
      $('roundResTitle').textContent = '第' + v.round + '回戦の結果';
    }
    $('rankBody').innerHTML = res.map(function (r) {
      var s = seatOf(r.id);
      return '<tr class="' + (r.rank === 1 ? 'win' : '') + '"><td><span class="medal r' + r.rank + '">' + r.rank + '</span></td>' +
        '<td class="pl"><div class="nm">' + esc(r.name) + (s.kind === 'cpu' ? ' <span class="badge cpu">' + BEAR + ' CPU</span>' : '') + (r.id === v.you ? ' <span class="badge me">あなた</span>' : '') + '</div><div class="cards">' + runsHTML(r.cards) + '</div></td>' +
        '<td>' + r.cardPoints + '</td><td><span class="chip"></span> ' + r.chips + '</td>' +
        '<td><div class="score">' + r.score + '</div><div class="calc">' + r.cardPoints + '−' + r.chips + '</div></td></tr>';
    }).join('');
    $('removedCards').innerHTML = (v.removed || []).map(mini).join('');
    var tb = $('totalBox'), rb = $('roundBox');
    if (multi && !final) rb.parentNode.insertBefore(rb, tb); else tb.parentNode.insertBefore(tb, rb);
    $('nextBtn').textContent = final ? 'もう一度遊ぶ（ロビーへ）' : '次の回戦へ（第' + (v.round + 1) + '回戦）';
    $('endWait').innerHTML = final ? 'おつかれさまでした！ ホストが次のゲームを準備するのを待っています<span class="dots"></span>' : 'ホストが第' + (v.round + 1) + '回戦を始めるのを待っています<span class="dots"></span>';
    $('leaveBtn2').textContent = host ? '部屋を閉じる' : '部屋を出る';
    if (key !== lastRoundKey) { lastRoundKey = key; $('end').querySelector('.col').scrollTop = 0; if (final || !multi) confetti(); }
  }
  function confetti() {
    var colors = ['#f5c542', '#e2394f', '#2f9e5b', '#fff8e7', '#8a5a2b'];
    for (var i = 0; i < 40; i++) {
      var c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = (2.2 + Math.random() * 2.5) + 's';
      c.style.animationDelay = (Math.random() * 1.2) + 's';
      document.body.appendChild(c);
      setTimeout(function (el) { el.remove(); }.bind(null, c), 6500);
    }
  }

  // =====================================================================
  //  タイトル画面
  // =====================================================================
  function renderTitle() {
    $('titleCards').innerHTML = [3, 17, 35, 22, 9].map(function (v, i) {
      return '<span class="mc" style="--h:' + hue(v) + ';--r:' + ((i - 2) * 9) + 'deg">' + v + '</span>';
    }).join('');
    if (!$('nameIn').value) $('nameIn').value = load(LS_NAME) || '';
    var inv = normCode(Q.get('room'));
    $('inviteJoinBox').style.display = inv.length === 4 ? '' : 'none';
    $('invCode').textContent = inv;
    if (inv.length === 4) $('codeIn').value = inv;
    var saved = load(LS_HOST, true);
    var ok = saved && saved.room && Date.now() - saved.saved < 12 * 3600 * 1000;
    $('resumeBtn').style.display = ok ? '' : 'none';
    if (ok) $('resumeBtn').textContent = '前回の部屋（' + saved.room.code + '）を再開する';
    var joined = sload(SS_CLIENT);
    $('rejoinBtn').style.display = joined ? '' : 'none';
    if (joined) $('rejoinBtn').textContent = '部屋 ' + joined.code + ' に戻る（' + joined.name + '）';
  }
  function getName() {
    var n = cleanName($('nameIn').value);
    if (!n) { toast('ニックネームを入力してください'); $('nameIn').focus(); return null; }
    store(LS_NAME, n);
    return n;
  }
  $('createBtn').onclick = function () { var n = getName(); if (n) { store(LS_HOST, null); startHost(n, null); } };
  $('resumeBtn').onclick = function () {
    var saved = load(LS_HOST, true); if (!saved) return;
    startHost(saved.room.seats[0].name, saved.room);
    host.resuming = true;
  };
  function join(code) {
    var n = getName(); if (!n) return;
    code = normCode(code);
    if (code.length !== 4) { toast('4文字の部屋コードを入力してください'); return; }
    startClient(code, n);
  }
  $('joinBtn').onclick = function () { join($('codeIn').value); };
  $('joinInvitedBtn').onclick = function () { join(Q.get('room')); };
  $('rejoinBtn').onclick = function () { var j = sload(SS_CLIENT); if (j) { $('nameIn').value = j.name; startClient(j.code, j.name); } };
  $('codeIn').addEventListener('input', function () { this.value = normCode(this.value); });
  if (location.protocol === 'file:') setTimeout(function () { toast('ファイルを直接開いています。招待URLは公開URL（https）でのみ使えます。'); }, 500);

  // テスト・デバッグ用（ゲームの秘密情報はホスト以外には存在しません）
  window.__nt = {
    view: null, received: received,
    role: function () { return host ? 'host' : client ? 'client' : 'none'; },
    hostRoom: function () { return host ? host.room : null; },
    sendRaw: function (m) { if (client && client.conn) client.conn.send(m); }
  };
  renderTitle();
})();
