/* ノーサンキュー！ ゲームロジック（オフライン版と共通・UI非依存） */
var Geschenk = (function () {
  'use strict';
  var MIN_CARD = 3, MAX_CARD = 35, REMOVED = 9;

  function chipsFor(n) { return n <= 5 ? 11 : (n === 6 ? 9 : 7); }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 連続した数字のまとまり（昇順）
  function groupRuns(cards) {
    var s = cards.slice().sort(function (a, b) { return a - b; });
    var runs = [];
    for (var i = 0; i < s.length; i++) {
      if (runs.length && s[i] === runs[runs.length - 1][runs[runs.length - 1].length - 1] + 1) runs[runs.length - 1].push(s[i]);
      else runs.push([s[i]]);
    }
    return runs;
  }
  function cardPoints(cards) {
    return groupRuns(cards).reduce(function (sum, r) { return sum + r[0]; }, 0);
  }
  function scoreOf(p) { return cardPoints(p.cards) - p.chips; }

  // opts.start: 最初の手番のプレイヤー番号（省略時はランダム）
  function createGame(configs, rng, opts) {
    rng = rng || Math.random;
    opts = opts || {};
    var n = configs.length;
    if (n < 3 || n > 7) throw new Error('プレイ人数は3〜7人です');
    var deck = [];
    for (var v = MIN_CARD; v <= MAX_CARD; v++) deck.push(v);
    shuffle(deck, rng);
    var removed = deck.splice(0, REMOVED).sort(function (a, b) { return a - b; });
    var chips = chipsFor(n);
    var players = configs.map(function (c, i) {
      return {
        id: i, name: c.name, cpu: !!c.cpu, chips: chips, cards: [],
        persona: c.cpu ? Math.round((rng() * 3 - 1) * 10) / 10 : 0  // CPUの性格（-1〜+2：大きいほど欲張り）
      };
    });
    var s = {
      players: players, deck: deck, removed: removed, startChips: chips,
      card: null, pot: 0, turn: (opts.start != null ? ((opts.start % n) + n) % n : Math.floor(rng() * n)), over: false, moves: 0
    };
    flip(s);
    return s;
  }

  function flip(s) {
    if (s.deck.length === 0) { s.card = null; s.pot = 0; s.over = true; return; }
    s.card = s.deck.pop();
    s.pot = 0;
  }

  function canPass(s) { return !s.over && s.players[s.turn].chips > 0; }

  function take(s) {
    if (s.over) throw new Error('ゲームは終了しています');
    var p = s.players[s.turn];
    var ev = { type: 'take', player: p.id, card: s.card, pot: s.pot };
    p.cards.push(s.card);
    p.cards.sort(function (a, b) { return a - b; });
    p.chips += s.pot;
    s.moves++;
    flip(s); // 取った人が次のカードをめくり、そのまま手番を続ける
    return ev;
  }

  function pass(s) {
    if (s.over) throw new Error('ゲームは終了しています');
    var p = s.players[s.turn];
    if (p.chips <= 0) throw new Error('チップがないのでパスできません');
    var ev = { type: 'pass', player: p.id, card: s.card, pot: s.pot + 1 };
    p.chips--;
    s.pot++;
    s.moves++;
    s.turn = (s.turn + 1) % s.players.length;
    return ev;
  }

  function act(s, kind) { return kind === 'take' ? take(s) : pass(s); }

  // カードを取ったときのカード点の増加分
  function marginal(cards, v) { return cardPoints(cards.concat([v])) - cardPoints(cards); }

  // CPUの判断
  function cpuDecide(s, rng) {
    rng = rng || Math.random;
    var p = s.players[s.turn], v = s.card, pot = s.pot;
    if (p.chips <= 0) return 'take';
    var m = marginal(p.cards, v);
    var delta = m - pot;                 // 取った場合の得点の変化（小さいほど得）
    var greed = p.persona || 0;
    var contested = s.players.some(function (o) { return o !== p && marginal(o.cards, v) < v; });
    if (delta <= 0) {
      // 自分にだけ役立つカードなら、少しチップを稼ぐ（一周させる）
      if (m < v && !contested && p.chips >= 3 && pot < 3 + greed && s.players.length > 0 && rng() < 0.65) return 'pass';
      return 'take';
    }
    var c = p.chips, tol;
    // 許容できる失点：チップが少ないほど、カードが大きいほど（大きいカードはどうせ誰かが引き取るので）取りやすく
    if (c >= 9) tol = 5; else if (c >= 6) tol = 7; else if (c >= 4) tol = 9; else if (c >= 2) tol = 12; else tol = 15;
    tol += v * 0.12;
    if (m < v) tol += 4;                 // 自分の連番に近いカードは取りやすい
    if (contested && m < v) tol += 2;    // 他人も狙っているなら早めに
    tol -= greed;
    tol += rng() * 3 - 1.5;              // 少しランダム
    if (delta <= tol) return 'take';
    if (pot >= v * (0.36 + greed * 0.05) + rng() * 2) return 'take';
    return 'pass';
  }

  // 最終結果（得点の低い順、同点は同順位）
  function results(s) {
    var list = s.players.map(function (p) {
      var cp = cardPoints(p.cards);
      return { id: p.id, name: p.name, cpu: p.cpu, cards: p.cards.slice(), runs: groupRuns(p.cards), cardPoints: cp, chips: p.chips, score: cp - p.chips };
    });
    list.sort(function (a, b) { return a.score - b.score || a.id - b.id; });
    for (var i = 0; i < list.length; i++) {
      list[i].rank = (i > 0 && list[i].score === list[i - 1].score) ? list[i - 1].rank : i + 1;
    }
    return list;
  }

  // 複数回戦の通算成績。roundScores[r][playerId] = その回戦の得点。合計の低い順、同点は同順位
  function matchResults(players, roundScores) {
    var list = players.map(function (p, i) {
      var per = roundScores.map(function (r) { return r[i]; });
      return { id: i, name: p.name, cpu: !!p.cpu, perRound: per, total: per.reduce(function (a, b) { return a + b; }, 0) };
    });
    list.sort(function (a, b) { return a.total - b.total || a.id - b.id; });
    for (var i = 0; i < list.length; i++) {
      list[i].rank = (i > 0 && list[i].total === list[i - 1].total) ? list[i - 1].rank : i + 1;
    }
    return list;
  }
  // 回戦ごとのスタートプレイヤー（毎回戦ひとつずつ回す）
  function roundStarter(first, round, n) { return (first + round - 1) % n; }

  return {
    matchResults: matchResults, roundStarter: roundStarter,
    MIN_CARD: MIN_CARD, MAX_CARD: MAX_CARD, REMOVED: REMOVED,
    chipsFor: chipsFor, shuffle: shuffle, groupRuns: groupRuns, cardPoints: cardPoints, scoreOf: scoreOf,
    createGame: createGame, canPass: canPass, take: take, pass: pass, act: act,
    marginal: marginal, cpuDecide: cpuDecide, results: results
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Geschenk;
