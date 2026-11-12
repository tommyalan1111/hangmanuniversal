/*
 * Layout check for long answers: renders puzzles up to 25 characters and flags
 * horizontal overflow. Run: node tools/long-answer-check.mjs
 * Screenshots land in .shots/long-*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.shots');
const PORT = 9336;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 25 characters, no spaces */
const LONG_ONE_WORD = 'PSYCHONEUROENDOCRINOLOGY';
/* 25 characters including spaces */
const LONG_WITH_SPACES = 'THE QUICK BROWN FOX JUMPS';
/* the old limit, as a baseline */
const BASELINE = 'ELECTROENCEPHALOGRAPHIC';

const CASES = [
  { name: 'long-25-word', answer: LONG_ONE_WORD, question: 'Which field studies hormones and the nervous system?' },
  { name: 'long-25-spaces', answer: LONG_WITH_SPACES, question: 'Type the famous typing-test sentence' },
  { name: 'mid-13', answer: 'EXTRAORDINARY', question: 'What word means very unusual?' },
  { name: 'short-9', answer: 'BEAUTIFUL', question: 'Which word describes something pleasing to look at?' },
  { name: 'baseline-23', answer: BASELINE, question: 'Which technique records brain electrical activity?' }
];

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'hu-long-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => {
        const list = this.listeners.get(method) || [];
        this.listeners.set(method, list.filter((x) => x !== fn));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + expression);
    return res.result.value;
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  return new Cdp(ws);
}

let cdp;
const problems = [];

try {
  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) version = await r.json();
    } catch {}
    if (!version) await sleep(150);
  }
  const page = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())[0];
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await fs.mkdir(outDir, { recursive: true });

  for (const viewport of [{ w: 360, h: 740 }, { w: 390, h: 844 }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.w, height: viewport.h, deviceScaleFactor: 2, mobile: true
    });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: URL_BASE });
    await loaded;
    await sleep(700);

    for (const item of CASES) {
      const question = {
        id: 'test-' + item.name,
        category: 'science',
        question: item.question,
        answer: item.answer,
        difficulty: 3
      };
      await cdp.eval(`window.__huStart(${JSON.stringify(question)})`);
      await sleep(350);

      const probe = await cdp.eval(`(() => {
        const slots = document.getElementById('play-slots');
        const board = document.querySelector('.board');
        const rows = slots.querySelectorAll('.slotrow').length || 1;
        const rect = slots.getBoundingClientRect();
        return {
          answerLength: ${item.answer.length},
          rows: rows,
          slotsScrollWidth: slots.scrollWidth,
          slotsClientWidth: slots.clientWidth,
          slotsRight: Math.round(rect.right),
          boardRight: Math.round(board.getBoundingClientRect().right),
          docScrollWidth: document.documentElement.scrollWidth,
          docClientWidth: document.documentElement.clientWidth,
          tile: getComputedStyle(slots).getPropertyValue('--tile').trim(),
          realTile: Math.round((slots.querySelector('.slot') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width)
        };
      })()`);

      const overflowX = probe.slotsScrollWidth > probe.slotsClientWidth + 1;
      const pageOverflow = probe.docScrollWidth > probe.docClientWidth + 1;
      if (overflowX) problems.push(`${viewport.w}px ${item.name}: slots overflow (${probe.slotsScrollWidth} > ${probe.slotsClientWidth})`);
      if (pageOverflow) problems.push(`${viewport.w}px ${item.name}: page scrolls horizontally (${probe.docScrollWidth} > ${probe.docClientWidth})`);
      console.log(`${viewport.w}px ${item.name.padEnd(16)} rows=${probe.rows} tile=${probe.tile}/real=${probe.realTile} ` +
        `slots=${probe.slotsScrollWidth}/${probe.slotsClientWidth} doc=${probe.docScrollWidth}/${probe.docClientWidth}` +
        (overflowX || pageOverflow ? '  <-- OVERFLOW' : ''));

      const rowText = await cdp.eval(`[...document.querySelectorAll('.slotrow')].map(function (row) {
        return [...row.children].map(function (c) {
          return c.classList.contains('gap') ? ' ' : '_';
        }).join('').replace(/\\s+$/, '');
      })`);
      console.log('    rows: ' + rowText.map((r) => '[' + r + ']').join(' '));

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(outDir, `long-${viewport.w}-${item.name}.png`), Buffer.from(shot.data, 'base64'));
    }

    /* the win sheet also prints the answer */
    await cdp.eval(`window.__huStart(${JSON.stringify({
      id: 'test-win',
      category: 'science',
      question: 'Which field studies hormones and the nervous system?',
      answer: LONG_ONE_WORD,
      difficulty: 3
    })})`);
    await sleep(300);
    await cdp.eval(`(() => {
      const letters = [...new Set(${JSON.stringify(LONG_ONE_WORD)}.split(''))];
      letters.forEach((ch) => {
        const key = document.querySelector('.key[data-letter="' + ch + '"]');
        if (key) key.click();
      });
    })()`);
    await sleep(900);
    const sheet = await cdp.eval(`(() => {
      const el = document.querySelector('#sheet .sheet-answer');
      if (!el) return null;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: el.textContent.trim() };
    })()`);
    if (sheet && sheet.scrollWidth > sheet.clientWidth + 1) {
      problems.push(`${viewport.w}px win sheet: answer overflows (${sheet.scrollWidth} > ${sheet.clientWidth})`);
    }
    console.log(`${viewport.w}px win sheet ${sheet ? (sheet.scrollWidth > sheet.clientWidth + 1 ? 'OVERFLOW' : 'ok') : 'missing'}`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(outDir, `long-${viewport.w}-win.png`), Buffer.from(shot.data, 'base64'));
  }

  cdp.ws.close();
} catch (err) {
  console.error('failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}

console.log(problems.length ? '\nPROBLEMS:\n  ' + problems.join('\n  ') : '\nno overflow detected');
if (problems.length) process.exitCode = 1;
