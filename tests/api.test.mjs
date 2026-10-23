// Pruebas del endpoint /api/rsvp (validación y comunicación con Supabase)
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import handler, { validate } from "../api/rsvp.js";

const realFetch = globalThis.fetch;
let fetchCalls, nextReply;
beforeEach(() => {
  process.env.SUPABASE_URL = "https://demo.supabase.co/";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJ.fake.jwt";
  process.env.RSVP_HASH_SALT = "salt";
  delete process.env.ALLOWED_ORIGINS;
  fetchCalls = [];
  nextReply = async () => new Response(JSON.stringify({ status: "ok", replayed: false }), { status: 200 });
  globalThis.fetch = async (url, init) => { fetchCalls.push({ url, init }); return nextReply(); };
});
afterEach(() => { globalThis.fetch = realFetch; });

function call({ method = "POST", body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(s) { resolve({ status: this.statusCode, body: s ? JSON.parse(s) : null, headers: this.headers }); },
    };
    const req = { method, body, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1", ...headers }, socket: {} };
    handler(req, res);
  });
}
const ok = (o = {}) => ({ submission_id: randomUUID(), language: "es", name: "Ana García", attending: "yes", with_partner: "alone", prewedding: "yes", transport: "bus", dietary: ["vegan"], dietary_other: "", message: "¡Hola!", ...o });

test("solo acepta POST", async () => {
  const r = await call({ method: "GET" });
  assert.equal(r.status, 405); assert.equal(r.headers.allow, "POST"); assert.equal(fetchCalls.length, 0);
});

