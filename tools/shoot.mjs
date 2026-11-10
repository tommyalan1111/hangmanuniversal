/*
 * Screenshot harness: drives real Chrome over CDP so the screenshots show the
 * exact UI a player sees. Run: node tools/shoot.mjs
 * Output: .shots/*.png
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, '.shots');
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL_BASE = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return res.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('chrome devtools never came up');
}

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
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + expression);
    return res.result.value;
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${path.join(os.tmpdir(), 'hu-shots-' + Date.now())}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--force-color-profile=srgb',
  'about:blank'
], { stdio: 'ignore' });

let cdp;
const shots = [];

try {
  const version = await waitForDevtools();
  const browser = await connect(version.webSocketDebuggerUrl);
  const target = await browser.send('Target.createTarget', { url: 'about:blank' });
  const info = await browser.send('Target.getTargetInfo', { targetId: target.targetId });
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.id === target.targetId) || list[0];
  cdp = await connect(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });

  async function navigate(hash = '') {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: URL_BASE + hash });
    await loaded;
    await sleep(650);
  }

  async function shot(name) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = path.join(outDir, name + '.png');
    await fs.writeFile(file, Buffer.from(data, 'base64'));
    shots.push(file);
    console.log('  shot ' + name);
  }

  async function type(letters) {
    for (const ch of letters) {
      await cdp.eval(`document.querySelector('.key[data-letter="${ch}"]').click()`);
      await sleep(90);
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  await navigate();
  await shot('01-home');

  await cdp.eval(`document.getElementById('btn-continue').click()`);
  await sleep(700);
  await shot('02-play');

  /* reveal most letters and burn two lives so the board looks like real play */
  const answer = await cdp.eval(`window.__huAnswer()`);
  const unique = [...new Set(answer.replace(/ /g, '').split(''))];
  const wrong = 'QXZJKVW'.split('').filter((c) => !unique.includes(c)).slice(0, 3);
  await type(unique.slice(0, Math.max(1, unique.length - 2)).join(''));
  await type(wrong.join(''));
  await sleep(350);
  await shot('03-play-mid');

  await type(unique.slice(-2).join(''));
  await sleep(900);
  await shot('04-win');

  await cdp.eval(`document.getElementById('btn-exit').click()`);
  await sleep(300);
  await cdp.eval(`document.getElementById('btn-categories').click()`);
  await sleep(500);
  await shot('05-categories');

  /* lose state: a fresh level, six wrong letters */
  await cdp.eval(`document.querySelector('#screen-categories [data-back]').click()`);
  await sleep(300);
  await cdp.eval(`document.getElementById('btn-continue').click()`);
  await sleep(600);
  const answer2 = await cdp.eval(`window.__huAnswer()`);
  const uniq2 = [...new Set(answer2.replace(/ /g, '').split(''))];
  const misses = 'QXZJKVWYBPF'.split('').filter((c) => !uniq2.includes(c)).slice(0, 6);
  await type(misses.join(''));
  await sleep(1000);
  await shot('06-lose');

  /* compact phone, worst case for wrapping */
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 360, height: 740, deviceScaleFactor: 2, mobile: true
  });
  await navigate();
  await sleep(400);
  await shot('09-small-home');
  await cdp.eval(`document.getElementById('btn-continue').click()`);
  await sleep(600);
  const answer3 = await cdp.eval(`window.__huAnswer()`);
  const uniq3 = [...new Set(answer3.replace(/ /g, '').split(''))];
  await type(uniq3.slice(0, 3).join(''));
  await sleep(300);
  await shot('10-small-play');

  /* desktop framing */
  await cdp.eval(`document.getElementById('btn-exit')?.click()`);
  await cdp.eval(`document.querySelector('#screen-play [data-back]')?.click()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
  });
  await navigate();
  await sleep(500);
  await shot('07-desktop-home');
  await cdp.eval(`document.getElementById('btn-continue').click()`);
  await sleep(700);
  await shot('08-desktop-play');

  console.log('\nwrote ' + shots.length + ' screenshots to ' + outDir);
} catch (err) {
  console.error('failed:', err.message);
  process.exitCode = 1;
} finally {
  try { await cdp?.send('Browser.close'); } catch {}
  chrome.kill();
}
