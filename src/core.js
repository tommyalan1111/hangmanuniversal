/*
 * Hangman Universal - pure game logic.
 * No DOM, no storage, no audio: everything here is testable in Node.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HMCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var MAX_LIVES = 6;
  var HINT_COST = 30;
  var REVEAL_COST = 200;

  /* ---------------------------------------------------------------- helpers */

  function normalize(text) {
    return String(text == null ? '' : text)
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hashSeed(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rand) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /* ------------------------------------------------------------------ puzzle */

  function prepare(answer) {
    var clean = normalize(answer);
    var chars = clean.split('');
    var letters = chars.filter(function (c) { return c !== ' '; });
    return {
      clean: clean,
      chars: chars,
      letters: letters,
      unique: letters.filter(function (c, i) { return letters.indexOf(c) === i; }),
      slots: chars.length,
      words: clean.split(' ').length
    };
  }

  function asSet(guessed) {
    if (guessed instanceof Set) return guessed;
    if (Array.isArray(guessed)) return new Set(guessed.map(function (c) { return String(c).toUpperCase(); }));
    return new Set();
  }

  /** One entry per character of the answer, spaces included. */
  function mask(answer, guessed) {
    var set = asSet(guessed);
    var chars = prepare(answer).chars;
    return chars.map(function (ch) {
      var isSpace = ch === ' ';
      return { char: ch, isSpace: isSpace, revealed: isSpace ? false : set.has(ch) };
    });
  }

  function wrongLetters(answer, guessed) {
    var set = asSet(guessed);
    var unique = prepare(answer).unique;
    return ALPHABET.filter(function (c) {
      return set.has(c) && unique.indexOf(c) === -1;
    });
  }

  function correctLetters(answer, guessed) {
    var set = asSet(guessed);
    return prepare(answer).unique.filter(function (c) { return set.has(c); });
  }

  function livesLeft(answer, guessed, maxLives) {
    var max = maxLives || MAX_LIVES;
    return Math.max(0, max - wrongLetters(answer, guessed).length);
  }

  function isSolved(answer, guessed) {
    var set = asSet(guessed);
    return prepare(answer).unique.every(function (c) { return set.has(c); });
  }

  function status(answer, guessed, maxLives) {
    if (isSolved(answer, guessed)) return 'won';
    if (livesLeft(answer, guessed, maxLives) <= 0) return 'lost';
    return 'playing';
  }

  /** Picks an unrevealed letter; prefers rare letters first? No - random, so hints feel fair. */
  function hintLetter(answer, guessed, rand) {
    var set = asSet(guessed);
    var open = prepare(answer).unique.filter(function (c) { return !set.has(c); });
    if (!open.length) return null;
    var random = rand || Math.random;
    return open[Math.floor(random() * open.length)];
  }

  /* ------------------------------------------------------------------ scoring */

  function coinsForWin(opts) {
    var o = opts || {};
    var lives = typeof o.livesLeft === 'number' ? o.livesLeft : MAX_LIVES;
    var difficulty = typeof o.difficulty === 'number' ? o.difficulty : 1;
    var streak = typeof o.streak === 'number' ? o.streak : 0;
    var base = 20;
    var lifeBonus = lives * 5;
    var diffBonus = (difficulty - 1) * 10;
    var streakBonus = Math.min(streak, 5) * 3;
    var perfect = lives === MAX_LIVES ? 15 : 0;
    return {
      base: base,
      lives: lifeBonus,
      difficulty: diffBonus,
      streak: streakBonus,
      perfect: perfect,
      total: base + lifeBonus + diffBonus + streakBonus + perfect
    };
  }

  /* --------------------------------------------------------------- level pool */

  /**
   * Builds a deterministic level order: easy questions first, mixed across
   * categories, with a smoothing pass so the same topic never repeats twice.
   */
  /** Greedy interleave: always take the biggest remaining topic that is not the previous one. */
  function interleaveBuckets(buckets, total, rand) {
    var cats = Object.keys(buckets).filter(function (c) { return buckets[c].length; });
    var out = [];
    var prev = null;
    while (out.length < total) {
      var pick = null;
      var bestLeft = -1;
      for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        if (!buckets[c].length || c === prev) continue;
        if (buckets[c].length > bestLeft) { bestLeft = buckets[c].length; pick = c; }
      }
      if (!pick) {
        for (var j = 0; j < cats.length; j++) {
          if (buckets[cats[j]].length) { pick = cats[j]; break; }
        }
      }
      if (!pick) break;
      out.push(buckets[pick].shift());
      prev = pick;
    }
    return out;
  }

  /**
   * Level order: the biggest topic is spread at even intervals through the whole
   * run (instead of piling up at the end), the rest is interleaved greedily.
   */
  /** Spreads one difficulty tier: the biggest topic fills even slots, the rest interleave. */
  function spreadTier(items, rand) {
    if (!items.length) return [];

    var buckets = {};
    items.forEach(function (q) {
      if (!buckets[q.category]) buckets[q.category] = [];
      buckets[q.category].push(q);
    });

    var cats = Object.keys(buckets);
    cats.forEach(function (c) { buckets[c] = shuffle(buckets[c], rand); });

    var total = items.length;
    if (cats.length === 1) return buckets[cats[0]].slice();

    var dominant = cats.slice().sort(function (a, b) {
      return buckets[b].length - buckets[a].length;
    })[0];

    var restBuckets = {};
    cats.forEach(function (c) { if (c !== dominant) restBuckets[c] = buckets[c].slice(); });
    var rest = interleaveBuckets(restBuckets, total - buckets[dominant].length, rand);

    var dominantItems = buckets[dominant];
    var out = [];
    var di = 0;
    var ri = 0;

    for (var i = 0; i < total; i++) {
      var nextSlot = Math.floor(((di + 0.5) * total) / dominantItems.length);
      if (di < dominantItems.length && i >= nextSlot) out.push(dominantItems[di++]);
      else if (ri < rest.length) out.push(rest[ri++]);
      else if (di < dominantItems.length) out.push(dominantItems[di++]);
    }
    return out;
  }

  /**
   * Level order: easy -> medium -> hard, and inside each tier topics are spread
   * evenly so consecutive levels rarely repeat the same subject.
   */
  function buildLevelOrder(questions, seed) {
    var rand = mulberry32(hashSeed(String(seed || 'hangman-universal')));
    var order = [];
    [1, 2, 3].forEach(function (tier) {
      var items = questions.filter(function (q) { return q.difficulty === tier; });
      order = order.concat(spreadTier(items, rand));
    });
    return order;
  }
  function byCategory(questions, categoryId) {
    return questions.filter(function (q) { return q.category === categoryId; });
  }

  /** Deterministic "daily puzzle" index from a date key (YYYY-MM-DD). */
  function dailyIndex(dateKey, size) {
    if (!size) return 0;
    return hashSeed('daily:' + dateKey) % size;
  }

  function todayKey(date) {
    var d = date || new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  return {
    ALPHABET: ALPHABET,
    MAX_LIVES: MAX_LIVES,
    HINT_COST: HINT_COST,
    REVEAL_COST: REVEAL_COST,
    normalize: normalize,
    hashSeed: hashSeed,
    mulberry32: mulberry32,
    shuffle: shuffle,
    prepare: prepare,
    mask: mask,
    wrongLetters: wrongLetters,
    correctLetters: correctLetters,
    livesLeft: livesLeft,
    isSolved: isSolved,
    status: status,
    hintLetter: hintLetter,
    coinsForWin: coinsForWin,
    buildLevelOrder: buildLevelOrder,
    byCategory: byCategory,
    dailyIndex: dailyIndex,
    todayKey: todayKey
  };
});
