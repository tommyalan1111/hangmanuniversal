/*
 * Builds data/questions.generated.js from open data (Wikidata, CC0).
 *
 *   node tools/generate.mjs              # refresh the generated bank
 *   node tools/generate.mjs --target 6000
 *   node tools/generate.mjs --dry        # report only, write nothing
 *
 * Pipeline per fact type:
 *   SPARQL -> clean labels -> drop ambiguous subjects (same subject, 2 answers)
 *          -> template the question -> validate answer/question -> dedupe
 *          -> cap how many questions may share one answer
 *
 * Answers are facts (country names, people, titles) - CC0 data, not copied prose.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'data', 'questions.generated.js');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const targetArg = args.indexOf('--target');
const target = targetArg > -1 ? Number(args[targetArg + 1]) : 6000;

const UA = { 'user-agent': 'hangman-universal/1.0 (offline game data build)', accept: 'application/sparql-results+json' };

/* --------------------------------------------------------------- fact types */

const TYPES = [
  {
    id: 'capital',
    category: 'geo',
    cap: 4,
    templates: ['What is the capital of {X}?', 'Which city is the capital of {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q6256 ; wdt:P36 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 400`
  },
  {
    id: 'currency',
    category: 'geo',
    cap: 4,
    templates: ['Which currency is used in {X}?', 'What is the currency of {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q6256 ; wdt:P38 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 400`
  },
  {
    id: 'element',
    category: 'science',
    swap: true,
    cap: 2,
    templates: ['Which element has the chemical symbol {X}?', 'The symbol {X} stands for which element?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q11344 ; wdt:P246 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 200`
  },
  {
    id: 'city',
    category: 'geo',
    cap: 34,
    templates: [
      'In which country is the city of {X}?',
      'The city of {X} is in which country?',
      'Which country contains the city of {X}?'
    ],
    query: `SELECT ?xLabel ?yLabel WHERE {
      VALUES ?cls { wd:Q515 wd:Q1549591 wd:Q3957 }
      ?x wdt:P31 ?cls ; wdt:P17 ?y ; wdt:P1082 ?pop .
      FILTER(?pop > 150000)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 5200`
  },
  {
    id: 'mountain',
    category: 'geo',
    strip: ['Mountain', 'Mount', 'Peak'],
    cap: 18,
    templates: ['In which country is the mountain {X}?', 'Which country is home to the mountain {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q8502 ; wdt:P17 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1200`
  },
  {
    id: 'lake',
    category: 'geo',
    strip: ['Lake', 'Reservoir'],
    cap: 24,
    templates: ['In which country is the lake {X}?', 'Which country has the lake {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q23397 ; wdt:P17 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 2400`
  },
  {
    id: 'river',
    category: 'geo',
    strip: ['River', 'Rivulet', 'Creek'],
    cap: 12,
    templates: ['Which country does the river {X} flow through?', 'In which country does the river {X} flow?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q4022 ; wdt:P17 ?y .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1200`
  },
  {
    id: 'university',
    category: 'geo',
    cap: 10,
    templates: ['In which country is {X} located?', 'Which country is home to {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q3918 ; wdt:P17 ?y ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 12)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 900`
  },
  {
    id: 'film',
    category: 'movies',
    cap: 4,
    templates: ['Who directed the film {X}?', 'Which director made the film {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q11424 ; wdt:P57 ?y ; wdt:P577 ?d ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 12) FILTER(YEAR(?d) >= 1950)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 2600`
  },
  {
    id: 'book',
    category: 'books',
    cap: 4,
    templates: ['Who wrote the book {X}?', 'Which author wrote {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      VALUES ?cls { wd:Q571 wd:Q8261 wd:Q7725634 }
      ?x wdt:P31 ?cls ; wdt:P50 ?y ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 5)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1600`
  },
  {
    id: 'painting',
    category: 'art',
    cap: 5,
    templates: ['Who painted {X}?', 'Which artist created the painting {X}?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q3305213 ; wdt:P170 ?y ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 6)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1400`
  },
  {
    id: 'band',
    category: 'music',
    cap: 30,
    templates: ['Which country does the band {X} come from?', 'The band {X} was formed in which country?'],
    query: `SELECT ?xLabel ?yLabel WHERE {
      ?x wdt:P31 wd:Q215380 ; wdt:P495 ?y ; wikibase:sitelinks ?sl .
      FILTER(?sl >= 8)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1500`
  }
];

/* ----------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, attempt = 1) {
  const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query);
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json.results.bindings;
  } catch (err) {
    if (attempt >= 3) throw err;
    console.log('    retry after: ' + err.message);
    await sleep(2500 * attempt);
    return sparql(query, attempt + 1);
  }
}

/** Keeps A-Z and single spaces; strips accents and punctuation. */
function cleanAnswer(text) {
  return String(text)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes "(1997 film)" style suffixes and characters that break the bank format. */
function cleanText(text) {
  return String(text)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/["|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rough difficulty: longer answers are harder to guess. */
function difficultyFor(answer) {
  const n = answer.replace(/ /g, '').length;
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  return 3;
}

const questionKey = (q) => q.toLowerCase().replace(/[^a-z0-9]/g, '');

/* --------------------------------------------------------------- generation */

const seenQuestions = new Set();

/* seed with the hand-written bank so a generated question never duplicates it */
{
  const src = fs.readFileSync(path.join(root, 'data', 'questions.js'), 'utf8');
  const start = src.indexOf('var CURATED = [');
  const end = src.indexOf('\n  ];', start);
  if (start > -1 && end > -1) {
    const chunk = src.slice(start, end);
    let seeded = 0;
    for (const m of chunk.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      const parts = m[1].replace(/\\'/g, "'").split('|');
      if (parts.length >= 3 && parts[1]) { seenQuestions.add(questionKey(parts[1])); seeded++; }
    }
    console.log('seeded ' + seeded + ' curated questions for de-duplication');
  }
}
const answerUse = new Map();
const byCategory = new Map();
const report = [];

for (const type of TYPES) {
  process.stdout.write(`${type.id.padEnd(9)} fetching... `);
  let rows = [];
  try {
    rows = await sparql(type.query);
  } catch (err) {
    console.log('FAILED (' + err.message + ')');
    report.push({ id: type.id, raw: 0, kept: 0, error: err.message });
    continue;
  }

  /* same subject must have exactly one answer, otherwise the clue is ambiguous */
  const answers = new Map();
  for (const row of rows) {
    let subject = cleanText(row.xLabel?.value || '');
    let answer = cleanAnswer(row.yLabel?.value || '');

    if (type.swap) {
      const swap = subject;
      subject = cleanText(row.yLabel?.value || '');
      answer = cleanAnswer(swap);
    }

    if (type.strip && subject) {
      for (const suffix of type.strip) {
        const tail = new RegExp('\\s+' + suffix + '$', 'i');
        if (tail.test(subject)) subject = subject.replace(tail, '');
      }
    }

    /* systematic placeholder element names (unpentunium, unhexoctium...) are not worth asking */
    if (/^UN[A-Z]*IUM$/.test(answer)) continue;
    if (!subject || !answer) continue;

    if (!answers.has(subject)) answers.set(subject, new Set());
    answers.get(subject).add(answer);
  }

  let kept = 0;
  let dropped = 0;

  for (const [subject, answerSet] of answers) {
    if (answerSet.size !== 1) { dropped++; continue; }
    const answer = [...answerSet][0];

    if (answer.length < 3 || answer.length > 16) { dropped++; continue; }
    if (!/^[A-Z][A-Z ]*$/.test(answer)) { dropped++; continue; }
    if (answer.replace(/ /g, '').length < 3) { dropped++; continue; }

    const template = type.templates[hash(subject) % type.templates.length];
    const question = cleanText(template.replace('{X}', subject));
    if (!question || question.length < 12 || question.length > 88) { dropped++; continue; }
    if (question.includes('|')) { dropped++; continue; }

    const key = questionKey(question);
    if (seenQuestions.has(key)) { dropped++; continue; }

    const answerKey = type.id + ':' + answer;
    const used = answerUse.get(answerKey) || 0;
    if (used >= type.cap) { dropped++; continue; }

    seenQuestions.add(key);
    answerUse.set(answerKey, used + 1);

    const line = [type.category, question, answer, difficultyFor(answer)].join('|');
    if (!byCategory.has(type.category)) byCategory.set(type.category, []);
    byCategory.get(type.category).push({ line, answer, question });
    kept++;
  }

  console.log(`${String(rows.length).padStart(5)} rows -> ${String(kept).padStart(4)} kept, ${dropped} dropped`);
  report.push({ id: type.id, raw: rows.length, kept, dropped });
  await sleep(400);
}

/* ---------------------------------------------------------------- assemble */

const categories = [...byCategory.keys()].sort();
const lines = [];
for (const cat of categories) {
  const items = byCategory.get(cat).sort((a, b) => a.question.localeCompare(b.question));
  lines.push(`\n    /* --- ${cat} (${items.length}) --- */`);
  items.forEach((item) => lines.push("    '" + item.line.replace(/'/g, "\\'") + "',"));
}

const total = categories.reduce((n, c) => n + byCategory.get(c).length, 0);
const stamp = new Date().toISOString().slice(0, 10);

const body = `/*
 * GENERATED FILE - do not edit by hand.
 * Rebuild with: node tools/generate.mjs
 *
 * Source: Wikidata (CC0 1.0). Facts are not copyrightable; questions are
 * produced from templates in tools/generate.mjs.
 * Built: ${stamp} - ${total} questions.
 */
(function (root) {
  'use strict';

  root.HM_GENERATED = [
${lines.join('\n')}
  ];

  if (typeof module === 'object' && module.exports) {
    module.exports = root.HM_GENERATED;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

console.log('');
console.log('per type:');
report.forEach((r) => console.log('  ' + r.id.padEnd(9) + String(r.kept).padStart(5) + (r.error ? '  ! ' + r.error : '')));
console.log('per category:');
for (const cat of categories) console.log('  ' + cat.padEnd(9) + String(byCategory.get(cat).length).padStart(5));
console.log('\ntotal: ' + total + ' questions' + (total > target ? ' (target ' + target + ')' : ''));

if (dry) {
  console.log('\n--dry: nothing written. sample:');
  lines.slice(0, 12).forEach((l) => console.log(l));
  process.exit(0);
}

fs.writeFileSync(outFile, body);
console.log('\nwrote ' + path.relative(root, outFile) + ' (' + Math.round(body.length / 1024) + ' KB)');
