/*
 * Hangman Universal - app shell.
 * Vanilla JS on purpose: runs from file://, no build step, easy to wrap later.
 */
(function () {
  'use strict';

  var C = window.HMCore;
  var DATA = window.HangmanData;
  var SAVE_KEY = 'hangman-universal:v1';
  var LEVEL_SEED = 'hu-levels-2026';

  var DEFAULTS = {
    coins: 120,
    level: 1,
    streak: 0,
    best: 0,
    perfects: 0,
    solved: {},
    sound: true
  };

  var save = loadSave();
  var pool = C.buildLevelOrder(DATA.questions, LEVEL_SEED);
  var session = null;
  var busy = false;

  function $(id) { return document.getElementById(id); }

  /* --------------------------------------------------------------- storage */

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      var parsed = JSON.parse(raw);
      var saved = Object.assign({}, DEFAULTS, parsed, {
        solved: parsed.solved && typeof parsed.solved === 'object' ? parsed.solved : {}
      });
      /* drop progress that points at questions no longer in the bank */
      var live = {};
      DATA.questions.forEach(function (q) { if (saved.solved[q.id]) live[q.id] = true; });
      saved.solved = live;
      return saved;
    } catch (err) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* private mode */ }
  }

  function solvedCount() { return Object.keys(save.solved).length; }

  /* ------------------------------------------------------------------ audio */

  var audio = { ctx: null };

  function ctx() {
    if (!save.sound) return null;
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  function tone(freq, start, dur, type, gain) {
    var ac = ctx();
    if (!ac) return;
    var osc = ac.createOscillator();
    var amp = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, ac.currentTime + start);
    amp.gain.setValueAtTime(0.0001, ac.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(gain || 0.09, ac.currentTime + start + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
    osc.connect(amp);
    amp.connect(ac.destination);
    osc.start(ac.currentTime + start);
    osc.stop(ac.currentTime + start + dur + 0.03);
  }

  var sfx = {
    hit: function () { tone(660, 0, 0.1, 'triangle', 0.07); tone(990, 0.05, 0.12, 'sine', 0.05); },
    miss: function () { tone(180, 0, 0.16, 'sawtooth', 0.05); tone(120, 0.06, 0.18, 'sine', 0.05); },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.09, 0.24, 'triangle', 0.07); });
    },
    lose: function () {
      [330, 262, 196].forEach(function (f, i) { tone(f, i * 0.12, 0.3, 'sine', 0.07); });
    },
    tap: function () { tone(440, 0, 0.05, 'sine', 0.035); }
  };

  function buzz(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 12);
  }

  /* ------------------------------------------------------------------ views */

  function showScreen(id) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('is-active', screens[i].id === id);
    }
    window.scrollTo(0, 0);
  }

  function updateCoins() {
    ['home-coins', 'cats-coins', 'play-coins'].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = save.coins;
    });
  }

  function renderHome() {
    $('home-level').textContent = save.level;
    $('home-streak').textContent = save.streak;
    $('home-solved').textContent = solvedCount().toLocaleString('en-US') + '/' + DATA.questions.length.toLocaleString('en-US');
    $('btn-level').textContent = save.level;
    $('btn-sound').textContent = 'Sound: ' + (save.sound ? 'on' : 'off');
    $('btn-sound').setAttribute('aria-pressed', String(save.sound));
    // Ẩn nút Remove Ads nếu đã mua rồi
    var removeAdsBtn = $('btn-remove-ads');
    if (removeAdsBtn && window.HangmanAds && window.HangmanAds.isRemoved()) {
      removeAdsBtn.style.display = 'none';
    }
    updateCoins();
  }

  function renderCategories() {
    var list = $('cat-list');
    list.innerHTML = '';
    $('cats-total').textContent = DATA.questions.length.toLocaleString('en-US') + ' questions';
    $('cats-count').textContent = DATA.categories.length;

    DATA.categories.forEach(function (cat) {
      var qs = C.byCategory(DATA.questions, cat.id);
      var done = qs.filter(function (q) { return save.solved[q.id]; }).length;
      var pct = qs.length ? Math.round((done / qs.length) * 100) : 0;

      var btn = document.createElement('button');
      btn.className = 'cat';
      btn.type = 'button';
      btn.innerHTML =
        '<span class="cat-icon" style="color:' + cat.tint + '">' + cat.icon + '</span>' +
        '<span class="cat-body">' +
          '<span class="cat-name">' + cat.name + '</span>' +
          '<span class="cat-meta">' + done.toLocaleString('en-US') + '/' + qs.length.toLocaleString('en-US') + ' solved</span>' +
        '</span>' +
        '<span class="cat-bar"><i style="width:' + pct + '%"></i></span>';
      btn.addEventListener('click', function () { startCategory(cat.id); });
      list.appendChild(btn);
    });
    updateCoins();
  }

  var KEYBOARD_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

  function buildKeypad() {
    var pad = $('keypad');
    pad.innerHTML = '';
    KEYBOARD_ROWS.forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'keyrow';
      row.split('').forEach(function (ch) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        b.dataset.letter = ch;
        b.textContent = ch;
        b.setAttribute('aria-label', 'Letter ' + ch);
        b.addEventListener('click', function () { guess(ch); });
        rowEl.appendChild(b);
      });
      pad.appendChild(rowEl);
    });
  }

  var TILE_GAP = 6;
  var TILE_GAP_TIGHT = 4;
  var TILE_SPACE_RATIO = 0.36;
  var MAX_TILE = 52;
  var MIN_TILE = 18;
  var ONE_ROW_MIN = 22;
  var MAX_ROWS = 3;

  function totalUnits(tokens) {
    var units = 0;
    tokens.forEach(function (t) { units += t.isSpace ? TILE_SPACE_RATIO : 1; });
    return units;
  }

  function wordWidth(letters, tile, gap) {
    return letters * tile + Math.max(0, letters - 1) * gap;
  }

  /**
   * Wraps by whole words. A word is only broken between letters when it cannot
   * fit on a line by itself (a 25 letter answer, for example).
   */
  function wrapRows(tokens, tile, gap, width) {
    var spaceToken = { isSpace: true, char: ' ', revealed: false };

    var words = [];
    var word = [];
    tokens.forEach(function (token) {
      if (token.isSpace) {
        if (word.length) { words.push(word); word = []; }
        return;
      }
      word.push(token);
    });
    if (word.length) words.push(word);

    var rows = [];
    var row = [];
    var used = 0;

    function startRow() {
      if (row.length) rows.push(row);
      row = [];
      used = 0;
    }

    function addChunk(chunk) {
      if (!chunk.length) return;
      /* a word boundary costs two flex gaps (word-space and space-word) plus the
         blank tile itself; forgetting one of them made rows overflow by 6px */
      var boundary = row.length ? gap + tile * TILE_SPACE_RATIO + gap : 0;
      var chunkWidth = wordWidth(chunk.length, tile, gap);

      if (row.length && used + boundary + chunkWidth > width) {
        startRow();
        boundary = 0;
      }
      if (row.length) { row.push(spaceToken); }
      chunk.forEach(function (token) { row.push(token); });
      used += boundary + chunkWidth;
    }

    words.forEach(function (letters) {
      var whole = wordWidth(letters.length, tile, gap);
      if (whole <= width) { addChunk(letters); return; }

      var chunk = [];
      var chunkUsed = 0;
      letters.forEach(function (token) {
        var extra = chunk.length ? gap : 0;
        if (chunk.length && chunkUsed + extra + tile > width) {
          addChunk(chunk);
          chunk = [];
          chunkUsed = 0;
          extra = 0;
        }
        chunk.push(token);
        chunkUsed += extra + tile;
      });
      if (chunk.length) addChunk(chunk);
    });

    if (row.length) rows.push(row);
    return rows;
  }

  /**
   * Short answers stay on one line. Long ones wrap at the largest tile that
   * fits in MAX_ROWS rows, so headings stay readable and words stay intact.
   */
  /**
   * Short answers stay on one line. Longer ones wrap at the largest tile that
   * fits the row budget: 2 rows up to 20 letters, 3 rows beyond that.
   */
  /**
   * Short answers stay on one line. Longer ones wrap at the largest tile that
   * fits the row budget, and a row count is only accepted once the letters are
   * still comfortable to read (>= 26px tiles).
   */
  function layoutSlots(tokens, width) {
    var COMFORT_TILE = 26;
    var letters = tokens.filter(function (t) { return !t.isSpace; }).length;

    var singleTile = Math.floor(
      (width - TILE_GAP * Math.max(0, tokens.length - 1)) / Math.max(totalUnits(tokens), 1)
    );
    singleTile = Math.min(MAX_TILE, singleTile);
    if (singleTile >= ONE_ROW_MIN) {
      return { parts: [tokens], tile: singleTile, gap: TILE_GAP };
    }

    var maxRows = letters <= 20 ? 2 : MAX_ROWS;
    var best = null;

    for (var rows = 2; rows <= maxRows; rows++) {
      var gaps = [TILE_GAP, TILE_GAP_TIGHT];
      for (var g = 0; g < gaps.length; g++) {
        for (var tile = MAX_TILE; tile >= MIN_TILE; tile--) {
          var plan = wrapRows(tokens, tile, gaps[g], width);
          if (plan.length > rows) continue;

          if (!best || tile > best.tile) best = { parts: plan, tile: tile, gap: gaps[g] };
          if (tile >= COMFORT_TILE) return best;
          break;
        }
      }
    }

    if (best) return best;
    var fallback = wrapRows(tokens, MIN_TILE, TILE_GAP_TIGHT, width);
    return { parts: fallback.length ? fallback : [tokens], tile: MIN_TILE, gap: TILE_GAP_TIGHT };
  }

  function renderSlots(newLetters) {
    var el = $('play-slots');
    var tokens = C.mask(session.question.answer, session.guessed);
    var board = el.parentElement;
    var width = (board ? board.clientWidth : el.clientWidth) || 324;
    var plan = layoutSlots(tokens, width);

    el.style.setProperty('--tile', plan.tile + 'px');
    el.style.setProperty('--slot-gap', plan.gap + 'px');
    el.innerHTML = '';

    plan.parts.forEach(function (rowTokens) {
      var rowEl = document.createElement('div');
      rowEl.className = 'slotrow';

      rowTokens.forEach(function (token) {
        if (token.isSpace) {
          var gap = document.createElement('span');
          gap.className = 'gap';
          rowEl.appendChild(gap);
          return;
        }
        var slot = document.createElement('span');
        slot.className = 'slot';
        if (token.revealed) {
          slot.classList.add('revealed');
          if (newLetters && newLetters.indexOf(token.char) !== -1) slot.classList.add('is-new');
          slot.textContent = token.char;
        }
        rowEl.appendChild(slot);
      });

      el.appendChild(rowEl);
    });
  }

  function renderKeypad() {
    var wrong = C.wrongLetters(session.question.answer, session.guessed);
    var correct = C.correctLetters(session.question.answer, session.guessed);
    var keys = $('keypad').querySelectorAll('.key');
    for (var i = 0; i < keys.length; i++) {
      var ch = keys[i].dataset.letter;
      var used = session.guessed.has(ch);
      keys[i].classList.toggle('hit', correct.indexOf(ch) !== -1);
      keys[i].classList.toggle('miss', wrong.indexOf(ch) !== -1);
      keys[i].disabled = used || session.state !== 'playing';
    }
  }

  function renderLives() {
    var wrong = C.wrongLetters(session.question.answer, session.guessed).length;
    var el = $('play-lives');
    el.innerHTML = '';
    for (var i = 0; i < C.MAX_LIVES; i++) {
      var heart = document.createElement('i');
      heart.textContent = '♥';
      if (i >= C.MAX_LIVES - wrong) heart.className = 'spent';
      el.appendChild(heart);
    }
  }

  function renderGallows() {
    var wrong = C.wrongLetters(session.question.answer, session.guessed).length;
    var order = ['head', 'body', 'arm-l', 'arm-r', 'leg-l', 'leg-r'];
    var parts = document.querySelectorAll('.gallows .part');
    for (var i = 0; i < parts.length; i++) {
      var idx = order.indexOf(parts[i].dataset.part);
      parts[i].classList.toggle('on', idx > -1 && idx < wrong);
    }
  }

  function renderPlay(newLetters) {
    var q = session.question;
    var cat = DATA.categoryById[q.category] || { name: q.category, icon: '❓' };

    if (session.mode === 'level') {
      $('play-mode-label').textContent = 'Level';
      $('play-mode-value').textContent = session.level;
    } else if (session.mode === 'daily') {
      $('play-mode-label').textContent = 'Daily';
      $('play-mode-value').textContent = C.todayKey().slice(5).replace('-', '/');
    } else {
      $('play-mode-label').textContent = 'Topic';
      $('play-mode-value').textContent = '∞';
    }

    $('play-category').innerHTML = cat.icon + '<span>' + cat.name + '</span>';
    $('play-question').textContent = q.question;
    $('play-category').style.color = cat.tint || 'var(--ink-soft)';

    renderSlots(newLetters);
    renderKeypad();
    renderLives();
    renderGallows();
    updateCoins();

    var hintBtn = $('btn-hint-coins');
    if (hintBtn) hintBtn.disabled = session.state !== 'playing' || save.coins < C.HINT_COST;

    var freeHintBtn = $('btn-free-hint');
    if (freeHintBtn) freeHintBtn.disabled = session.state !== 'playing';
  }

  /* ------------------------------------------------------------- game flow */

  function startQuestion(question, meta) {
    if (!question) return;
    session = {
      question: question,
      guessed: new Set(),
      mode: meta.mode,
      level: meta.level || 0,
      category: meta.category || question.category,
      state: 'playing',
      helped: false
    };
    closeOverlay();
    showScreen('screen-play');
    renderPlay([]);
    sfx.tap();
  }

  function startLevel(level) {
    var index = (level - 1) % pool.length;
    startQuestion(pool[index], { mode: 'level', level: level });
  }

  function startCategory(categoryId) {
    var qs = C.byCategory(DATA.questions, categoryId);
    var fresh = qs.filter(function (q) { return !save.solved[q.id]; });
    var list = fresh.length ? fresh : qs;
    var rand = C.mulberry32(C.hashSeed(categoryId + ':' + save.coins + ':' + Date.now()));
    startQuestion(list[Math.floor(rand() * list.length)], { mode: 'category', category: categoryId });
  }

  function startDaily() {
    var index = C.dailyIndex(C.todayKey(), pool.length);
    startQuestion(pool[index], { mode: 'daily' });
  }

  function guess(letter) {
    if (!session || session.state !== 'playing') return;
    if (session.guessed.has(letter)) return;

    session.guessed.add(letter);
    var hit = C.prepare(session.question.answer).unique.indexOf(letter) !== -1;

    if (hit) { sfx.hit(); buzz(10); } else { sfx.miss(); buzz(28); }

    renderPlay([letter]);

    var state = C.status(session.question.answer, session.guessed);
    if (state === 'won') finish(true);
    else if (state === 'lost') finish(false);
  }

  function useHint() {
    if (!session || session.state !== 'playing') return;
    if (save.coins < C.HINT_COST) {
      toast('Not enough coins — a hint costs ' + C.HINT_COST + ' coins');
      return;
    }
    var letter = C.hintLetter(session.question.answer, session.guessed);
    if (!letter) return;

    save.coins -= C.HINT_COST;
    session.guessed.add(letter);
    session.helped = true;
    persist();

    sfx.hit();
    toast('Revealed ' + letter + ' · -' + C.HINT_COST + ' coins');
    renderPlay([letter]);

    var state = C.status(session.question.answer, session.guessed);
    if (state === 'won') finish(true);
    else if (state === 'lost') finish(false);
  }

  // Xem quảng cáo thưởng (rewarded) để mở miễn phí một chữ cái
  async function useFreeHint() {
    if (!session || session.state !== 'playing') return;

    if (!window.HangmanAds || !window.HangmanAds.showRewarded) {
      toast('Ads are not available right now');
      return;
    }

    var btn = $('btn-free-hint');
    if (btn) btn.disabled = true;

    var earned = false;
    try {
      earned = await window.HangmanAds.showRewarded();
    } catch (err) {
      earned = false;
    }

    // The player may have left the round while the ad was on screen.
    if (earned && session && session.state === 'playing') {
      var letter = C.hintLetter(session.question.answer, session.guessed);
      if (letter) {
        session.guessed.add(letter);
        session.helped = true;
        persist();

        sfx.hit();
        toast('Free Hint Revealed ' + letter + ' 🎁');
        renderPlay([letter]);

        var state = C.status(session.question.answer, session.guessed);
        if (state === 'won') finish(true);
        else if (state === 'lost') finish(false);
      }
    } else if (!earned) {
      toast('Watch the whole video to earn the free hint');
    }

    if (btn) btn.disabled = !session || session.state !== 'playing';
  }

  function finish(won) {
    if (!session || session.state !== 'playing') return;
    session.state = won ? 'won' : 'lost';

    var wrong = C.wrongLetters(session.question.answer, session.guessed).length;
    var reward = null;

    if (won) {
      save.streak += 1;
      save.best = Math.max(save.best, save.streak);
      reward = C.coinsForWin({
        livesLeft: C.MAX_LIVES - wrong,
        difficulty: session.question.difficulty,
        streak: save.streak
      });
      save.coins += reward.total;
      save.solved[session.question.id] = true;
      if (wrong === 0) save.perfects += 1;
      if (session.mode === 'level') save.level = Math.max(save.level, session.level + 1);

      sfx.win();
      buzz([12, 40, 12]);
      confetti();

      // Gọi kiểm tra hiện interstitial ad sau mỗi 3 màn chơi hoàn thành
      if (window.HangmanAds) {
        window.HangmanAds.checkInterstitial();
      }
    } else {
      save.streak = 0;
      sfx.lose();
      buzz([30, 60, 30]);
    }

    persist();
    renderKeypad();
    renderHome();

    window.setTimeout(function () {
      won ? showWin(reward, wrong) : showLose();
    }, 420);
  }

  /* --------------------------------------------------------------- overlays */

  function openOverlay(html, kind) {
    var sheet = $('sheet');
    sheet.className = 'sheet' + (kind ? ' ' + kind : '');
    sheet.innerHTML = html;
    $('overlay').hidden = false;
    sheet.focus({ preventScroll: true });
  }

  function closeOverlay() {
    $('overlay').hidden = true;
    $('sheet').innerHTML = '';
  }

  function showWin(reward, wrong) {
    var q = session.question;
    var cat = DATA.categoryById[q.category] || { name: q.category };
    openOverlay(
      '<p class="sheet-kicker">' + cat.name + ' · difficulty ' + q.difficulty + '/3</p>' +
      '<h2 id="sheet-title">WELL DONE!</h2>' +
      '<p class="sheet-answer' + (q.answer.length > 18 ? ' is-long' : '') + '"><small>Answer</small>' + q.answer + '</p>' +
      '<div class="rows">' +
        '<div class="row"><span>Base reward</span><b>+' + reward.base + '</b></div>' +
        '<div class="row"><span>Lives left ×5</span><b>+' + reward.lives + '</b></div>' +
        '<div class="row"><span>Difficulty</span><b>+' + reward.difficulty + '</b></div>' +
        '<div class="row"><span>Streak ' + save.streak + '</span><b>+' + reward.streak + '</b></div>' +
        (reward.perfect ? '<div class="row"><span>Perfect round</span><b>+' + reward.perfect + '</b></div>' : '') +
        '<div class="row total"><span>Total coins</span><b>+' + reward.total + '</b></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-next">' +
        (session.mode === 'level' ? 'Next level' : session.mode === 'daily' ? 'Done' : 'Next word') +
      '</button>' +
      '<button class="btn btn-ghost" id="btn-exit">Home</button>',
      'win'
    );

    $('btn-next').addEventListener('click', function () {
      if (session.mode === 'level') startLevel(save.level);
      else if (session.mode === 'daily') { closeOverlay(); goHome(); }
      else startCategory(session.category);
    });
    $('btn-exit').addEventListener('click', goHome);
  }

  function showLose() {
    var q = session.question;
    var cat = DATA.categoryById[q.category] || { name: q.category };
    var canAfford = save.coins >= C.REVEAL_COST;

    openOverlay(
      '<p class="sheet-kicker">' + cat.name + ' · difficulty ' + q.difficulty + '/3</p>' +
      '<h2 id="sheet-title">OUT OF LIVES</h2>' +
      '<div class="rows">' +
        '<div class="row"><span>Best streak</span><b>' + save.best + '</b></div>' +
        '<div class="row"><span>Letters</span><b>' + q.answer.length + '</b></div>' +
      '</div>' +
      '<div class="lose-answer" id="lose-answer"></div>' +
      '<button class="btn btn-primary" id="btn-retry">Try again</button>' +
      '<button class="btn btn-ghost" id="btn-reveal">' +
        '<span class="reveal-icon">&#9670;</span> Reveal answer · ' + C.REVEAL_COST + ' coins' +
      '</button>' +
      '<button class="btn btn-ghost" id="btn-exit">Home</button>',
      'lose'
    );

    var revealBtn = $('btn-reveal');
    if (!canAfford) revealBtn.classList.add('is-short');
    revealBtn.setAttribute('aria-disabled', String(!canAfford));

    revealBtn.addEventListener('click', function () {
      if (save.coins < C.REVEAL_COST) {
        toast('Not enough coins — reveal costs ' + C.REVEAL_COST);
        return;
      }
      save.coins -= C.REVEAL_COST;
      persist();
      updateCoins();
      renderHome();

      $('lose-answer').innerHTML =
        '<p class="sheet-answer' + (q.answer.length > 18 ? ' is-long' : '') + '"><small>Answer</small>' + q.answer + '</p>';
      revealBtn.remove();
      toast('Answer revealed · -' + C.REVEAL_COST + ' coins');
    });

    $('btn-retry').addEventListener('click', function () {
      startQuestion(q, { mode: session.mode, level: session.level, category: session.category });
    });
    $('btn-exit').addEventListener('click', goHome);
  }

  function showHelp() {
    openOverlay(
      '<p class="sheet-kicker">Rules</p>' +
      '<h2 id="sheet-title" style="font-size:24px">HOW TO PLAY</h2>' +
      '<div class="rows">' +
        '<div class="row"><span>1. Read the clue</span><b>Guess the word</b></div>' +
        '<div class="row"><span>2. Tap a letter</span><b>Correct letters open</b></div>' +
        '<div class="row"><span>3. Six mistakes</span><b>Round is over</b></div>' +
        '<div class="row"><span>4. Stuck?</span><b>A hint costs 30</b></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btn-close-help">Got it</button>',
      ''
    );
    $('btn-close-help').addEventListener('click', function () {
      closeOverlay();
      if (!session) showScreen('screen-home');
    });
  }

  function toast(message) {
    var el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(function () { el.classList.remove('show'); }, 1900);
  }

  function confetti() {
    var box = $('confetti');
    var colors = ['#ffc247', '#ff9d2e', '#5ad2ff', '#57e08a', '#ff5f8a', '#ffffff'];
    box.innerHTML = '';
    for (var i = 0; i < 26; i++) {
      var bit = document.createElement('i');
      bit.style.left = Math.random() * 100 + '%';
      bit.style.background = colors[i % colors.length];
      bit.style.animationDuration = (1.5 + Math.random() * 1.1).toFixed(2) + 's';
      bit.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
      bit.style.opacity = '0.9';
      box.appendChild(bit);
    }
    window.setTimeout(function () { box.innerHTML = ''; }, 3200);
  }

  function goHome() {
    closeOverlay();
    renderHome();
    showScreen('screen-home');
  }

  /*
   * Android hardware back / edge-swipe back. @capacitor/app turns the system
   * gesture into a backButton event. Inside the game we walk back to Home;
   * only on Home do we let the app close.
   */
  function handleNativeBack() {
    if (!$('overlay').hidden || !$('screen-home').classList.contains('is-active')) {
      goHome();
      return;
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.exitApp();
    }
  }

  /* ------------------------------------------------------------------- wire */

  $('btn-continue').addEventListener('click', function () { startLevel(save.level); });
  $('btn-categories').addEventListener('click', function () {
    renderCategories();
    showScreen('screen-categories');
  });
  $('btn-daily').addEventListener('click', startDaily);
  $('btn-help').addEventListener('click', showHelp);
  $('btn-hint-coins').addEventListener('click', useHint);
  $('btn-free-hint').addEventListener('click', useFreeHint);

  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', handleNativeBack);
  }

  $('btn-sound').addEventListener('click', function () {
    save.sound = !save.sound;
    persist();
    renderHome();
    if (save.sound) sfx.tap();
    toast(save.sound ? 'Sound on' : 'Sound off');
  });

  $('btn-reset').addEventListener('click', function () {
    var ok = window.confirm('Reset all progress, coins and streak?');
    if (!ok) return;
    save = Object.assign({}, DEFAULTS, { solved: {} });
    persist();
    renderHome();
    toast('Progress reset');
  });

  document.querySelectorAll('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', goHome);
  });

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var key = event.key.toUpperCase();

    if (!$('overlay').hidden) {
      if (event.key === 'Enter') {
        var primary = $('sheet').querySelector('.btn-primary');
        if (primary) { event.preventDefault(); primary.click(); }
      }
      if (event.key === 'Escape') { event.preventDefault(); goHome(); }
      return;
    }

    if ($('screen-play').classList.contains('is-active') && /^[A-Z]$/.test(key)) {
      event.preventDefault();
      guess(key);
    }
    if (event.key === 'Escape' && !$('screen-home').classList.contains('is-active')) {
      goHome();
    }
  });

  /* ------------------------------------------------------------------- boot */

  buildKeypad();
  renderHome();
  updateCoins();

  // Khởi tạo AdMob và hiển thị banner ở mép dưới cho tất cả màn hình
  if (window.HangmanAds) {
    window.HangmanAds.init().then(function() {
      window.HangmanAds.showBanner();
    });
  }

  /* deep links, handy while building and for future in-app links */
  if (location.hash === '#play') startLevel(save.level);
  else if (location.hash === '#categories') { renderCategories(); showScreen('screen-categories'); }
  else if (location.hash === '#help') showHelp();

  window.HangmanApp = {
    get save() { return save; },
    get current() {
      return session
        ? { answer: session.question.answer, category: session.question.category, state: session.state, guessed: Array.from(session.guessed) }
        : null;
    },
    startLevel: startLevel,
    startDaily: startDaily,
    poolSize: pool.length
  };

  /* used by tools/shoot.mjs to drive the board without knowing the bank */
  window.__huAnswer = function () {
    return session ? session.question.answer : '';
  };

  /* test hook: lets the screenshot harness open any puzzle, e.g. a 25-letter one */
  window.__huStart = function (question, meta) {
    startQuestion(question, Object.assign({ mode: 'level', level: 1 }, meta || {}));
  };
})();
