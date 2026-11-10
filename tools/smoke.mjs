/*
 * End-to-end smoke test: plays a real round in headless Chrome and asserts the
 * economy, level progression and persistence. Run: node tools/smoke.mjs
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9335;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'hu-smoke-' + Date.now())}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
  console.log((condition ? '  ok   ' : '  FAIL ') + name + (condition || !detail ? '' : ' -> ' + detail));
}

try {
  let version = null;
  for (let i = 0; i < 80 && !version; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) version = await r.json();
    } catch {}
    if (!version) await sleep(150);
  }
  if (!version) throw new Error('devtools unreachable');

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
    }
  });
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result.value;
  };
  const loaded = () => new Promise((resolve) => {
    const fn = () => { ws.removeEventListener('message', handler); resolve(); };
    const handler = (ev) => { if (JSON.parse(ev.data).method === 'Page.loadEventFired') fn(); };
    ws.addEventListener('message', handler);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await loaded();
  await sleep(600);

  /* clear stored progress so the run is deterministic */
  await evaluate('localStorage.clear()');
  await send('Page.navigate', { url: URL });
  await loaded();
  await sleep(600);

  const start = await evaluate('JSON.stringify(window.HangmanApp.save)');
  const before = JSON.parse(start);
  check('fresh save has 120 coins at level 1', before.coins === 120 && before.level === 1, start);

  await evaluate(`document.getElementById('btn-continue').click()`);
  await sleep(500);

  const answer = await evaluate('window.__huAnswer()');
  check('a puzzle is on screen', typeof answer === 'string' && answer.length > 0, String(answer));

  const letters = [...new Set(answer.replace(/ /g, '').split(''))];
  for (const ch of letters) {
    await evaluate(`document.querySelector('.key[data-letter="${ch}"]').click()`);
    await sleep(40);
  }
  await sleep(900);

  const won = await evaluate(`!document.getElementById('overlay').hidden && document.getElementById('sheet').className.includes('win')`);
  check('winning reveals the result sheet', won);

  const afterWin = JSON.parse(await evaluate('JSON.stringify(window.HangmanApp.save)'));
  check('coins increased', afterWin.coins > before.coins, `${before.coins} -> ${afterWin.coins}`);
  check('level advanced to 2', afterWin.level === 2, String(afterWin.level));
  check('streak counted', afterWin.streak === 1, String(afterWin.streak));
  check('question marked as solved', Object.keys(afterWin.solved).length === 1);

  await evaluate(`document.getElementById('btn-next').click()`);
  await sleep(500);
  const second = await evaluate('window.__huAnswer()');
  check('next level shows a different word', second !== answer, `${answer} -> ${second}`);

  await send('Page.navigate', { url: URL });
  await loaded();
  await sleep(600);
  const reloaded = JSON.parse(await evaluate('JSON.stringify(window.HangmanApp.save)'));
  const shownLevel = await evaluate(`document.getElementById('home-level').textContent`);
  check('progress survives reload', reloaded.level === 2 && reloaded.coins === afterWin.coins);
  check('home renders saved level', shownLevel === '2', String(shownLevel));

  /* losing path: spend all six lives on a fresh board */
  await evaluate(`document.getElementById('btn-continue').click()`);
  await sleep(400);
  const answer3 = await evaluate('window.__huAnswer()');
  const used = new Set(answer3.replace(/ /g, '').split(''));
  const doomed = 'QXZJKVWYBPF'.split('').filter((c) => !used.has(c)).slice(0, 6);
  for (const ch of doomed) {
    await evaluate(`document.querySelector('.key[data-letter="${ch}"]').click()`);
    await sleep(40);
  }
  await sleep(900);
  const lost = await evaluate(`!document.getElementById('overlay').hidden && document.getElementById('sheet').className.includes('lose')`);
  check('six wrong letters end the round', lost);
  const answerHidden = await evaluate(`document.getElementById('lose-answer').textContent.trim() === ''`);
  check('lost sheet hides the answer', answerHidden === true, String(answerHidden));

  await evaluate('window.HangmanApp.save.coins = 500');
  await evaluate(`document.getElementById('btn-reveal').click()`);
  await sleep(250);
  const revealed = await evaluate(
    `document.getElementById('lose-answer').textContent.includes(${JSON.stringify(answer3)})`
  );
  const coinsAfterReveal = await evaluate('window.HangmanApp.save.coins');
  check('reveal button shows the answer', revealed === true, String(revealed));
  check('reveal charges 200 coins', coinsAfterReveal === 300, String(coinsAfterReveal));

  const afterLose = JSON.parse(await evaluate('JSON.stringify(window.HangmanApp.save)'));
  check('streak resets on a loss', afterLose.streak === 0, String(afterLose.streak));

  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  ws.close();
} catch (err) {
  console.error('smoke failed:', err.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed}/${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
if (failed) process.exitCode = 1;
