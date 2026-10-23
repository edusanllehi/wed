// Servidor local para probar la web: sirve dist/ y /api/rsvp con el mismo código que Vercel.
// Uso: npm run dev   (lee .env.local si existe)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const envFile = join(root, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const { default: rsvp } = await import("../api/rsvp.js");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".css": "text/css" };

export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/rsvp") return rsvp(req, res);
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p === "/" || p === "\\") p = "/index.html";
    const file = join(dist, p);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const s = await startServer();
  console.log("Web local en http://localhost:" + s.address().port);
}
