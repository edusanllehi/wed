// Genera dist/ (web para Vercel). Con --preview genera preview/index.html:
// un único archivo autocontenido para vista previa, con el formulario desactivado.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const LANGS = ["ca", "es", "en"];

// 1. Traducciones: los tres idiomas deben tener exactamente las mismas claves
const I18N = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(readFileSync(join(src, "i18n", l + ".json"), "utf8"))]));
const allKeys = new Set(LANGS.flatMap((l) => Object.keys(I18N[l])));
const problems = [];
for (const l of LANGS) for (const k of allKeys) if (!(k in I18N[l])) problems.push(`${l}: falta "${k}"`);
const html = readFileSync(join(src, "index.html"), "utf8");
const app = readFileSync(join(src, "app.js"), "utf8");
for (const m of html.matchAll(/data-i18n(?:-html|-ph|-aria)?="([^"]+)"/g)) if (!allKeys.has(m[1])) problems.push(`index.html usa "${m[1]}" y no existe`);
if (problems.length) { console.error("Errores de traducción:\n" + problems.join("\n")); process.exit(1); }

const i18nJs = "window.I18N=" + JSON.stringify(I18N) + ";\n";

if (process.argv.includes("--preview")) {
  const dataUri = (f) => "data:image/jpeg;base64," + readFileSync(join(src, "assets", f)).toString("base64");
  let out = html
    .replace('<script src="/i18n.js" defer></script>', "")
    .replace('<script src="/app.js" defer></script>', "")
    .replaceAll("/assets/poster.jpg", dataUri("poster.jpg"))
    .replaceAll("/assets/shoes.jpg", dataUri("shoes.jpg"))
    .replace("</body>", `<script>${i18nJs}window.RSVP_ENDPOINT="";\n${app}</script>\n</body>`);
  mkdirSync(join(root, "preview"), { recursive: true });
  writeFileSync(join(root, "preview", "index.html"), out);
  console.log("preview/index.html listo");
} else {
  const dist = join(root, "dist");
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), html);
  writeFileSync(join(dist, "app.js"), app);
  writeFileSync(join(dist, "i18n.js"), i18nJs);
  writeFileSync(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  for (const f of readdirSync(join(src, "assets"))) cpSync(join(src, "assets", f), join(dist, "assets", f));
  console.log("dist/ listo:", readdirSync(dist).join(", "));
}
