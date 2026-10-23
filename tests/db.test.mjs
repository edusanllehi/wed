// Pruebas del esquema y la función submit_rsvp en Postgres real (PGlite)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createDb, asRole } from "./helpers/db.mjs";

let db;
before(async () => { db = await createDb(); });

const submit = async (p, ip = null, role = "service_role") =>
  (await asRole(db, role, "select public.submit_rsvp($1::jsonb, $2) as r", [JSON.stringify(p), ip])).rows[0].r;
const base = (o = {}) => ({ submission_id: randomUUID(), language: "ca", name: "Test " + randomUUID().slice(0, 8), attending: true, with_partner: false, prewedding: false, transport: "", dietary: [], ...o });
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);

test("guarda una respuesta con pareja: 1 respuesta y 2 invitados", async () => {
  const p = base({ with_partner: true, partner_name: "Test Pareja Uno", prewedding: true, transport: "bus", dietary: ["vegan"], partner_dietary: ["gluten_free", "nuts"], message: "Hola!" });
  assert.deepEqual(await submit(p), { status: "ok", replayed: false });
  const r = (await db.query("select * from rsvp_responses where submission_id = $1", [p.submission_id])).rows[0];
  assert.equal(r.attending, true); assert.equal(r.with_partner, true); assert.equal(r.prewedding, true); assert.equal(r.transport, "bus");
  const g = (await db.query("select role, full_name, dietary from rsvp_guests where response_id = $1 order by role desc", [r.id])).rows;
  assert.deepEqual(g.map((x) => x.role), ["primary", "partner"]);
  assert.deepEqual(g[1].dietary, ["gluten_free", "nuts"]);
});

test("guarda un 'no vengo' sin datos de asistencia", async () => {
  const p = base({ attending: false, with_partner: true, partner_name: "Ignorada", prewedding: true, transport: "bus", dietary: ["vegan"], message: "x" });
  assert.equal((await submit(p)).status, "ok");
  const r = (await db.query("select * from rsvp_responses where submission_id = $1", [p.submission_id])).rows[0];
  assert.equal(r.attending, false); assert.equal(r.with_partner, false);
  assert.equal(r.prewedding, null); assert.equal(r.transport, null); assert.equal(r.message, null);
  assert.equal(await count("select count(*) n from rsvp_guests where response_id = $1", [r.id]), 1);
  assert.equal(await count("select count(*) n from rsvp_guests where response_id = $1 and dietary = '{}'", [r.id]), 1);
});

test("reenviar el mismo envío (misma clave) no duplica", async () => {
  const p = base();
  assert.equal((await submit(p)).replayed, false);
  assert.deepEqual(await submit(p), { status: "ok", replayed: true });
  assert.deepEqual(await submit(p), { status: "ok", replayed: true });
  assert.equal(await count("select count(*) n from rsvp_responses where submission_id = $1", [p.submission_id]), 1);
});

test("el mismo nombre no puede responder dos veces (mayúsculas y espacios incluidos)", async () => {
  await submit(base({ name: "Marta  Ribas" }));
  assert.equal((await submit(base({ name: "  marta ribas " }))).status, "duplicate");
  // la pareja de una respuesta tampoco puede responder por su cuenta
  await submit(base({ name: "Pau Serra", with_partner: true, partner_name: "Laia Font" }));
  assert.equal((await submit(base({ name: "LAIA FONT" }))).status, "duplicate");
  assert.equal(await count("select count(*) n from rsvp_guests where name_key = 'laia font'"), 1);
});

test("rechaza datos no válidos sin guardar nada", async () => {
  const before = await count("select count(*) n from rsvp_responses");
  for (const p of [
    base({ dietary: ["chocolate"] }),
    base({ name: "A" }),
    base({ with_partner: true, partner_name: null }),
    base({ language: "fr" }),
    base({ transport: "helicopter" }),
    { ...base(), submission_id: "no-es-un-uuid" },
    base({ message: "x".repeat(2001) }),
  ]) assert.equal((await submit(p)).status, "invalid", JSON.stringify(p).slice(0, 80));
  assert.equal(await count("select count(*) n from rsvp_responses"), before);
});

