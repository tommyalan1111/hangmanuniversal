/*
 * Validates data/questions.js - run with: node tools/validate.mjs
 * Exits non-zero when the bank would break the game.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
require(path.join(here, '..', 'data', 'questions.generated.js'));
const data = require(path.join(here, '..', 'data', 'questions.js'));

const MAX_ANSWER = 25;
const errors = [];
const warnings = [];

const catIds = new Set(data.categories.map((c) => c.id));
const seenQuestions = new Map();
const seenIds = new Set();
const counts = Object.fromEntries(data.categories.map((c) => [c.id, { total: 0, 1: 0, 2: 0, 3: 0 }]));

for (const q of data.questions) {
  const where = `${q.id} "${q.answer}"`;

  if (seenIds.has(q.id)) errors.push(`${where}: duplicate id`);
  seenIds.add(q.id);

  if (!catIds.has(q.category)) errors.push(`${where}: unknown category "${q.category}"`);

  if (!/^[A-Z ]+$/.test(q.answer)) errors.push(`${where}: answer must be A-Z and spaces only`);
  if (q.answer.length > MAX_ANSWER) errors.push(`${where}: answer longer than ${MAX_ANSWER} characters`);
  if (q.answer.length < 2) errors.push(`${where}: answer too short`);
  if (q.answer !== q.answer.trim()) errors.push(`${where}: leading/trailing space`);
  if (/\s{2,}/.test(q.answer)) errors.push(`${where}: double space`);

  if (q.question.length > 90) warnings.push(`${where}: question is ${q.question.length} characters`);
  if (!q.question.trim()) errors.push(`${where}: empty question`);

  if (![1, 2, 3].includes(q.difficulty)) errors.push(`${where}: difficulty must be 1, 2 or 3`);

    const qKey = q.question.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exactKey = qKey + '|' + q.category + ':' + q.answer.toLowerCase();
  
  if (seenQuestions.has(exactKey)) {
    errors.push(`${where}: exact duplicate question and answer (also ${seenQuestions.get(exactKey)})`);
  }
  seenQuestions.set(exactKey, q.id);


  const answerKey = q.answer.toLowerCase();
  if (seenQuestions.has('ans:' + answerKey)) warnings.push(`${where}: answer also used by ${seenQuestions.get('ans:' + answerKey)}`);
  seenQuestions.set('ans:' + answerKey, q.id);

  if (counts[q.category]) {
    counts[q.category].total += 1;
    counts[q.category][q.difficulty] += 1;
  }
}

for (const c of data.categories) {
  const n = counts[c.id];
  if (n.total < 10) warnings.push(`category "${c.id}" only has ${n.total} questions`);
  if (n[1] < 3 || n[2] < 3 || n[3] < 3) {
    warnings.push(`category "${c.id}" is thin on some difficulties (1:${n[1]} 2:${n[2]} 3:${n[3]})`);
  }
}

const total = data.questions.length;
console.log(`questions: ${total}`);
for (const c of data.categories) {
  const n = counts[c.id];
  console.log(`  ${c.id.padEnd(9)} ${String(n.total).padStart(3)}   easy ${n[1]}  medium ${n[2]}  hard ${n[3]}`);
}

if (warnings.length) {
  const shown = warnings.slice(0, 15);
  console.log(`\n${warnings.length} warning(s)${warnings.length > shown.length ? ', first ' + shown.length + ':' : ':'}`);
  shown.forEach((w) => console.log('  ! ' + w));
  if (warnings.length > shown.length) console.log(`  ... ${warnings.length - shown.length} more`);
}

if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  errors.forEach((e) => console.log('  x ' + e));
  process.exit(1);
}

console.log('\nOK - bank is valid.');
