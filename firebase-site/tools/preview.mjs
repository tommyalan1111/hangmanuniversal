/*
 * Local visual + sanity check for the site.
 * Drives headless Chrome over CDP, captures full-page PNGs and reports
 * console errors, failed requests, horizontal overflow and broken images.
 *
 * Run: node tools/preview.mjs
 * Output: .shots/
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", ".shots");
const PORT = 9334;
const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:4173";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("Chrome DevTools never came up");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
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

  once(method, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting ${method}`)), timeout);
      const fn = (params) => {
        clearTimeout(timer);
        const list = this.listeners.get(method) || [];
        this.listeners.set(method, list.filter((x) => x !== fn));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
    });
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || "evaluate failed");
    }
    return res.result.value;
  }
}

async function shoot(cdp, name, width, height, mobile, url = "/") {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  });

  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `${BASE}${url}` });
  await loaded;
  await sleep(900);

  const report = await cdp.eval(`(() => {
    const imgs = [...document.images].filter((i) => !i.complete || i.naturalWidth === 0);
    const links = [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href'));
    return {
      title: document.title,
      description: document.querySelector('meta[name=description]')?.content || '',
      h1: document.querySelector('h1')?.innerText,
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      brokenImages: imgs.map((i) => i.src),
      localLinks: [...new Set(links)],
    };
  })()`);

  const metrics = await cdp.send("Page.getLayoutMetrics");
  const size = metrics.cssContentSize;
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
    clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
  });
  await fs.writeFile(path.join(outDir, name), Buffer.from(shot.data, "base64"));

  return report;
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "hangman-site-"));

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");

    cdp.listeners.set("Runtime.exceptionThrown", [
      (p) => cdp.errors.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`),
    ]);
    cdp.listeners.set("Log.entryAdded", [
      (p) => {
        if (p.entry.level === "error") cdp.errors.push(`log: ${p.entry.text}`);
      },
    ]);
    cdp.listeners.set("Network.loadingFailed", [
      (p) => cdp.errors.push(`request failed: ${p.errorText}`),
    ]);
    await cdp.send("Network.enable");

    const desktop = await shoot(cdp, "site-desktop.png", 1440, 950, false);
    const mobile = await shoot(cdp, "site-mobile.png", 390, 844, true);
    const privacy = await shoot(cdp, "site-privacy.png", 1440, 950, false, "/privacy/");

    console.log(JSON.stringify({ desktop, mobile, privacy, consoleErrors: cdp.errors }, null, 2));
    ws.close();
  } finally {
    chrome.kill();
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
