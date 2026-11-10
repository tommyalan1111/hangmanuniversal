/*
 * Bulk importer: CSV or JSON -> validated rows appended to data/questions.js
 *
 *   node tools/import.mjs examples/sample-import.csv
 *   node tools/import.mjs my-questions.json --dry
 *
 * CSV  : header row with category,question,answer,difficulty (any order, quoted
 *        fields supported). Extra columns are ignored.
 * JSON : [{ "category": "geo", "question": "...", "answer": "NORWAY", "difficulty": 2 }]
 *        or a plain array of "category|question|ANSWER|difficulty" strings.
 *
 * Rules enforced (same as tools/validate.mjs):
 *   - category must exist in the bank
 *   - answer: A-Z and single spaces only, 2..16 characters
 *   - question: 1..90 characters, no "|"
 *   - difficulty: 1, 2 or 3
 * Nothing is written when a row is invalid, unless --force is passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const bankPath = path.join(root, 'data', 'questions.js');
const bank = require(bankPath);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const input = args.find((a) => !a.startsWith('--'));
const dry = flags.has('--dry');
const force = flags.has('--force');

if (!input) {
  console.error('usage: node tools/import.mjs <file.csv|file.json> [--dry] [--force]');
  process.exit(1);
}

/* ----------------------------------------------------------------- parsing */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return [];

  const header = clean[0].map((h) => h.trim().toLowerCase());
  const index = {
    category: header.indexOf('category'),
    question: header.indexOf('question'),
    answer: header.indexOf('answer'),
    difficulty: header.indexOf('difficulty')
  };

  const missing = Object.entries(index).filter(([, i]) => i === -1).map(([k]) => k);
  if (missing.length) {
    throw new Error('CSV header is missing: ' + missing.join(', ') + ' (got: ' + clean[0].join(', ') + ')');
  }

  return clean.slice(1).map((r) => ({
    category: (r[index.category] || '').trim(),
    question: (r[index.question] || '').trim(),
    answer: (r[index.answer] || '').trim(),
    difficulty: (r[index.difficulty] || '').trim()
  }));
}

function parseJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('JSON root must be an array');
  return data.map((item) => {
    if (typeof item === 'string') {
      const parts = item.split('|');
      return { category: parts[0], question: parts[1], answer: parts[2], difficulty: parts[3] };
    }
    return {
      category: item.category ?? item.cat ?? '',
      question: item.question ?? item.clue ?? '',
      answer: item.answer ?? item.word ?? '',
      difficulty: item.difficulty ?? item.level ?? 1
    };
  });
}

/* -------------------------------------------------------------- validation */

function normalizeAnswer(raw) {
  return String(raw == null ? '' : raw)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const categoryIds = new Set(bank.categories.map((c) => c.id));
const knownQuestion = new Map();
const knownAnswer = new Map();
bank.questions.forEach((q) => {
  knownQuestion.set(q.question.toLowerCase().replace(/[^a-z0-9]/g, ''), q.id);
  knownAnswer.set(q.category + ':' + q.answer.toLowerCase(), q.id);
});

const errors = [];
const warnings = [];
const accepted = [];

const text = fs.readFileSync(path.resolve(process.cwd(), input), 'utf8');
const rows = /\.json$/i.test(input) ? parseJson(text) : parseCsv(text);

rows.forEach((row, i) => {
  const where = 'row ' + (i + 1);
  const before = errors.length;
  const category = String(row.category || '').trim();
  const question = String(row.question || '').replace(/\s+/g, ' ').trim();
  const answer = normalizeAnswer(row.answer);
  const difficulty = Number(String(row.difficulty || '').trim() || 1);

  if (!categoryIds.has(category)) {
    errors.push(where + ': unknown category "' + category + '" (use: ' + [...categoryIds].join(', ') + ')');
    return;
  }
  if (!question) errors.push(where + ': empty question');
  else if (question.length > 90) errors.push(where + ': question is ' + question.length + ' characters (max 90)');
  else if (question.includes('|')) errors.push(where + ': question contains "|"');

  if (!answer) errors.push(where + ': empty answer');
  else if (answer.length < 2) errors.push(where + ': answer too short');
  else if (answer.length > 16) errors.push(where + ': answer longer than 16 characters');

  if (![1, 2, 3].includes(difficulty)) errors.push(where + ': difficulty must be 1, 2 or 3');
  if (errors.length > before) return;

  const qKey = question.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (knownQuestion.has(qKey)) {
    warnings.push(where + ': duplicate question, skipped (already ' + knownQuestion.get(qKey) + ')');
    return;
  }
  const aKey = category + ':' + answer.toLowerCase();
  if (knownAnswer.has(aKey)) {
    warnings.push(where + ': answer "' + answer + '" already used in ' + category + ', keeping anyway');
  }

  knownQuestion.set(qKey, 'new');
  knownAnswer.set(aKey, 'new');
  accepted.push({ category, question, answer, difficulty });
});

/* ------------------------------------------------------------------ report */

console.log('file:     ' + input);
console.log('rows:     ' + rows.length);
console.log('accepted: ' + accepted.length);
console.log('skipped:  ' + (rows.length - accepted.length - errors.length));

warnings.forEach((w) => console.log('  ! ' + w));
if (errors.length) {
  console.log('');
  errors.forEach((e) => console.log('  x ' + e));
}

if (!accepted.length) {
  console.log('\nnothing to import.');
  process.exit(errors.length && !force ? 1 : 0);
}

if (dry) {
  console.log('\n--dry run, these would be added:');
  accepted.forEach((r) => console.log('  ' + r.category + '|' + r.question + '|' + r.answer + '|' + r.difficulty));
  process.exit(errors.length ? 1 : 0);
}

if (errors.length && !force) {
  console.log('\naborted: fix the errors above, or pass --force to import the valid rows only.');
  process.exit(1);
}

/* ------------------------------------------------------------------- write */

const source = fs.readFileSync(bankPath, 'utf8');
const rawStart = source.indexOf('var CURATED = [');
const rawEnd = source.indexOf('\n  ];', rawStart);
if (rawStart === -1 || rawEnd === -1) throw new Error('could not locate the RAW array in data/questions.js');

const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
let head = source.slice(0, rawEnd);
const tail = source.slice(rawEnd);

if (!/,\s*$/.test(head)) head += ',';

const block =
  '\n\n    /* --- imported ' + stamp + ' from ' + path.basename(input) + ' --- */\n' +
  accepted
    .map((r) => "    '" + [r.category, r.question, r.answer, r.difficulty].join('|').replace(/'/g, "\\'") + "',")
    .join('\n');

const backupDir = path.join(root, '.backup');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, 'questions-' + Date.now() + '.js');
fs.copyFileSync(bankPath, backupFile);

fs.writeFileSync(bankPath, head + block + tail);

console.log('\nadded ' + accepted.length + ' question(s) to data/questions.js');
console.log('backup:  ' + path.relative(root, backupFile));

const check = spawnSync(process.execPath, [path.join(here, 'validate.mjs')], { stdio: 'inherit' });
process.exit(check.status || 0);
