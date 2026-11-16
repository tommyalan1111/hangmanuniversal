/*
 * Attaches to the running app's WebView and prints runtime state + console errors.
 *   node tools/debug-webview.mjs
 * Requires a debuggable build installed on a connected device.
 */
import { spawnSync } from 'node:child_process';

const ADB = process.env.ADB || 'C:\\Users\\tommy\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';
const PKG = 'com.hangmanuniversal.game';
const PORT = 9337;

const run = (args) => spawnSync(ADB, args, { encoding: 'utf8' });

const pid = (run(['shell', 'pidof', PKG]).stdout || '').trim();
if (!pid) {
  console.error('app is not running — start it first');
  process.exit(1);
}
console.log('pid: ' + pid);

run(['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets = null;
for (let i = 0; i < 20 && !targets; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    if (res.ok) targets = await res.json();
  } catch {}
  if (!targets) await sleep(300);
}
if (!targets || !targets.length) {
  console.error('no devtools target found');
  process.exit(1);
}

const page = targets.find((t) => t.type === 'page') || targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let id = 0;
const pending = new Map();
const logs = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id);
    pending.delete(msg.id);
    resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push('[console.' + msg.params.type + '] ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push('[exception] ' + (d.exception?.description || d.text));
  }
});

const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve) => pending.set(i, { resolve }));
};

await send('Runtime.enable');
await sleep(600);

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true });
  return res.result?.value;
};

const report = await evaluate(`JSON.stringify({
  url: location.href,
  readyState: document.readyState,
  hasData: typeof window.HangmanData,
  questions: window.HangmanData ? window.HangmanData.questions.length : null,
  categories: window.HangmanData ? window.HangmanData.categories.length : null,
  hasCore: typeof window.HMCore,
  hasApp: typeof window.HangmanApp,
  keypadKeys: document.querySelectorAll('.key').length,
  coins: document.getElementById('home-coins')?.textContent,
  solved: document.getElementById('home-solved')?.textContent
})`);

console.log('state: ' + report);
if (logs.length) {
  console.log('console:');
  logs.slice(-12).forEach((l) => console.log('  ' + l));
} else {
  console.log('console: (nothing captured)');
}

ws.close();
