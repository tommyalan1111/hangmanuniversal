/*
 * Unit tests for src/core.js - run with: node tools/test-core.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'src', 'core.js'));
require(path.join(here, '..', 'data', 'questions.generated.js'));
const data = require(path.join(here, '..', 'data', 'questions.js'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL ' + name);
    console.error('       ' + err.message);
    process.exitCode = 1;
  }
}

console.log('core');

test('normalize strips accents and punctuation', () => {
  assert.equal(core.normalize('Hà Nội!'), 'HA NOI');
  assert.equal(core.normalize('  new   york '), 'NEW YORK');
});

test('prepare counts letters without spaces', () => {
  const p = core.prepare('ICE CREAM');
  assert.equal(p.clean, 'ICE CREAM');
  assert.equal(p.letters.length, 8);
  assert.deepEqual(p.unique.sort(), ['A', 'C', 'E', 'I', 'M', 'R']);
  assert.equal(p.words, 2);
});

test('mask hides unknown letters and marks spaces', () => {
  const m = core.mask('ICE CREAM', new Set(['I', 'C']));
  assert.equal(m.length, 9);
  assert.equal(m[0].revealed, true);   // I
  assert.equal(m[1].revealed, true);   // C
  assert.equal(m[2].revealed, false);  // E
  assert.equal(m[3].isSpace, true);
  assert.equal(m[4].revealed, true);   // C (second one)
  assert.equal(m[5].revealed, false);  // R
});

test('wrong letters accumulate and cost lives', () => {
  const guessed = new Set(['X', 'Z', 'I']);
  assert.deepEqual(core.wrongLetters('ICE CREAM', guessed), ['X', 'Z']);
  assert.equal(core.livesLeft('ICE CREAM', guessed), 4);
});

test('repeated letters in the answer are not double counted', () => {
  assert.equal(core.prepare('BANANA').unique.length, 3);
  assert.equal(core.livesLeft('BANANA', new Set(['B'])), 6);
});

test('status moves from playing to won', () => {
  const answer = 'CAT';
  assert.equal(core.status(answer, new Set()), 'playing');
  assert.equal(core.status(answer, new Set(['C', 'A'])), 'playing');
  assert.equal(core.status(answer, new Set(['C', 'A', 'T'])), 'won');
});

test('status becomes lost after six wrong letters', () => {
  const answer = 'CAT';
  assert.equal(core.status(answer, new Set(['B', 'D', 'E', 'F', 'G', 'H'])), 'lost');
  assert.equal(core.livesLeft(answer, new Set(['B', 'D', 'E', 'F', 'G', 'H'])), 0);
});

test('a correct-only run stays at full lives', () => {
  assert.equal(core.livesLeft('CAT', new Set(['C', 'A', 'T'])), 6);
});

test('hint only offers unrevealed letters', () => {
  const answer = 'OCTOPUS';
  const guessed = new Set(['O', 'C']);
  for (let i = 0; i < 40; i++) {
    const h = core.hintLetter(answer, guessed);
    assert.ok(!guessed.has(h));
    assert.ok(answer.includes(h));
  }
  assert.equal(core.hintLetter('OCTOPUS', new Set('OCTOPUS'.split(''))), null);
});

test('coins grow with lives, difficulty and streak', () => {
  const weak = core.coinsForWin({ livesLeft: 1, difficulty: 1, streak: 0 });
  const strong = core.coinsForWin({ livesLeft: 6, difficulty: 3, streak: 4 });
  assert.ok(strong.total > weak.total);
  assert.equal(weak.perfect, 0);
  assert.equal(strong.perfect, 15);
  assert.equal(weak.total, 25);
});

test('level order is deterministic and covers every question', () => {
  const a = core.buildLevelOrder(data.questions, 'seed-1');
  const b = core.buildLevelOrder(data.questions, 'seed-1');
  assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
  assert.equal(a.length, data.questions.length);
  assert.equal(new Set(a.map((q) => q.id)).size, data.questions.length);
});

test('level order starts easy and rarely repeats a category back to back', () => {
  const order = core.buildLevelOrder(data.questions, 'seed-1');
  assert.ok(order.slice(0, 10).every((q) => q.difficulty === 1), 'first levels must be easy');
  /* difficulty ramps */
  assert.ok(order[Math.floor(order.length * 0.85)].difficulty >= 2, 'late levels must be harder');
  let repeats = 0;
  let longestRun = 1;
  let run = 1;
  for (let i = 1; i < order.length; i++) {
    if (order[i].category === order[i - 1].category) {
      repeats++;
      run++;
      longestRun = Math.max(longestRun, run);
    } else {
      run = 1;
    }
  }
  /* geography is ~56% of the bank, so some adjacency is unavoidable; what matters
     is that those repeats are spread out instead of piling up in one block */
  assert.ok(repeats <= order.length * 0.3, `too many repeats: ${repeats}/${order.length}`);
  assert.ok(longestRun <= 3, `same category ran ${longestRun} times in a row`);
  assert.equal(order[0].category === order[1].category, false);

  /* tail of the order */
  const tail = order.slice(-30);
  const distinctTail = new Set(tail.map((q) => q.category)).size;
  assert.ok(distinctTail >= 4, `last 30 levels only cover ${distinctTail} topics`);
});

test('daily index is stable per date and inside bounds', () => {
  const a = core.dailyIndex('2026-11-10', 100);
  assert.equal(a, core.dailyIndex('2026-11-10', 100));
  assert.ok(a >= 0 && a < 100);
  assert.notEqual(core.dailyIndex('2026-11-10', 97), core.dailyIndex('2026-11-11', 97));
});

test('every question is playable end to end', () => {
  for (const q of data.questions) {
    const letters = core.prepare(q.answer).unique;
    assert.equal(core.status(q.answer, new Set(letters)), 'won', q.id);
    assert.equal(core.livesLeft(q.answer, new Set(letters)), core.MAX_LIVES, q.id);
    assert.equal(core.mask(q.answer, new Set(letters)).length, q.answer.length, q.id);
  }
});

console.log(`\n${passed} passed`);
