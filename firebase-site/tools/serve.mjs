/*
 * Tiny static server for local checks of firebase-site/public.
 * Mimics the Firebase Hosting behaviour we rely on: /privacy and /privacy/
 * both serve privacy.html, and 404.html is returned for misses.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, "..", "public");
const port = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

async function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const rel = clean.replace(/^\/+|\/+$/g, "");
  const full = path.join(pub, rel);

  if (!full.startsWith(pub)) return null;

  let target = full;
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = path.join(target, "index.html");
  } catch {
    if (!path.extname(target)) {
      try {
        const html = `${target}.html`;
        await fs.stat(html);
        target = html;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  try {
    return { target, body: await fs.readFile(target) };
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const found = await resolve(req.url || "/");
  if (!found) {
    try {
      const body = await fs.readFile(path.join(pub, "404.html"));
      res.writeHead(404, { "content-type": MIME[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  res.writeHead(200, {
    "content-type": MIME[path.extname(found.target)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(found.body);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`site: http://127.0.0.1:${port}/`);
});
