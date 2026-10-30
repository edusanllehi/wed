/* Berta i Edu · web de la boda
   - Textos: window.I18N (generado en el build a partir de src/i18n/*.json)
   - RSVP: POST /api/rsvp. Solo se muestra "recibido" cuando el servidor confirma
     que la base de datos lo ha guardado. */
(function () {
  "use strict";

  const I18N = window.I18N || {};
  const LANGS = ["ca", "es", "en"];
  const FALLBACK = "es";
  const RSVP_ENDPOINT = window.RSVP_ENDPOINT === undefined ? "/api/rsvp" : window.RSVP_ENDPOINT;
  const TIMEOUT_MS = 15000;
  // El orden coincide con las etiquetas "diet" de cada idioma
  const DIET_CODES = ["none", "vegetarian", "vegan", "gluten_free", "lactose_free", "nuts", "shellfish", "fish", "pregnant"];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const form = $("#rsvp-form");
  let lang = FALLBACK;
  const t = (k) => (I18N[lang] && I18N[lang][k] !== undefined ? I18N[lang][k] : I18N[FALLBACK][k]);

  /* ---------- Almacenamiento auxiliar (solo comodidad del visitante) ---------- */
  const store = {
    get(area, k) { try { return window[area].getItem(k); } catch (_) { return null; } },
    set(area, k, v) { try { window[area].setItem(k, v); } catch (_) {} },
    del(area, k) { try { window[area].removeItem(k); } catch (_) {} },
  };

  /* ---------- Opciones de dieta ---------- */
  $$("[data-diet]").forEach((group) => {
    const pre = group.dataset.diet;
    DIET_CODES.forEach((code, i) => {
      const l = document.createElement("label");
      l.className = "choice";
      const input = document.createElement("input");
      input.type = "checkbox"; input.id = pre + "-" + code; input.value = code;
      const span = document.createElement("span");
      span.dataset.dietI = String(i);
      l.append(input, span);
      group.appendChild(l);
    });
  });

  /* ---------- Idioma ---------- */
  function setLang(l, opts) {
    lang = LANGS.includes(l) ? l : FALLBACK;
    document.documentElement.lang = lang;
    $$("[data-i18n]").forEach((el) => { const v = t(el.dataset.i18n); if (v != null) el.textContent = v; });
    $$("[data-i18n-html]").forEach((el) => { const v = t(el.dataset.i18nHtml); if (v != null) el.innerHTML = v; });
    $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    $$("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    $$("[data-diet-i]").forEach((el) => { el.textContent = t("diet")[+el.dataset.dietI]; });
    $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    sync();
    if (lastError) showError(lastError);
    if (!$("#thanks").hidden && lastThanks) showThanks(lastThanks);
    $("#submit-btn").textContent = t(sending ? "sending" : "submit");
    if (!opts || !opts.initial) {
      store.set("localStorage", "boda-lang-choice", lang); // solo si el invitado lo elige
      const u = new URL(location.href);
      u.searchParams.set("lang", lang);
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  }
  $$(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  /* ---------- Formulario: mostrar/ocultar bloques ---------- */
  const val = (name) => { const el = form.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ""; };
  function sync() {
    const si = val("asiste") === "yes";
    const con = si && val("acompanante") === "partner";
    $("#si-block").hidden = !si;
    $("#msg-block").hidden = !si;
    $("#acomp-block").hidden = !con;
    $("#diet2-block").hidden = !con;
    const bus = t(con ? "bus_pl" : "bus");
    $("#bus-yes-label").textContent = bus[0]; $("#bus-no-label").textContent = bus[1];
  }
  form.addEventListener("change", (e) => {
    const el = e.target;
    if (el.type === "checkbox" && el.checked) {
      const group = el.closest("[data-diet]");
      if (el.value === "none") group.querySelectorAll("input").forEach((i) => { if (i !== el) i.checked = false; });
      else group.querySelector('input[value="none"]').checked = false;
    }
    sync();
  });

  /* ---------- Errores ---------- */
  let lastError = "";
  function showError(k) {
    lastError = k || "";
    const e = $("#form-error");
    e.textContent = k ? t(k) : "";
    e.hidden = !k;
  }

  /* ---------- Envío ---------- */
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
  // Clave de idempotencia: se mantiene en todos los reintentos de este mismo envío
  let submissionId = newId();
  let sending = false;

  const dietOf = (name) => $$('[data-diet="' + name + '"] input:checked').map((i) => i.value);

  function collect() {
    const si = val("asiste") === "yes";
    const con = si && val("acompanante") === "partner";
    return {
      submission_id: submissionId,
      language: lang,
      website: form.website.value,
      name: form.nombre.value.trim(),
      attending: val("asiste"),
      with_partner: si ? val("acompanante") : "",
      partner_name: con ? form.nombre_acompanante.value.trim() : "",
      dietary: si ? dietOf("dieta") : [],
      dietary_other: si ? form.dieta_otros.value.trim() : "",
      partner_dietary: con ? dietOf("dieta_acompanante") : [],
      partner_dietary_other: con ? form.dieta_acompanante_otros.value.trim() : "",
      transport: si ? val("transporte") : "",
      message: si ? form.mensaje.value.trim() : "",
    };
  }

  function validate(d) {
    if (d.name.length < 2) return ["err_name", form.nombre];
    if (!d.attending) return ["err_attend"];
    if (d.attending === "yes" && !d.with_partner) return ["err_plus"];
    if (d.with_partner === "partner" && d.partner_name.length < 2) return ["err_plusname", form.nombre_acompanante];
    return null;
  }

  function setSending(on) {
    sending = on;
    const btn = $("#submit-btn");
    btn.disabled = on;
    btn.setAttribute("aria-busy", String(on));
    btn.textContent = t(on ? "sending" : "submit");
  }

  let lastThanks = null;
  function showThanks(info) {
    lastThanks = info;
    if (info.seen) {
      $("#thanks-title").textContent = t("ty_seen_title");
      $("#thanks-text").textContent = t("ty_seen_p");
    } else {
      $("#thanks-title").textContent = t(info.attending ? "ty_yes" : "ty_no").replace("{n}", info.first || "");
      $("#thanks-text").textContent = t(info.attending ? "ty_yes_p" : "ty_no_p");
    }
    form.hidden = true;
    $("#thanks").hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return; // doble clic
    showError("");
    const data = collect();
    if (data.website) return; // honeypot
    const bad = validate(data);
    if (bad) { showError(bad[0]); if (bad[1]) bad[1].focus(); return; }
    if (!RSVP_ENDPOINT) { showError("err_off"); return; }

    setSending(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res, body = {};
    try {
      res = await fetch(RSVP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: ctrl.signal,
        credentials: "same-origin",
      });
      try { body = await res.json(); } catch (_) { body = {}; }
    } catch (err) {
      clearTimeout(timer);
      setSending(false);
      // Resultado desconocido: el reintento usa la misma clave y no duplicará
      showError(err && err.name === "AbortError" ? "err_timeout" : "err_conn");
      return;
    }
    clearTimeout(timer);
    setSending(false);

    if (res.ok && body.status === "ok") {
      const info = { attending: data.attending === "yes", first: data.name.split(/\s+/)[0] };
      store.set("sessionStorage", "boda-rsvp-done", JSON.stringify({ attending: info.attending }));
      submissionId = newId();
      showThanks(info);
      $("#thanks").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Se perdió el acceso con código (p. ej. lo habéis cambiado): volver a la portada sin perder nada guardado
    if (res.status === 401 && body.status === "locked") { location.reload(); return; }
    const map = { duplicate: "err_dup", rate_limited: "err_rate", invalid: "err_invalid" };
    showError(map[body.status] || (res.status >= 500 ? "err_server" : "err_invalid"));
  });

  $("#again").addEventListener("click", () => {
    form.reset();
    submissionId = newId();
    store.del("sessionStorage", "boda-rsvp-done");
    lastThanks = null;
    showError("");
    sync();
    $("#thanks").hidden = true;
    form.hidden = false;
  });

  /* ---------- Copiar códigos e IBAN ---------- */
  async function copy(text, onOk, onFail) {
    try { await navigator.clipboard.writeText(text); onOk(); } catch (_) { if (onFail) onFail(); }
  }
  $$(".code").forEach((b) => b.addEventListener("click", () => {
    const code = b.dataset.code || b.textContent;
    b.dataset.code = code;
    copy(code, () => {
      b.textContent = t("copied"); b.classList.add("ok");
      setTimeout(() => { b.textContent = code; b.classList.remove("ok"); }, 1600);
    });
  }));
  const ibanBtn = $("#copy-iban");
  if (ibanBtn) ibanBtn.addEventListener("click", () => {
    const el = $("#iban");
    copy(el.textContent.replace(/\s+/g, ""), () => { ibanBtn.textContent = t("copied_iban"); }, () => {
      const r = document.createRange(); r.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      ibanBtn.textContent = t("select_iban");
    });
    setTimeout(() => { ibanBtn.textContent = t("copy_iban"); }, 2500);
  });

  /* ---------- Arranque ---------- */
  // Idioma: ?lang= > elegido antes por el invitado > castellano
  const fromUrl = new URLSearchParams(location.search).get("lang");
  const saved = store.get("localStorage", "boda-lang-choice");
  const start = LANGS.includes(fromUrl) ? fromUrl : LANGS.includes(saved) ? saved : FALLBACK;
  setLang(start, { initial: true });

  // Si ya respondió en esta pestaña y recarga, no le pedimos que lo repita
  if (store.get("sessionStorage", "boda-rsvp-done")) showThanks({ seen: true });
})();