test("exige JSON", async () => {
  assert.equal((await call({ body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.equal((await call({ body: "{no es json" })).status, 400);
  assert.equal((await call({ body: "x".repeat(25000) })).status, 413);
});

test("valida en el servidor y no llama a Supabase si los datos no son válidos", async () => {
  const cases = [
    [{ name: "" }, "name"], [{ name: "A" }, "name"], [{ name: "x".repeat(121) }, "name"],
    [{ attending: "maybe" }, "attending"], [{ language: "fr" }, "language"], [{ submission_id: "123" }, "submission_id"],
    [{ with_partner: "" }, "with_partner"], [{ prewedding: "" }, "prewedding"], [{ transport: "taxi" }, "transport"],
    [{ dietary: ["veggie"] }, "dietary"], [{ dietary: ["none", "vegan"] }, "dietary"], [{ dietary: "vegan" }, "dietary"],
    [{ dietary_other: "x".repeat(301) }, "dietary_other"], [{ message: "x".repeat(2001) }, "message"],
    [{ with_partner: "partner", partner_name: "" }, "partner_name"],
    [{ with_partner: "partner", partner_name: "ana  garcía" }, "partner_name"],
    [{ website: "http://spam" }, "website"],
  ];
  for (const [o, field] of cases) {
    const r = await call({ body: ok(o) });
    assert.equal(r.status, 400, JSON.stringify(o)); assert.equal(r.body.field, field);
  }
  assert.equal((await call({ body: [] })).status, 400);
  assert.equal(fetchCalls.length, 0);
});

test("limpia los datos (espacios, caracteres de control) antes de guardar", () => {
  const v = validate(ok({ name: "  Ana \u0000  García\n", message: "  línea 1\r\nlínea 2  ", dietary: ["vegan", "vegan"] }));
  assert.equal(v.value.name, "Ana García");
  assert.equal(v.value.message, "línea 1\nlínea 2");
  assert.deepEqual(v.value.dietary, ["vegan"]);
  const no = validate(ok({ attending: "no", with_partner: "partner", partner_name: "X Y", message: "hola" }));
  assert.deepEqual(Object.keys(no.value).sort(), ["attending", "language", "name", "submission_id", "with_partner"]);
});

test("envía a Supabase solo lo necesario, con la clave en cabeceras y la IP anonimizada", async () => {
  const body = ok({ with_partner: "partner", partner_name: "Joan Puig", partner_dietary: ["nuts"] });
  const r = await call({ body });
  assert.deepEqual(r.body, { status: "ok", replayed: false });
  assert.equal(r.headers["cache-control"], "no-store");
  const { url, init } = fetchCalls[0];
  assert.equal(url, "https://demo.supabase.co/rest/v1/rpc/submit_rsvp");
  assert.equal(init.headers.apikey, "eyJ.fake.jwt");
  assert.equal(init.headers.Authorization, "Bearer eyJ.fake.jwt");
  const sent = JSON.parse(init.body);
  assert.match(sent.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!init.body.includes("203.0.113.7"));
  assert.equal(sent.p.partner_name, "Joan Puig"); assert.equal(sent.p.attending, true); assert.equal(sent.p.with_partner, true);
});

test("con las claves nuevas de Supabase (sb_secret_) no se envía Authorization", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abc";
  await call({ body: ok() });
  assert.equal(fetchCalls[0].init.headers.apikey, "sb_secret_abc");
  assert.equal(fetchCalls[0].init.headers.Authorization, undefined);
});

test("traduce la respuesta de la base de datos a códigos HTTP claros", async () => {
  const map = [["duplicate", 409], ["rate_limited", 429], ["invalid", 400], ["algo_raro", 502]];
  for (const [status, code] of map) {
    nextReply = async () => new Response(JSON.stringify({ status }), { status: 200 });
    const r = await call({ body: ok() });
    assert.equal(r.status, code, status);
  }
  nextReply = async () => new Response(JSON.stringify({ status: "ok", replayed: true }), { status: 200 });
  assert.deepEqual((await call({ body: ok() })).body, { status: "ok", replayed: true });
});

test("si Supabase falla o no responde, nunca devuelve éxito", async () => {
  nextReply = async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 });
  assert.equal((await call({ body: ok() })).status, 502);
  nextReply = async () => new Response("<html>", { status: 200 });
  assert.equal((await call({ body: ok() })).status, 502);
  nextReply = async () => { throw new TypeError("fetch failed"); };
  assert.equal((await call({ body: ok() })).status, 502);
});

test("sin configurar Supabase responde 503 y no inventa un éxito", async () => {
  delete process.env.SUPABASE_URL;
  const r = await call({ body: ok() });
  assert.equal(r.status, 503); assert.equal(r.body.status, "not_configured");
});

test("si se limitan los orígenes, rechaza peticiones de otros dominios", async () => {
  process.env.ALLOWED_ORIGINS = "https://bertaiedu.com";
  assert.equal((await call({ body: ok(), headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call({ body: ok(), headers: { origin: "https://bertaiedu.com" } })).status, 200);
});

test("los registros de error no incluyen datos de invitados", async () => {
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.join(" "));
  nextReply = async () => new Response(JSON.stringify({ code: "23505", message: "Ana García" }), { status: 500 });
  await call({ body: ok() });
  console.error = orig;
  assert.ok(logs.length > 0 && logs.every((l) => !l.includes("Ana") && !l.includes("García")));
});

test("keepalive: solo responde a Vercel con el secreto y no devuelve datos", async () => {
  const { default: keepalive } = await import("../api/keepalive.js");
  const run = (headers = {}, method = "GET") => new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, body: JSON.parse(s) }); } };
    keepalive({ method, headers }, res);
  });
  process.env.CRON_SECRET = "cron-secret";
  nextReply = async () => new Response(JSON.stringify([{ personas_que_vienen: 42 }]), { status: 200 });
  assert.equal((await run()).status, 401);
  assert.equal((await run({ authorization: "Bearer otro" })).status, 401);
  const r = await run({ authorization: "Bearer cron-secret" });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true });
  assert.ok(fetchCalls.at(-1).url.endsWith("/rest/v1/rsvp_totals?select=personas_que_vienen"));
  delete process.env.CRON_SECRET;
  assert.equal((await run({ authorization: "Bearer undefined" })).status, 401);
});
