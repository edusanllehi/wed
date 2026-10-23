// Descarga todas las respuestas a un CSV en vuestro ordenador.
// Uso: npm run export:csv   (necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local"); process.exit(1); }

const headers = { apikey: key, Accept: "text/csv" };
if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key;
const r = await fetch(url.replace(/\/+$/, "") + "/rest/v1/rsvp_export?select=*", { headers });
if (!r.ok) { console.error("Error al exportar: HTTP", r.status); process.exit(1); }
const csv = await r.text();
const file = `rsvp-${new Date().toISOString().slice(0, 10)}.csv`;
writeFileSync(file, "﻿" + csv); // BOM para que Excel lea bien los acentos
console.log(`Guardado ${file} (${Math.max(0, csv.trim().split("\n").length - 1)} filas)`);