test("máximo titular + pareja por respuesta (restricción en la base de datos)", async () => {
  const p = base({ with_partner: true, partner_name: "Pareja Limite" });
  await submit(p);
  const id = (await db.query("select id from rsvp_responses where submission_id = $1", [p.submission_id])).rows[0].id;
  await assert.rejects(db.query("insert into rsvp_guests (response_id, role, full_name) values ($1, 'partner', 'Tercera Persona')", [id]));
  await assert.rejects(db.query("insert into rsvp_guests (response_id, role, full_name) values ($1, 'guest', 'Otra Persona')", [id]));
});

test("límite de envíos por conexión: 20 cada 10 minutos", async () => {
  const ip = "hash-" + randomUUID();
  for (let i = 0; i < 20; i++) assert.equal((await submit(base(), ip)).status, "ok");
  assert.equal((await submit(base(), ip)).status, "rate_limited");
  assert.equal((await submit(base(), "otro-" + ip)).status, "ok");
});

test("seguridad: el público (anon/authenticated) no puede leer, escribir ni llamar a la función", async () => {
  for (const role of ["anon", "authenticated"]) {
    for (const sql of [
      "select * from rsvp_responses", "select * from rsvp_guests", "select * from rsvp_export", "select * from rsvp_totals",
      "insert into rsvp_responses (submission_id, attending, language) values (gen_random_uuid(), true, 'es')",
      "update rsvp_guests set full_name = 'hack'", "delete from rsvp_responses",
      "select public.submit_rsvp('{}'::jsonb, null)",
    ]) await assert.rejects(asRole(db, role, sql), /permission denied/, `${role}: ${sql}`);
  }
  const rls = (await db.query("select relname, relrowsecurity from pg_class where relname in ('rsvp_responses','rsvp_guests')")).rows;
  assert.ok(rls.length === 2 && rls.every((r) => r.relrowsecurity));
});

test("RLS bloquea filas aunque alguien concediera permisos por error", async () => {
  await db.exec("grant select on rsvp_responses to anon");
  const r = await asRole(db, "anon", "select count(*)::int n from rsvp_responses");
  assert.equal(r.rows[0].n, 0);
  await db.exec("revoke select on rsvp_responses from anon");
});

test("vosotros (service_role / panel) podéis exportar y ver totales", async () => {
  const exp = await asRole(db, "service_role", "select * from rsvp_export");
  assert.ok(exp.rows.length > 0);
  assert.deepEqual(exp.fields.map((f) => f.name), ["fecha", "invitado", "rol", "asiste", "preboda", "transporte", "dieta", "dieta_detalle", "mensaje", "idioma", "respuesta_id"]);
  const tot = (await asRole(db, "service_role", "select * from rsvp_totals")).rows[0];
  assert.ok(Number(tot.personas_que_vienen) > 0);
});

test("los datos sobreviven a cerrar y reabrir la base de datos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rsvp-pg-"));
  const { readFileSync, readdirSync } = await import("node:fs");
  let d = new PGlite(dir);
  await d.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  const mig = join(import.meta.dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(mig).sort()) await d.exec(readFileSync(join(mig, f), "utf8"));
  const id = randomUUID();
  await d.query("select public.submit_rsvp($1::jsonb, null)", [JSON.stringify(base({ submission_id: id, name: "Persistente Uno" }))]);
  await d.close();
  d = new PGlite(dir);
  const n = (await d.query("select count(*)::int n from rsvp_responses where submission_id = $1", [id])).rows[0].n;
  assert.equal(n, 1);
  await d.close();
});

test("la migración se puede ejecutar dos veces sin perder datos", async () => {
  const before = await count("select count(*) n from rsvp_responses");
  const { readFileSync, readdirSync } = await import("node:fs");
  const mig = join(import.meta.dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(mig).sort()) await db.exec(readFileSync(join(mig, f), "utf8"));
  assert.equal(await count("select count(*) n from rsvp_responses"), before);
});
