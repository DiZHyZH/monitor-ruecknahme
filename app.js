/* Monitor-Rücknahme · dplan IT Services · entwickelt von Marco van der Ploeg */
"use strict";
const SB_URL = "https://bxhqgugvihlogirbdrrv.supabase.co";
const SB_KEY = "sb_publishable_sIuUYIqAwoyICZyXy9GhtA_xXPAhW7g";
const LS = "mr2-";
const OLD = "monitor-ruecknahme-v3";

/* ---------- Helfer ---------- */
const $ = id => document.getElementById(id);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) {} },
  raw(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
};
const norm = s => (s || "").trim().replace(/\s+/g, "").toUpperCase();
const clean = s => (s || "").trim().replace(/\s+/g, "");
const uid = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v; else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][new Date(s + "T12:00").getDay()]; return wd + " " + d + "." + m + "." + y; };
const fmtTs = ts => new Date(ts).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const addr = s => [s.strasse, [s.plz, s.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const siteLabel = (s, i) => (s.gebaeude ? s.gebaeude + " · " : "") + addr(s);

/* ---------- Gerätetypen ---------- */
const TYPES = [
  { p: "42000", t: "Monitor" }, { p: "22000", t: "Thin Client / Tower" }, { p: "32000", t: "Laptop" },
  { p: "62000", t: "Docking HP" }, { p: "72000", t: "Docking Lenovo" }
];
const TYPE_NAMES = TYPES.map(t => t.t);
function devType(a) { const id = norm(a); let best = null; TYPES.forEach(r => { if (id.startsWith(r.p) && (!best || r.p.length > best.p.length)) best = r; }); return best ? best.t : ""; }

/* ---------- Töne ---------- */
let actx = null;
function audio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} return actx; }
document.addEventListener("pointerdown", audio, { once: true }); document.addEventListener("keydown", audio, { once: true });
function tone(f, d, at, vol) { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.type = "square"; o.frequency.value = f; g.gain.value = vol || .06; o.connect(g); g.connect(a.destination); const t = a.currentTime + (at || 0); o.start(t); o.stop(t + d); }
const beepOk = () => { tone(1760, .07); vib(40); };
const beepWarn = () => { tone(440, .12); tone(440, .12, .17); vib([60, 60, 60]); };
const beepBad = () => { tone(220, .25, 0, .08); vib(200); };
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

/* ---------- Toast & Dialog ---------- */
function toast(t, btn, fn) {
  $("toastT").textContent = t; const b = $("toastB"); b.hidden = !btn;
  if (btn) { b.textContent = btn; b.onclick = () => { $("toast").hidden = true; fn(); }; }
  $("toast").hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $("toast").hidden = true, btn ? 6000 : 2600);
}
function ask(title, body, buttons, input) {
  $("dlgT").textContent = title;
  const p = $("dlgP"); p.innerHTML = ""; if (body) p.append(typeof body === "string" ? document.createTextNode(body) : body); p.hidden = !body;
  const inp = $("dlgI"); inp.hidden = input == null; inp.type = (input && input.type) || "text"; inp.inputMode = (input && input.mode) || "";
  if (input != null) { inp.value = input.value || ""; setTimeout(() => inp.focus(), 60); }
  const act = $("dlgA"); act.innerHTML = "";
  buttons.forEach(b => act.append(h("button", { type: "button", class: "btn " + (b.cls || ""), onclick: () => { $("dlg").hidden = true; b.fn && b.fn(inp.value.trim()); } }, b.label)));
  $("dlg").hidden = false;
}
$("dlg").addEventListener("click", e => { if (e.target.id === "dlg") $("dlg").hidden = true; });
$("dlgI").addEventListener("keydown", e => { if (e.key === "Enter") { const b = $("dlgA").lastElementChild; b && b.click(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("dlg").hidden) $("dlg").hidden = true; });

/* ---------- Supabase: Konto ---------- */
let session = ls.get("session", null) || ls.raw(OLD + "-session", null);
let me = ls.get("me", null);
function setSession(d) {
  if (!d || !d.access_token) { session = null; ls.set("session", null); try { localStorage.removeItem(OLD + "-session"); } catch (e) {} return; }
  const u = d.user || (session && session.user) || {};
  session = { access_token: d.access_token, refresh_token: d.refresh_token || (session && session.refresh_token),
    expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
    user: { id: u.id, email: u.email, name: (u.user_metadata && u.user_metadata.name) || u.name || "" } };
  ls.set("session", session);
}
async function authCall(path, body, method, token) {
  const r = await fetch(SB_URL + "/auth/v1/" + path, { method: method || "POST", headers: { apikey: SB_KEY, "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { const e = new Error((j && (j.msg || j.error_description || j.message || j.error_code)) || ("HTTP " + r.status)); e.code = j && (j.error_code || j.code); e.status = r.status; throw e; }
  return j;
}
let refreshing = null;
async function ensureToken() {
  if (!session) throw Object.assign(new Error("not_logged_in"), { auth: true });
  if (session.expires_at - Date.now() / 1000 > 90) return session.access_token;
  if (!refreshing) refreshing = authCall("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
    .then(d => { setSession(d); return session.access_token; })
    .catch(e => { if (e.status === 400 || e.status === 401) { signOut(true); toast("Bitte neu anmelden"); } throw e; })
    .finally(() => refreshing = null);
  return refreshing;
}
async function rpc(fn, body) {
  const tok = await ensureToken();
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: SB_KEY, Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) { const e = new Error((j && (j.message || j.hint)) || ("HTTP " + r.status)); e.status = r.status; throw e; }
  return j;
}
const isNet = e => !e.status && !e.auth && /fetch|network|load failed/i.test(e.message || "");
function errText(e) {
  const m = (e && (e.code || e.message)) + "";
  const map = {
    invalid_credentials: "E-Mail oder PIN stimmt nicht.", user_already_exists: "Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.",
    weak_password: "PIN zu kurz: mindestens 6 Ziffern.", email_address_invalid: "Diese E-Mail-Adresse ist ungültig.",
    over_email_send_rate_limit: "Zu viele Versuche. Bitte ein paar Minuten warten.", email_not_confirmed: "E-Mail ist noch nicht bestätigt.",
    dispatcher_only: "Das darf nur der Dispatcher.", lead_only: "Das darf nur der Lead oder der Dispatcher.", admin_only: "Das darf nur der Admin.",
    no_access: "Du bist in diesem Auftrag nicht dabei. Lass dich vom Lead einladen.", job_closed: "Der Auftrag ist abgeschlossen.",
    invite_invalid: "Die Einladung ist ungültig oder abgelaufen. Den Lead um einen neuen QR-Code bitten.",
    site_has_data: "Dieser Standort hat schon Einträge und kann nicht entfernt werden.", rollout_one_site: "Ein Rollout hat genau einen Standort. Für mehrere: Tour wählen.",
    "past:datum": "Das Datum liegt in der Vergangenheit.", cannot_demote_self: "Du kannst dir die Admin-Rolle nicht selbst wegnehmen.",
    not_allowed: "Nur eigene Einträge löschen, oder der Lead.", bad_site: "Standort fehlt."
  };
  for (const k in map) if (m.includes(k)) return map[k];
  if (/missing:/.test(m)) return "Pflichtfeld fehlt (" + m.split("missing:")[1] + ").";
  if (isNet(e)) return "Keine Verbindung.";
  return m;
}

/* ---------- Lokaler Zustand ---------- */
let jobs = ls.get("jobs", []);
let catalog = ls.get("catalog", []);
let queue = ls.get("queue", []);
const jdCache = {};
function jd(id) { if (!jdCache[id]) jdCache[id] = ls.get("job:" + id, { scans: {}, mats: {}, sinceS: "1970-01-01T00:00:00Z", sinceM: "1970-01-01T00:00:00Z" }); return jdCache[id]; }
function saveJd(id) { ls.set("job:" + id, jd(id)); }
const jobById = id => jobs.find(j => j.id === id);
const scansOf = (id, site) => Object.values(jd(id).scans).filter(s => !site || s.site_id === site).sort((a, b) => a.ts - b.ts);
const matsOf = (id, site) => Object.values(jd(id).mats).filter(m => m.qty > 0 && (!site || m.site_id === site));
const isDisp = () => me && (me.role === "dispatcher" || me.role === "admin");
const isAdmin = () => me && me.role === "admin";
const isLead = j => isDisp() || (j && me && j.lead === me.id);
function enqueue(op) { queue.push(op); ls.set("queue", queue); badge(); kick(); }
const pendingFor = id => queue.filter(q => q.job === id).length;

/* ---------- Ist/Soll ---------- */
const DIRS = [["ab", "Abbau"], ["auf", "Aufbau"]];
const dirOf = s => s.dir || "ab";
function counts(jobId, siteId, dir) {
  const c = {}; scansOf(jobId, siteId).filter(s => !dir || dirOf(s) === dir).forEach(s => { const t = devType(s.asset) || "Unbekannt"; c[t] = (c[t] || 0) + 1; }); return c;
}
// Soll-Format: {ab:{Typ:n}, auf:{Typ:n}}; altes flaches Format zählt als Abbau
function sollSite(s, dir) { const so = s.soll || {}; const nested = so.ab || so.auf; const src = nested ? (so[dir] || {}) : (dir === "ab" ? so : {}); const c = {}; Object.entries(src).forEach(([k, v]) => { const n = parseInt(v) || 0; if (n) c[k] = n; }); return c; }
function sollOf(job, siteId, dir) {
  const c = {}; (job.sites || []).filter(s => !siteId || s.id === siteId).forEach(s => (dir ? [dir] : ["ab", "auf"]).forEach(d => Object.entries(sollSite(s, d)).forEach(([k, n]) => c[k] = (c[k] || 0) + n))); return c;
}
function progressEl(job, siteId) {
  const out = h("div", { class: "prog" });
  DIRS.forEach(([d, label]) => {
    const ist = counts(job.id, siteId, d), soll = sollOf(job, siteId, d);
    const keys = [...new Set([...TYPE_NAMES.filter(t => soll[t] || ist[t]), ...Object.keys(ist)])];
    if (!keys.length) return;
    out.append(h("div", { class: "progdir " + d }, label));
    keys.forEach(k => {
      const s = soll[k] || 0, i = ist[k] || 0, pct = s ? Math.min(100, i / s * 100) : 100;
      out.append(h("div", { class: "prow" + (i > s ? " over" : i === s && s ? " full" : "") },
        h("span", { class: "pn" }, k), h("div", { class: "bar" + (i >= s && s ? " done" : "") }, h("i", { style: "width:" + pct + "%" })), h("b", null, i + " / " + (s || "–"))));
    });
  });
  return out.children.length ? out : h("div", { class: "empty" }, "Kein Soll erfasst.");
}
function totalProgress(job) {
  const s = Object.values(sollOf(job)).reduce((a, b) => a + b, 0);
  const local = scansOf(job.id).length; const i = Math.max(local, job.scan_count || 0);
  return { s, i };
}

/* ---------- Sync ---------- */
let syncing = false, syncTimer = null, lastOk = 0;
function badge() {
  const d = $("sync"); const on = Date.now() - lastOk < 25000 && navigator.onLine !== false;
  const p = queue.length; d.className = "sync " + (on && !p ? "on" : p ? "wait" : "");
  d.title = on ? (p ? p + " Einträge werden hochgeladen" : "Live verbunden") : (p ? "Offline · " + p + " Einträge warten" : "Offline");
}
function kick(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms == null ? 150 : ms); }
async function sync() {
  clearTimeout(syncTimer);
  if (!session || syncing) { syncTimer = setTimeout(sync, 4000); return; }
  syncing = true; let changed = false;
  try {
    while (queue.length) {
      const q = queue[0];
      try {
        if (q.op === "scan") {
          const { pending, ...it } = q.item;
          const r = await rpc("scan_add", { p_job: q.job, p: it });
          const d = jd(q.job);
          if (r && r.status === "dup" && r.id !== q.item.id) {
            delete d.scans[q.item.id];
            toast(q.item.asset + " hat " + (r.by || "jemand") + " schon erfasst"); beepWarn();
          } else if (d.scans[q.item.id]) delete d.scans[q.item.id].pending;
          saveJd(q.job); changed = true;
        } else if (q.op === "scandel") await rpc("scan_delete", { p_job: q.job, p_id: q.id });
        else if (q.op === "mat") await rpc("mat_set", { p_job: q.job, p: q.item });
      } catch (e) {
        if (isNet(e) || e.auth) throw e;
        if (q.op === "scan") { const d = jd(q.job); delete d.scans[q.item.id]; saveJd(q.job); changed = true; }
        toast("Nicht gespeichert: " + errText(e)); beepBad();
      }
      queue.shift(); ls.set("queue", queue);
    }
    if (cur && (view === "scan" || view === "job")) changed = (await pullJob(cur)) || changed;
    lastOk = Date.now();
  } catch (e) { if (isNet(e)) lastOk = 0; }
  finally {
    syncing = false; badge();
    if (changed) rerender();
    syncTimer = setTimeout(sync, queue.length ? 2500 : (view === "scan" ? 4000 : 15000));
  }
}
async function pullJob(id) {
  const d = jd(id); let ch = false;
  const rows = await rpc("scan_list", { p_job: id, p_since: d.sinceS }) || [];
  rows.forEach(r => {
    if (r.updated_at > d.sinceS) d.sinceS = r.updated_at;
    if (r.deleted) { if (d.scans[r.id]) { delete d.scans[r.id]; ch = true; } return; }
    const o = { id: r.id, asset: r.asset, site_id: r.site_id, ts: Number(r.ts) || Date.parse(r.updated_at), by: r.by, user_id: r.user_id };
    ["neu", "etage", "raum", "buero", "place", "cond", "note", "dir", "art", "grp"].forEach(k => { if (r[k]) o[k] = r[k]; });
    d.scans[r.id] = o; ch = true;
  });
  const mrows = await rpc("mat_list", { p_job: id, p_since: d.sinceM }) || [];
  mrows.forEach(r => {
    if (r.updated_at > d.sinceM) d.sinceM = r.updated_at;
    if (queue.some(q => q.op === "mat" && q.item.id === r.id)) return;
    d.mats[r.id] = { id: r.id, site_id: r.site_id, item: r.item, qty: r.deleted ? 0 : r.qty, etage: r.etage, raum: r.raum, place: r.place, by: r.by, ts: Number(r.ts) || 0 };
    ch = true;
  });
  if (ch) saveJd(id);
  return ch;
}
async function refreshJobs() {
  try {
    const [j, m] = await Promise.all([rpc("job_list"), rpc("app_me")]);
    jobs = j || []; ls.set("jobs", jobs); lastOk = Date.now();
    if (m) { me = m; ls.set("me", me); $("meBtn").textContent = ((me.name || "?").trim()[0] || "?").toUpperCase(); }
    if (!catalog.length || Date.now() - (ls.get("catAt", 0)) > 3600e3) { catalog = await rpc("catalog_get") || []; ls.set("catalog", catalog); ls.set("catAt", Date.now()); }
    rerender();
  } catch (e) { if (!isNet(e) && !e.auth) toast(errText(e)); }
  badge();
}
window.addEventListener("online", () => kick());
document.addEventListener("visibilitychange", () => { if (!document.hidden && session) { kick(); if (view === "home") refreshJobs(); } });

/* ---------- Ansichten & Router ---------- */
let view = "home", cur = null, siteId = null;
const VIEWS = { auth: "vAuth", home: "vHome", job: "vJob", scan: "vScan", form: "vForm", users: "vUsers", cat: "vCat" };
function show(v) {
  view = v; Object.entries(VIEWS).forEach(([k, id]) => $(id).hidden = k !== v);
  $("top").hidden = v === "auth"; $("backBtn").hidden = v === "home"; $("logo").hidden = v !== "home";
  $("meBtn").textContent = me ? ((me.name || "?").trim()[0] || "?").toUpperCase() : "?";
  window.scrollTo(0, 0);
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
$("backBtn").onclick = () => {
  if (view === "scan" && cur) go("#job/" + cur); else if (view === "form" && formJob) go("#job/" + formJob); else go("#");
};
window.addEventListener("hashchange", route);
function route() {
  const hsh = location.hash.slice(1);
  if (hsh.startsWith("join=")) { const t = hsh.slice(5); history.replaceState(null, "", location.pathname); return acceptInvite(t); }
  const pr = new URLSearchParams(hsh); if (pr.get("type") === "recovery" && pr.get("access_token")) { recoveryToken = pr.get("access_token"); history.replaceState(null, "", location.pathname); return showAuth("reset"); }
  if (!session) return showAuth("in");
  const [v, id] = hsh.split("/");
  if ((v === "job" || v === "scan") && id) {
    cur = id; show(v); const known = !!jobById(id);
    if (known) { v === "job" ? renderJob() : renderScan(true); }
    else { $("topTitle").textContent = "Lade Auftrag …"; $("topSub").textContent = ""; }
    refreshJobs().then(() => {
      if (cur !== id || view !== v) return;
      if (!jobById(id)) { toast("Auftrag nicht gefunden oder du bist nicht dabei"); return go("#"); }
      if (!known && v === "scan") renderScan(true); else rerender();
    });
    if (v === "job") pullJob(id).then(c => c && rerender()).catch(() => {}); else kick();
    return;
  }
  if (v === "new") { if (!isDisp()) return go("#"); show("form"); openForm(null); return; }
  if (v === "edit" && id) { if (!isDisp()) return go("#"); show("form"); openForm(id); return; }
  if (v === "users") { if (!isAdmin()) return go("#"); show("users"); renderUsers(); return; }
  if (v === "cat") { if (!isDisp()) return go("#"); show("cat"); renderCat(); return; }
  cur = null; show("home"); renderHome(); refreshJobs();
}
function rerender() {
  if (view === "home") renderHome(); else if (view === "job") renderJob(); else if (view === "scan") renderScan(false);
}

/* ---------- Anmelden ---------- */
let auMode = "in", recoveryToken = null;
function setAuMode(m) {
  auMode = m;
  $("auTabIn").setAttribute("aria-pressed", m === "in"); $("auTabUp").setAttribute("aria-pressed", m === "up");
  $("auTabs").hidden = m === "reset"; $("auNameF").hidden = m !== "up"; $("auPin2F").hidden = m === "in"; $("auMailF").hidden = m === "reset"; $("auForgot").hidden = m !== "in";
  $("auTitle").textContent = { in: "Anmelden", up: "Konto erstellen", reset: "Neuen PIN setzen" }[m];
  $("auLead").textContent = { in: "Mit deiner E-Mail und deinem PIN. Du bleibst angemeldet, auch offline.", up: "Dein Name erscheint bei «Erfasst durch» und lässt sich danach nicht mehr ändern. Den PIN wählst du selbst, mindestens 6 Ziffern.", reset: "Wähle einen neuen PIN mit mindestens 6 Ziffern." }[m];
  $("auGo").textContent = { in: "Anmelden", up: "Konto erstellen", reset: "PIN speichern" }[m];
  $("auPin").autocomplete = m === "in" ? "current-password" : "new-password"; $("auPinL").textContent = m === "reset" ? "Neuer PIN" : "PIN"; $("auErr").textContent = "";
}
$("auTabIn").onclick = () => setAuMode("in"); $("auTabUp").onclick = () => setAuMode("up");
function showAuth(m) { show("auth"); setAuMode(m || "in"); setTimeout(() => $(m === "reset" ? "auPin" : ($("auMail").value ? "auPin" : "auMail")).focus(), 80); }
$("auForm").addEventListener("submit", async e => {
  e.preventDefault();
  const mail = $("auMail").value.trim().toLowerCase(), pin = $("auPin").value.trim(), pin2 = $("auPin2").value.trim(), name = $("auName").value.trim().replace(/\s+/g, " ");
  const err = t => $("auErr").textContent = t;
  if (auMode !== "reset" && !/^\S+@\S+\.\S+$/.test(mail)) return err("Bitte eine gültige E-Mail eingeben.");
  if (!/^\d{6,}$/.test(pin)) return err("PIN: mindestens 6 Ziffern, nur Zahlen.");
  if (auMode !== "in" && pin !== pin2) return err("Die beiden PINs sind nicht gleich.");
  if (auMode === "up" && name.split(" ").length < 2) return err("Bitte Vor- und Nachname eingeben.");
  $("auGo").disabled = true; err("Einen Moment …");
  try {
    if (auMode === "in") setSession(await authCall("token?grant_type=password", { email: mail, password: pin }));
    else if (auMode === "up") { const d = await authCall("signup", { email: mail, password: pin, data: { name } }); if (!d.access_token) { setAuMode("in"); return err("Konto erstellt. Bitte E-Mail bestätigen, dann anmelden."); } setSession(d); }
    else { await authCall("user", { password: pin }, "PUT", recoveryToken); recoveryToken = null; toast("Neuer PIN gespeichert. Bitte anmelden."); $("auPin").value = ""; $("auPin2").value = ""; return setAuMode("in"); }
    $("auPin").value = ""; $("auPin2").value = ""; err("");
    me = null; await refreshJobs();
    toast("Hallo " + ((me && me.name) || "") + " 👋");
    const pj = ls.get("pendingJoin", null); if (pj) { ls.set("pendingJoin", null); return acceptInvite(pj); }
    go("#");
  } catch (e2) { err(errText(e2)); }
  finally { $("auGo").disabled = false; }
});
$("auForgot").onclick = () => {
  const mail = $("auMail").value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(mail)) { $("auErr").textContent = "Zuerst deine E-Mail oben eingeben."; return $("auMail").focus(); }
  ask("PIN zurücksetzen?", "Wir schicken einen Link an " + mail + ". Den Link auf diesem Gerät öffnen und einen neuen PIN wählen.", [{ label: "Abbrechen" }, { label: "Link senden", cls: "primary", fn: async () => {
    try { await authCall("recover", { email: mail, redirect_to: location.origin + location.pathname }); $("auErr").textContent = "Link verschickt. Schau in dein Postfach, auch im Spam."; } catch (e) { $("auErr").textContent = errText(e); }
  } }]);
};
function signOut(silent) {
  const tok = session && session.access_token; if (tok) authCall("logout", null, "POST", tok).catch(() => {});
  setSession(null); me = null; ls.set("me", null); jobs = []; ls.set("jobs", []);
  if (!silent) toast("Abgemeldet"); showAuth("in");
}
$("meBtn").onclick = () => {
  if (!me) return;
  const roleTxt = { admin: "Admin", dispatcher: "Dispatcher", tech: "Techniker" }[me.role] || me.role;
  const body = h("div", null, h("div", null, me.email + " · " + roleTxt), queue.length ? h("div", { style: "margin-top:6px;color:var(--warn)" }, queue.length + " Einträge warten noch auf Upload.") : null,
    h("div", { style: "margin-top:6px" }, "Der Name ist fest mit dem Konto verbunden. Tippfehler? Beim Admin melden."));
  const btns = [{ label: "PIN ändern", fn: () => ask("PIN ändern", "Neuer PIN, mindestens 6 Ziffern:", [{ label: "Abbrechen" }, { label: "Speichern", cls: "primary", fn: async v => {
    if (!/^\d{6,}$/.test(v)) return toast("Mindestens 6 Ziffern"); try { await authCall("user", { password: v }, "PUT", await ensureToken()); toast("PIN geändert"); } catch (e) { toast(errText(e)); } } }], { type: "password", mode: "numeric" }) }];
  if (legacyLists().length) btns.push({ label: "Alte Listen (Excel)", fn: exportLegacy });
  btns.push({ label: "Abmelden", cls: "danger", fn: () => queue.length ? ask("Wirklich abmelden?", queue.length + " Einträge sind noch nicht hochgeladen und gehen verloren.", [{ label: "Zurück" }, { label: "Trotzdem abmelden", cls: "danger", fn: () => signOut() }]) : signOut() });
  ask(me.name, body, btns);
};
function legacyLists() { const st = ls.raw(OLD + "-lists", null); return st && Array.isArray(st.lists) ? st.lists.filter(l => (l.items || []).length) : []; }

/* ---------- Startseite ---------- */
function renderHome() {
  $("topTitle").textContent = "Monitor-Rücknahme"; $("topSub").textContent = me ? ({ admin: "Admin", dispatcher: "Dispatcher", tech: "Techniker" }[me.role] || "") : "";
  $("meBtn").textContent = me ? (me.name.trim()[0] || "?").toUpperCase() : "?";
  $("hello").textContent = me ? "Hallo " + me.name.split(" ")[0] : "Hallo";
  $("newJob").hidden = !isDisp(); $("catBtn").hidden = !isDisp(); $("usersBtn").hidden = !isAdmin();
  $("helloSub").textContent = isDisp() ? "Alle Aufträge" : "Deine Aufträge";
  const box = $("jobList"); box.innerHTML = "";
  if (!jobs.length) {
    box.append(h("div", { class: "emptybox" }, h("b", null, isDisp() ? "Noch keine Aufträge" : "Noch kein Auftrag für dich"),
      isDisp() ? "Mit «+ Neuer Auftrag» den ersten Auftrag eröffnen." : "Dein Lead lädt dich per QR-Code ein. Tippe dann auf «Einladung scannen» oder scanne den Code mit der Handy-Kamera."));
    return;
  }
  const t = today();
  const groups = [["Heute", j => j.status !== "abgeschlossen" && j.datum === t], ["Offen aus früheren Tagen", j => j.status !== "abgeschlossen" && j.datum < t],
    ["Geplant", j => j.status !== "abgeschlossen" && j.datum > t], ["Abgeschlossen", j => j.status === "abgeschlossen"]];
  groups.forEach(([title, f]) => {
    const list = jobs.filter(f); if (!list.length) return;
    box.append(h("h3", null, title));
    list.forEach(j => box.append(jobCard(j)));
  });
}
function jobCard(j) {
  const p = totalProgress(j);
  const stTxt = { geplant: "geplant", aktiv: "läuft", abgeschlossen: "abgeschlossen" }[j.status];
  return h("button", { type: "button", class: "jobcard", onclick: () => go("#job/" + j.id) },
    h("div", null, h("div", { class: "jc" }, j.code), h("div", { class: "jk" }, j.kunde)),
    h("span", { class: "pill " + (j.datum === today() && j.status !== "abgeschlossen" ? "today" : j.status) }, j.datum === today() && j.status !== "abgeschlossen" ? "heute" : stTxt),
    h("div", { class: "jm" }, h("span", null, "📅 " + fmtDate(j.datum) + ", " + j.zeit_von + "–" + j.zeit_bis),
      h("span", null, "📍 " + (j.sites.length > 1 ? j.sites.length + " Standorte" : (j.sites[0] ? siteLabel(j.sites[0]) : ""))),
      h("span", null, "👤 Lead: " + (j.lead_name || "–")), j.wo ? h("span", null, "🧾 " + j.wo) : null),
    h("div", { class: "jp" }, h("div", { class: "bar" + (p.s && p.i >= p.s ? " done" : "") }, h("i", { style: "width:" + (p.s ? Math.min(100, p.i / p.s * 100) : 0) + "%" })), h("b", null, p.i + " / " + p.s + " Geräte")));
}
$("newJob").onclick = () => go("#new"); $("usersBtn").onclick = () => go("#users"); $("catBtn").onclick = () => go("#cat");

/* ---------- Einladung ---------- */
async function acceptInvite(token) {
  token = (token || "").trim(); if (!token) return;
  if (!session) { ls.set("pendingJoin", token); toast("Bitte zuerst anmelden, dann geht's ins Projekt."); return showAuth("in"); }
  try {
    const j = await rpc("invite_accept", { p_token: token });
    await refreshJobs(); toast("Willkommen im Auftrag " + j.code); beepOk(); go("#job/" + j.id);
  } catch (e) { ask("Einladung", errText(e), [{ label: "OK", cls: "primary" }]); go("#"); }
}
$("joinQR").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  toast("Lese QR-Code …");
  try {
    const img = await loadImg(f); const codes = await decode(img); URL.revokeObjectURL(img.src);
    const c = codes.find(x => /join=|^[0-9a-f]{24}$/i.test(x));
    if (!c) return ask("Kein Einladungs-Code", "Auf dem Foto war kein Einladungs-QR. Näher ran, ganz im Bild, Bildschirm hell.", [{ label: "OK", cls: "primary" }]);
    acceptInvite(c.includes("join=") ? c.split("join=")[1] : c);
  } catch (err) { toast("Foto konnte nicht gelesen werden"); }
});
async function showInvite(j) {
  try {
    const r = await rpc("invite_create", { p_job: j.id });
    const url = location.origin + location.pathname + "#join=" + r.token;
    const q = qrcode(0, "M"); q.addData(url); q.make();
    const body = h("div", null,
      h("p", { style: "margin:0 0 10px" }, "Kollegen scannen diesen Code mit der Handy-Kamera oder in der App mit «Einladung scannen». Danach sind sie im Auftrag."),
      h("div", { class: "qrbox" }, h("img", { src: q.createDataURL(6, 3), alt: "Einladungs-QR für " + j.code })),
      h("p", { style: "margin:10px 0 0;font-size:13px" }, "Gültig bis " + fmtTs(Date.parse(r.expires_at)) + ". Nur im Team zeigen."));
    ask("Team einladen · " + j.code, body, [{ label: "Link kopieren", fn: () => { navigator.clipboard && navigator.clipboard.writeText(url).then(() => toast("Link kopiert")).catch(() => toast(url)); } }, { label: "Fertig", cls: "primary" }]);
  } catch (e) { toast(errText(e)); }
}

/* ---------- Auftrag Detail ---------- */
function renderJob() {
  const j = jobById(cur); if (!j) return;
  $("topTitle").textContent = j.kunde; $("topSub").textContent = j.code;
  $("jCode").textContent = j.code; $("jKunde").textContent = j.kunde;
  const st = $("jStatus"); st.className = "pill " + j.status; st.textContent = { geplant: "geplant", aktiv: "läuft", abgeschlossen: "abgeschlossen" }[j.status];
  const kv = $("jInfo"); kv.innerHTML = "";
  const row = (k, v) => kv.append(h("dt", null, k), h("dd", null, v));
  row("Datum", fmtDate(j.datum)); row("Zeit", j.zeit_von + " – " + j.zeit_bis); row("Art", j.art === "tour" ? "Tour · " + j.sites.length + " Standorte" : "Rollout");
  if (j.wo) row("WO / INC", j.wo);
  row("Austausch", (j.tausch || "1:1").replace(":", " : ") + (j.tausch === "frei" ? "" : " (alt : neu)"));
  row("Lead", j.lead_name || "–"); row("Team", j.members && j.members.length ? j.members.join(", ") : "noch niemand eingeladen");
  const b = $("jBtns"); b.innerHTML = "";
  const closed = j.status === "abgeschlossen";
  if (!closed) b.append(h("button", { class: "btn primary", type: "button", onclick: () => go("#scan/" + j.id) }, "Erfassen starten"));
  if (isLead(j) && !closed) b.append(h("button", { class: "btn", type: "button", onclick: () => showInvite(j) }, "Team einladen (QR)"));
  b.append(h("button", { class: "btn", type: "button", onclick: () => exportJob(j) }, "Excel"));
  if (isLead(j) && !closed) b.append(h("button", { class: "btn dark", type: "button", onclick: () => finishJob(j) }, "Abschliessen"));
  if (isDisp()) {
    b.append(h("button", { class: "btn", type: "button", onclick: () => go("#edit/" + j.id) }, "Bearbeiten"));
    if (closed) b.append(h("button", { class: "btn", type: "button", onclick: () => setStatus(j, "aktiv") }, "Wieder öffnen"));
    if (!scansOf(j.id).length && !j.scan_count) b.append(h("button", { class: "btn danger", type: "button", onclick: () => ask("Auftrag löschen?", j.code + " wird endgültig gelöscht.", [{ label: "Abbrechen" }, { label: "Löschen", cls: "danger", fn: async () => { try { await rpc("job_delete", { p_job: j.id }); toast("Gelöscht"); await refreshJobs(); go("#"); } catch (e) { toast(errText(e)); } } }]) }, "Löschen"));
  }
  $("jProgress").innerHTML = ""; $("jProgress").append(progressEl(j));
  const sb = $("jSites"); sb.innerHTML = "";
  j.sites.forEach((s, i) => {
    const maps = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr(s));
    const ist = counts(j.id, s.id), soll = sollOf(j, s.id);
    const sumI = Object.values(ist).reduce((a, c) => a + c, 0), sumS = Object.values(soll).reduce((a, c) => a + c, 0);
    sb.append(h("div", { class: "site" },
      h("div", { class: "sh" }, h("span", { class: "no" }, String(i + 1)), h("div", { class: "sa" }, h("b", null, s.gebaeude || addr(s)), s.gebaeude ? h("span", null, addr(s)) : null), h("b", { style: "font-variant-numeric:tabular-nums" }, sumI + " / " + sumS)),
      h("div", { class: "line" }, h("a", { href: maps, target: "_blank", rel: "noopener" }, "🗺️ Karte öffnen"),
        h("span", null, "👤 " + s.kontakt), h("a", { href: "tel:" + s.telefon.replace(/[^\d+]/g, "") }, "📞 " + s.telefon),
        h("button", { class: "btn link", type: "button", style: "min-height:0;padding:0", onclick: () => { navigator.clipboard && navigator.clipboard.writeText(s.telefon).then(() => toast("Nummer kopiert")).catch(() => {}); } }, "kopieren")),
      s.zutritt ? h("div", { class: "zut" }, "🔑 " + s.zutritt) : null,
      h("div", { class: "hint", style: "margin:0" }, "Soll: " + (DIRS.map(([d, l]) => { const x = Object.entries(sollSite(s, d)).map(([k, v]) => v + " " + k).join(", "); return x ? l + " " + x : ""; }).filter(Boolean).join(" · ") || "–"))));
  });
  const mat = (j.material || []).filter(m => +m.qty > 0);
  $("jMatCard").hidden = !mat.length;
  const ck = ls.get("check:" + j.id, {}); const mb = $("jMat"); mb.innerHTML = "";
  mat.forEach(m => {
    const id = "ck_" + m.name.replace(/\W+/g, "_");
    const lab = h("label", { class: ck[m.name] ? "on" : "", for: id }, h("input", { type: "checkbox", id, checked: !!ck[m.name], onchange: e => { ck[m.name] = e.target.checked; ls.set("check:" + j.id, ck); lab.className = e.target.checked ? "on" : ""; } }), h("span", null, m.name), h("b", null, m.qty + "×"));
    mb.append(lab);
  });
  $("jNotesCard").hidden = !j.notes; $("jNotes").textContent = j.notes || "";
}
async function setStatus(j, st) { try { const r = await rpc("job_set_status", { p_job: j.id, p_status: st }); Object.assign(j, r); ls.set("jobs", jobs); renderJob(); toast(st === "abgeschlossen" ? "Auftrag abgeschlossen" : "Wieder geöffnet"); } catch (e) { toast(errText(e)); } }
async function finishJob(j) {
  if (pendingFor(j.id)) {
    await sync();
    if (pendingFor(j.id)) return ask("Noch nicht alles hochgeladen", pendingFor(j.id) + " Einträge warten noch. Sobald das Gerät wieder Internet hat, geht's automatisch. Danach abschliessen.", [{ label: "OK", cls: "primary" }]);
  }
  try { await pullJob(j.id); } catch (e) {}
  const miss = [];
  j.sites.forEach((s, i) => DIRS.forEach(([dd, l]) => { const ist = counts(j.id, s.id, dd), soll = sollOf(j, s.id, dd); Object.entries(soll).forEach(([k, v]) => { const d = v - (ist[k] || 0); if (d > 0) miss.push((j.sites.length > 1 ? "Standort " + (i + 1) + ": " : "") + l + " " + d + " × " + k); }); }));
  swapsOf(j.id).filter(g => !g.neu.length || !g.alt.length).forEach(g => miss.push("Austausch " + g.no + " ist unvollständig (" + (g.alt.length ? "kein neues" : "kein altes") + " Gerät)"));
  const body = h("div", null, miss.length ? [h("div", null, "Laut Soll fehlen noch:"), h("ul", null, miss.map(m => h("li", null, m))), h("div", { style: "margin-top:8px" }, "Trotzdem abschliessen? Danach kann niemand mehr etwas erfassen.")]
    : "Alles erfasst, was geplant war ✅ Nach dem Abschliessen kann niemand mehr etwas erfassen.");
  ask(miss.length ? "Wirklich alles erfasst?" : "Auftrag abschliessen?", body, [{ label: "Zurück" }, { label: miss.length ? "Trotzdem abschliessen" : "Abschliessen", cls: "dark", fn: async () => { await setStatus(j, "abgeschlossen"); ask("Abgeschlossen", "Excel jetzt herunterladen?", [{ label: "Später" }, { label: "Excel", cls: "primary", fn: () => exportJob(j) }]); } }]);
}

/* ---------- Erfassen ---------- */
let listAll = false, cond = "ok", freshId = null, armed = null;
let mode = "tausch";              // tausch | auf | ab
let swap = null;                  // {grp, step:'alt'|'neu'|'done'}
const RATIO = r => r === "frei" ? null : { alt: +r.split(":")[0], neu: +r.split(":")[1] };
const ratioOf = j => ls.get("ratio:" + j.id, null) || j.tausch || "1:1";
function swapsOf(jobId) {
  const g = {}; scansOf(jobId).filter(s => s.art === "tausch" && s.grp).forEach(s => { (g[s.grp] = g[s.grp] || { grp: s.grp, ts: s.ts, alt: [], neu: [], site_id: s.site_id }); (dirOf(s) === "ab" ? g[s.grp].alt : g[s.grp].neu).push(s); g[s.grp].ts = Math.min(g[s.grp].ts, s.ts); });
  return Object.values(g).sort((a, b) => a.ts - b.ts).map((x, i) => ({ ...x, no: i + 1 }));
}
function curSwap(j) { return swap && swapsOf(j.id).find(g => g.grp === swap.grp); }
function saveSwap() { ls.set("swap:" + cur, swap); }
function setMode(m) {
  mode = m; ls.set("mode:" + cur, m);
  document.querySelectorAll("#dirSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === m));
  $("scanCard").className = "card scancard dir-" + m;
  renderSwap();
  $("scanIn").placeholder = m === "auf" ? "Neues Gerät scannen (Aufbau)" : m === "ab" ? "Altes Gerät scannen (Abbau)" : (swap && swap.step === "neu" ? "NEUES Gerät scannen" : "ALTES Gerät scannen");
}
document.querySelectorAll("#dirSeg button").forEach(b => b.onclick = () => { setMode(b.dataset.v); setMsg(b.dataset.v === "tausch" ? "Austausch: zuerst das alte Gerät scannen." : b.dataset.v === "auf" ? "Nur Aufbau: neue Geräte scannen." : "Nur Abbau: alte Geräte scannen.", ""); refocus(); });
document.querySelectorAll("#ratioSel button").forEach(b => b.onclick = () => { const j = jobById(cur); ls.set("ratio:" + cur, b.dataset.v); renderSwap(); toast("Verhältnis " + b.textContent + " gespeichert"); refocus(); });
function nextStep(j) {
  // bestimmt den nächsten Schritt im aktuellen Austausch anhand des Verhältnisses
  const g = curSwap(j); const r = RATIO(ratioOf(j));
  if (!g) return "alt";
  if (swap.force) return swap.force;
  if (!g.neu.length) return (r && g.alt.length < r.alt) ? "alt" : "neu";
  if (r && g.neu.length < r.neu) return "neu";
  return r ? "done" : "neu-or-done";
}
function renderSwap() {
  const j = jobById(cur); const box = $("swapBox"); if (!j) return;
  box.hidden = mode !== "tausch";
  const rv = ratioOf(j); document.querySelectorAll("#ratioSel button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === rv));
  if (mode !== "tausch") return;
  const g = curSwap(j); const st = nextStep(j); const n = g ? g.no : swapsOf(j.id).length + 1;
  const step = $("swapStep");
  if (!g) { step.className = "swapstep alt"; step.textContent = "Austausch " + n + " · ① ALTES Gerät scannen"; }
  else if (st === "alt") { step.className = "swapstep alt"; step.textContent = "Austausch " + n + " · ① weiteres ALTES Gerät scannen (" + g.alt.length + "/" + RATIO(rv).alt + ")"; }
  else if (st === "neu" || st === "neu-or-done") { step.className = "swapstep neu"; step.textContent = "Austausch " + n + " · ② NEUES Gerät scannen" + (g.neu.length && RATIO(rv) ? " (" + g.neu.length + "/" + RATIO(rv).neu + ")" : ""); }
  else { step.className = "swapstep done"; step.textContent = "✓ Austausch " + n + " fertig · nächstes altes Gerät scannen"; }
  const ids = (arr, empty) => arr.length ? arr.map(x => h("div", null, x.asset)) : [h("em", null, empty)];
  $("swapAlt").innerHTML = ""; $("swapAlt").append(...ids(g ? g.alt : [], "–"));
  $("swapNeu").innerHTML = ""; $("swapNeu").append(...ids(g ? g.neu : [], "–"));
  $("swapMoreAlt").hidden = !g || st === "alt"; $("swapMoreNeu").hidden = !g || !g.neu.length || st === "neu";
  $("swapNew").hidden = !g || st === "alt" && !g.alt.length;
  if (mode === "tausch") $("scanIn").placeholder = (!g || st === "alt" || st === "done") ? "ALTES Gerät scannen" : "NEUES Gerät scannen";
}
$("swapMoreAlt").onclick = () => { if (!swap) return; swap.force = "alt"; saveSwap(); renderSwap(); setMsg("Weiteres altes Gerät scannen.", ""); refocus(); };
$("swapMoreNeu").onclick = () => { if (!swap) return; swap.force = "neu"; saveSwap(); renderSwap(); setMsg("Weiteres neues Gerät scannen.", ""); refocus(); };
$("swapNew").onclick = () => { swap = null; saveSwap(); renderSwap(); setMsg("Neuer Austausch: altes Gerät scannen.", ""); refocus(); };

function renderScan(first) {
  const j = jobById(cur); if (!j) return;
  $("topTitle").textContent = j.kunde; $("topSub").textContent = j.code;
  const sel = $("siteSel");
  if (first || sel.options.length !== j.sites.length) {
    sel.innerHTML = ""; j.sites.forEach((s, i) => sel.append(h("option", { value: s.id }, (j.sites.length > 1 ? (i + 1) + ". " : "") + siteLabel(s))));
    const last = ls.get("site:" + j.id, null); siteId = j.sites.some(s => s.id === last) ? last : (j.sites[0] && j.sites[0].id); sel.value = siteId;
    const dt = ls.get("det:" + j.id, {}); $("dEtage").value = dt.etage || ""; $("dRaum").value = dt.raum || ""; $("dBuero").value = dt.buero || "";
    swap = ls.get("swap:" + j.id, null);
    const sa = sollOf(j, null, "auf"), sb = sollOf(j, null, "ab");
    const def = ls.get("mode:" + j.id, null) || (Object.keys(sa).length && Object.keys(sb).length ? "tausch" : Object.keys(sa).length ? "auf" : "ab");
    setMode(def);
  }
  $("siteSelF").hidden = j.sites.length < 2;
  const s = j.sites.find(x => x.id === siteId) || j.sites[0];
  const sa = $("siteAddr"); sa.innerHTML = "";
  if (s) sa.append(...[h("b", null, siteLabel(s)), h("br"), "👤 " + s.kontakt + " · 📞 " + s.telefon, s.zutritt ? " · 🔑 " + s.zutritt : ""].filter(Boolean));
  const closed = j.status === "abgeschlossen";
  $("scanIn").disabled = closed; $("scanForm").querySelector("button").disabled = closed;
  ["camIn", "galIn"].forEach(id => { $(id).disabled = closed; });
  document.querySelectorAll("#dirSeg button").forEach(b => b.disabled = closed);
  if (closed) setMsg("Auftrag ist abgeschlossen. Erfassen nicht mehr möglich.", "bad");
  $("progSite").textContent = j.sites.length > 1 ? "· Standort " + (j.sites.indexOf(s) + 1) : "";
  $("sProgress").innerHTML = ""; $("sProgress").append(progressEl(j, listAll ? null : siteId));
  renderSwap(); renderMat(j); renderRows(j);
  $("detSum").textContent = [$("dEtage").value, $("dRaum").value && "Raum " + $("dRaum").value, $("dBuero").value].filter(Boolean).join(" · ");
  if (first && matchMedia("(pointer:fine)").matches && !closed) setTimeout(() => $("scanIn").focus(), 50);
}
$("siteSel").addEventListener("change", e => { siteId = e.target.value; ls.set("site:" + cur, siteId); swap = null; saveSwap(); renderScan(false); setMsg("Standort gewechselt. Bereit.", ""); refocus(); });
$("lsSite").onclick = () => { listAll = false; $("lsSite").setAttribute("aria-pressed", true); $("lsAll").setAttribute("aria-pressed", false); renderScan(false); };
$("lsAll").onclick = () => { listAll = true; $("lsSite").setAttribute("aria-pressed", false); $("lsAll").setAttribute("aria-pressed", true); renderScan(false); };
function setMsg(t, cls) { const m = $("scanMsg"); m.className = "msg " + (cls || ""); m.textContent = t; void m.offsetWidth; if (cls) m.classList.add("flash"); }
function refocus() { if (matchMedia("(pointer:fine)").matches && view === "scan") setTimeout(() => $("scanIn").focus({ preventScroll: true }), 30); }
function renderRows(j) {
  const rows = scansOf(j.id, listAll ? null : siteId).reverse(); const tb = $("scanRows"); tb.innerHTML = "";
  $("listCount").textContent = rows.length ? "· " + rows.length : "";
  $("scanEmpty").hidden = rows.length > 0; $("scanEmpty").textContent = listAll ? "Noch nichts erfasst." : "Noch nichts erfasst an diesem Standort.";
  const total = rows.length; const siteNo = id => j.sites.findIndex(s => s.id === id) + 1;
  const swapNo = {}; swapsOf(j.id).forEach(g => swapNo[g.grp] = g.no);
  rows.forEach((s, i) => {
    const ty = devType(s.asset), d = dirOf(s);
    const canDel = j.status !== "abgeschlossen" && (s.user_id === me.id || isLead(j));
    const del = canDel ? h("button", { class: "x" + (armed === s.id ? " arm" : ""), type: "button", onclick: () => {
      if (armed !== s.id) { armed = s.id; renderRows(j); setTimeout(() => { if (armed === s.id) { armed = null; renderRows(j); } }, 3000); return; }
      armed = null; removeScan(j, s);
    } }, armed === s.id ? "Sicher?" : "Löschen") : "";
    const extra = [s.cond && s.cond !== "ok" ? (s.cond === "defekt" ? "Defekt" : "Spuren") : "", s.note].filter(Boolean).join(" · ");
    const ort = [listAll && j.sites.length > 1 ? "S" + siteNo(s.site_id) : "", s.etage, s.raum && "R " + s.raum, s.place && "P " + s.place].filter(Boolean).join(" · ");
    const artTag = s.art === "tausch" ? "Tausch " + (swapNo[s.grp] || "") + (d === "ab" ? " ↓" : " ↑") : (d === "ab" ? "Abbau" : "Aufbau");
    tb.append(h("tr", { class: (s.id === freshId ? "fresh " : "") + (s.pending ? "pending" : "") },
      h("td", { class: "n" }, String(total - i)), h("td", { class: "a" }, s.asset, extra ? h("small", null, extra) : null),
      h("td", null, h("span", { class: "tag" + (ty ? "" : " unk") }, ty || "Unbekannt")), h("td", null, h("span", { class: "tag " + d }, artTag)),
      h("td", { class: "o hide-s" }, ort), h("td", { class: "b hide-s" }, (s.by || "").split(" ")[0]), h("td", null, del)));
  });
}
function removeScan(j, s) {
  const d = jd(j.id);
  const qi = queue.findIndex(q => q.op === "scan" && q.item.id === s.id);
  if (qi >= 0) { queue.splice(qi, 1); ls.set("queue", queue); } else enqueue({ op: "scandel", job: j.id, id: s.id });
  delete d.scans[s.id]; saveJd(j.id);
  if (swap && s.grp === swap.grp && !swapsOf(j.id).some(g => g.grp === swap.grp)) { swap = null; saveSwap(); }
  renderScan(false); toast("Gelöscht: " + s.asset);
}
function details() { return { etage: $("dEtage").value.trim(), raum: $("dRaum").value.trim(), buero: $("dBuero").value.trim(), place: $("dPlatz").value.trim(), cond, note: $("dNote").value.trim() }; }
["dEtage", "dRaum", "dBuero"].forEach(id => $(id).addEventListener("input", () => { ls.set("det:" + cur, { etage: $("dEtage").value, raum: $("dRaum").value, buero: $("dBuero").value }); $("detSum").textContent = [$("dEtage").value, $("dRaum").value && "Raum " + $("dRaum").value, $("dBuero").value].filter(Boolean).join(" · "); }));
document.querySelectorAll("#dCond button").forEach(b => b.onclick = () => { cond = b.dataset.v; document.querySelectorAll("#dCond button").forEach(x => x.setAttribute("aria-pressed", x === b)); });
function clearTransient() { $("dPlatz").value = ""; $("dNote").value = ""; cond = "ok"; document.querySelectorAll("#dCond button").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === "ok")); }
function addAsset(raw) {
  const j = jobById(cur); if (!j || j.status === "abgeschlossen") return false;
  const a = clean(raw); if (!a) return false;
  if (!siteId) { setMsg("Zuerst Standort wählen.", "bad"); beepBad(); return false; }
  if (a.length < 4) { setMsg("«" + a + "» ist zu kurz für eine Asset-ID.", "bad"); beepBad(); return false; }
  // Richtung bestimmen
  let dir = mode === "auf" ? "auf" : "ab", grp = null, art = "einzeln", step = null;
  if (mode === "tausch") {
    art = "tausch"; step = nextStep(j);
    const g = curSwap(j);
    if (!g || step === "done") { swap = { grp: uid(), step: "alt" }; step = "alt"; }
    else if (step === "neu-or-done") step = "neu";
    dir = step === "alt" ? "ab" : "auf"; grp = swap.grp;
    const cg = curSwap(j);
    if (dir === "auf" && cg && cg.alt.some(x => norm(x.asset) === norm(a))) { setMsg("Das ist das ALTE Gerät dieses Austauschs. Jetzt das NEUE scannen.", "bad"); beepBad(); return false; }
  }
  const all = Object.values(jd(j.id).scans);
  const dup = all.find(x => norm(x.asset) === norm(a) && dirOf(x) === dir);
  if (dup) { setMsg("Schon " + (dir === "ab" ? "abgebaut" : "aufgebaut") + ": " + a + " (" + (dup.by || "?").split(" ")[0] + ", " + fmtTs(dup.ts) + ")", "warn"); beepWarn(); return false; }
  const ty = devType(a), dt = details();
  const rec = { id: uid(), asset: a, site_id: siteId, dir, art, ...Object.fromEntries(Object.entries(dt).filter(([, v]) => v)), by: me.name, user_id: me.id, ts: Date.now(), pending: true };
  if (grp) rec.grp = grp;
  if (rec.cond === "ok") delete rec.cond;
  jd(j.id).scans[rec.id] = rec; saveJd(j.id); enqueue({ op: "scan", job: j.id, item: rec });
  freshId = rec.id;
  if (swap) { delete swap.force; saveSwap(); }
  const ist = counts(j.id, siteId, dir)[ty] || 0, soll = sollOf(j, siteId, dir)[ty] || 0;
  const lbl = dir === "ab" ? "Abbau" : "Aufbau";
  let warn = !ty ? "Unbekannter Gerätetyp. Richtiger Barcode?" : ist > soll ? "mehr als geplant (" + ist + " / " + soll + ")" : "";
  if (mode === "tausch") {
    const after = nextStep(j);
    if (after === "done" || (after === "neu-or-done" && dir === "auf")) clearTransient();
    const what = dir === "ab" ? "Alt" : "Neu";
    setMsg((warn ? "" : "✓ ") + what + ": " + a + (ty ? " · " + ty : "") + (warn ? " · " + warn : "") + (after === "alt" ? " → weiteres ALTES scannen" : after === "neu" ? " → jetzt NEUES scannen" : " → Austausch fertig"), warn ? "warn" : "ok");
  } else {
    clearTransient();
    setMsg((warn ? "" : "✓ ") + lbl + ": " + a + (ty ? " · " + ty : "") + (warn ? " · " + warn : " · " + ist + " / " + soll), warn ? "warn" : "ok");
  }
  warn ? beepWarn() : beepOk();
  renderScan(false);
  toast(lbl + ": " + a, "Rückgängig", () => removeScan(j, rec));
  return true;
}
$("scanForm").addEventListener("submit", e => { e.preventDefault(); if (addAsset($("scanIn").value)) $("scanIn").value = ""; else $("scanIn").select(); refocus(); });
// Handscanner ohne Enter: schnelle Zeichenfolge automatisch übernehmen
(function () {
  const inp = $("scanIn"); let t = null, first = 0, len0 = 0;
  inp.addEventListener("input", e => {
    clearTimeout(t); const now = Date.now(), v = inp.value.trim();
    if (!v) { first = 0; return; }
    if (!first || now - first > 1500) { first = now; len0 = 0; }
    const burst = v.length - len0 >= 5 && now - first < 300;
    const pasted = e.inputType === "insertFromPaste" || e.inputType === "insertReplacementText";
    if (burst || pasted) t = setTimeout(() => { first = 0; if (addAsset(inp.value)) inp.value = ""; else inp.select(); }, 180);
  });
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { clearTimeout(t); first = 0; } });
})();
// Laptop: Tippen irgendwo in der Scan-Ansicht landet im Scanfeld
document.addEventListener("keydown", e => {
  if (view !== "scan" || !$("dlg").hidden || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
  const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  $("scanIn").focus();
});
/* Kamera & Galerie */
function loadImg(file) { return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Bild nicht lesbar")); im.src = u; }); }
function toCanvas(img, max, rot) {
  const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const w = Math.round(img.naturalWidth * sc), hh = Math.round(img.naturalHeight * sc);
  const c = document.createElement("canvas"); const r = rot % 180 !== 0; c.width = r ? hh : w; c.height = r ? w : hh;
  const x = c.getContext("2d", { willReadFrequently: true }); x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 180); x.drawImage(img, -w / 2, -hh / 2, w, hh); return c;
}
async function decode(img) {
  const found = new Set();
  if ("BarcodeDetector" in window) { try { (await new BarcodeDetector().detect(img)).forEach(b => b.rawValue && found.add(b.rawValue.trim())); } catch (e) {} }
  if (!found.size && window.ZXing) {
    const Z = window.ZXing, hints = new Map(); hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.ITF]);
    const reader = new Z.MultiFormatReader(); reader.setHints(hints);
    outer: for (const max of [1600, 2400, 1000]) for (const rot of [0, 90]) {
      try { const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(toCanvas(img, max, rot))))); if (r && r.getText()) { found.add(r.getText().trim()); break outer; } } catch (e) {}
    }
  }
  return [...found].filter(Boolean);
}
function pickCode(codes) {
  const known = codes.filter(c => devType(c)); if (known.length === 1) return known[0];
  if (codes.length === 1) return codes[0]; return null;
}
async function photoScan(files) {
  const p = $("picks"); p.innerHTML = ""; p.hidden = true;
  let ok = 0, none = 0;
  for (let i = 0; i < files.length; i++) {
    setMsg("Lese Foto " + (i + 1) + " von " + files.length + " …", "");
    let codes = []; try { const img = await loadImg(files[i]); codes = await decode(img); URL.revokeObjectURL(img.src); } catch (e) {}
    if (!codes.length) { none++; continue; }
    const c = pickCode(codes);
    if (c) { if (addAsset(c)) ok++; continue; }
    p.append(h("div", { class: "hint", style: "margin:4px 0 0" }, "Foto " + (i + 1) + ": welcher Code ist die Asset-ID?"));
    codes.forEach(code => p.append(h("button", { type: "button", onclick: e => { addAsset(code); e.target.parentNode && [...p.children].forEach(x => x.remove()); p.hidden = true; } }, code + (devType(code) ? " · " + devType(code) : ""))));
    p.hidden = false;
  }
  if (none) { setMsg((files.length > 1 ? ok + " erfasst, " : "") + (none === 1 ? "auf einem Foto" : "auf " + none + " Fotos") + " kein Barcode erkannt. Näher ran, gerade halten, Blitz aus.", "bad"); beepBad(); }
}
$("camIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) photoScan(f); });
$("galIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; if (f.length) photoScan(f); });

/* Material */
function renderMat(j) {
  const box = $("matList"); box.innerHTML = "";
  const closed = j.status === "abgeschlossen";
  const items = catalog.filter(c => c.verbrauch).map(c => c.name);
  matsOf(j.id, siteId).forEach(m => { if (!items.includes(m.item)) items.push(m.item); });
  let total = 0; const unused = [];
  items.forEach(name => {
    const rows = matsOf(j.id, siteId).filter(m => m.item === name); const q = rows.reduce((a, m) => a + m.qty, 0);
    if (!q) { unused.push(name); return; }
    total += q;
    const where = rows.map(m => m.qty + "× " + ([m.etage, m.raum && "R " + m.raum, m.place && "P " + m.place].filter(Boolean).join(" ") || "ohne Ort")).join(", ");
    box.append(h("div", { class: "mrow" }, h("div", { class: "mn" }, name, h("small", null, where)),
      h("div", { class: "step" }, h("button", { type: "button", disabled: closed, onclick: () => matStep(j, name, -1), "aria-label": name + " weniger" }, "−"), h("b", null, String(q)),
        h("button", { type: "button", class: "plus", disabled: closed, onclick: () => matStep(j, name, 1), "aria-label": name + " mehr" }, "+"))));
  });
  if (!total) box.append(h("div", { class: "hint", style: "margin:0" }, "Noch nichts verbraucht. Antippen, was du eingebaut hast:"));
  if (unused.length && !closed) box.append(h("div", { class: "matchips" }, unused.map(n => h("button", { type: "button", onclick: () => matStep(j, n, 1) }, "+ " + n))));
  $("matSum").textContent = total ? "· " + total + " Stück" : "";
}
function matStep(j, item, delta) {
  const d = jd(j.id), dt = details();
  const key = [siteId, item, dt.etage, dt.raum, dt.place].join("|");
  let row = d.mats[key];
  if (delta < 0 && (!row || !row.qty)) row = matsOf(j.id, siteId).filter(m => m.item === item).sort((a, b) => b.ts - a.ts)[0];
  if (!row) row = d.mats[key] = { id: key, site_id: siteId, item, qty: 0, etage: dt.etage, raum: dt.raum, place: dt.place, by: me.name };
  row.qty = Math.max(0, (row.qty || 0) + delta); row.ts = Date.now();
  saveJd(j.id);
  const qi = queue.findIndex(q => q.op === "mat" && q.item.id === row.id);
  const item2 = { id: row.id, site_id: row.site_id, item: row.item, qty: row.qty, etage: row.etage || "", raum: row.raum || "", place: row.place || "", ts: row.ts };
  if (qi >= 0) { queue[qi].item = item2; ls.set("queue", queue); kick(); } else enqueue({ op: "mat", job: j.id, item: item2 });
  renderMat(j); if (delta > 0) tone(1320, .04);
}
$("matFree").addEventListener("submit", e => {
  e.preventDefault(); const j = jobById(cur); const v = $("matFreeIn").value.trim().replace(/\s+/g, " "); if (!v || !j || j.status === "abgeschlossen") return;
  matStep(j, v, 1); $("matFreeIn").value = ""; toast(v + " hinzugefügt");
});

/* ---------- Auftrag anlegen / bearbeiten ---------- */
let formJob = null, fArt = "rollout", fSites = [], users = [];
async function openForm(id) {
  formJob = id; const j = id ? jobById(id) : null;
  $("topTitle").textContent = j ? "Auftrag bearbeiten" : "Neuer Auftrag"; $("topSub").textContent = j ? j.code : "";
  $("fTitle").textContent = j ? "Auftrag bearbeiten" : "Neuer Auftrag"; $("fErr").innerHTML = ""; $("fGo").textContent = j ? "Änderungen speichern" : "Auftrag freigeben";
  setArt(j ? j.art : "rollout");
  $("fKunde").value = j ? j.kunde : ""; $("fWo").value = j ? (j.wo || "") : "";
  $("fDatum").value = j ? j.datum : ""; $("fDatum").min = j ? "" : today(); $("fTausch").value = j ? (j.tausch || "1:1") : "1:1";
  $("fVon").value = j ? j.zeit_von : ""; $("fBis").value = j ? j.zeit_bis : ""; $("fNotes").value = j ? (j.notes || "") : "";
  fSites = j ? j.sites.map(s => ({ ...s, soll: { ...s.soll } })) : [blankSite()];
  renderSites(); renderFormMat(j); updCode();
  document.querySelectorAll("#jobForm .invalid").forEach(x => x.classList.remove("invalid"));
  const sel = $("fLead"); sel.innerHTML = ""; sel.append(h("option", { value: "" }, "Lade Kollegen …"));
  try { users = await rpc("app_users") || []; } catch (e) { users = []; }
  sel.innerHTML = ""; sel.append(h("option", { value: "" }, "– Lead wählen –"));
  users.forEach(u => sel.append(h("option", { value: u.id }, u.name + (u.role !== "tech" ? " (" + (u.role === "admin" ? "Admin" : "Dispatcher") + ")" : ""))));
  sel.value = j ? (j.lead || "") : "";
  if (!users.length) sel.append(h("option", { value: "", disabled: true }, "Keine Kollegen geladen. Internet?"));
}
const blankSite = () => ({ id: uuid(), gebaeude: "", strasse: "", plz: "", ort: "", kontakt: "", telefon: "", zutritt: "", soll: {} });
function setArt(a) { fArt = a; document.querySelectorAll("#fArt button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === a)); $("fAddSite").hidden = a !== "tour"; if (a === "rollout" && fSites.length > 1) { fSites = fSites.slice(0, 1); renderSites(); } }
document.querySelectorAll("#fArt button").forEach(b => b.onclick = () => { if (b.dataset.v === "rollout" && fSites.length > 1) return ask("Auf Rollout umstellen?", "Ein Rollout hat nur einen Standort. Die Standorte 2–" + fSites.length + " werden entfernt.", [{ label: "Abbrechen" }, { label: "Umstellen", cls: "danger", fn: () => setArt("rollout") }]); setArt(b.dataset.v); });
$("fAddSite").onclick = () => { fSites.push(blankSite()); renderSites(); const cards = $("fSites").querySelectorAll(".sitecard"); cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "start" }); };
function renderSites() {
  const box = $("fSites"); box.innerHTML = "";
  fSites.forEach((s, i) => {
    const inp = (k, label, req, ph, attrs) => h("div", { class: "fld" }, h("label", { for: "s" + i + k }, label, req ? h("span", { class: "req" }, " ✱") : null),
      h("input", { id: "s" + i + k, type: "text", value: s[k] || "", placeholder: ph || "", "data-site": i, "data-k": k, oninput: e => { s[k] = e.target.value; e.target.classList.remove("invalid"); updCode(); }, ...(attrs || {}) }));
    if (!s.soll.ab && !s.soll.auf) s.soll = Object.keys(s.soll || {}).length ? { ab: { ...s.soll }, auf: {} } : { ab: {}, auf: {} };
    const cell = (d, t) => h("td", null, h("input", { id: "s" + i + "soll" + d + t, type: "number", min: "0", step: "1", inputmode: "numeric", value: s.soll[d][t] || "", placeholder: "0", "data-soll": i, "aria-label": t + " " + (d === "ab" ? "Abbau" : "Aufbau"),
      oninput: e => { const n = parseInt(e.target.value) || 0; if (n) s.soll[d][t] = n; else delete s.soll[d][t]; document.querySelectorAll('[data-soll="' + i + '"]').forEach(x => x.classList.remove("invalid")); } }));
    const soll = h("table", { class: "sollt" }, h("thead", null, h("tr", null, h("th", null, "Gerätetyp"), h("th", { class: "ab" }, "Abbau (alt)"), h("th", { class: "auf" }, "Aufbau (neu)"))),
      h("tbody", null, TYPE_NAMES.map(t => h("tr", null, h("td", null, t), cell("ab", t), cell("auf", t)))));
    box.append(h("section", { class: "card sitecard" },
      h("div", { class: "sch" }, h("h2", null, fArt === "tour" ? "Standort " + (i + 1) : "Standort"), fSites.length > 1 ? h("button", { type: "button", class: "btn link", onclick: () => { fSites.splice(i, 1); renderSites(); updCode(); } }, "Entfernen") : null),
      inp("gebaeude", "Gebäude / Bezeichnung", false, "z. B. HWLC"),
      h("div", { class: "row2" }, inp("strasse", "Strasse und Nr.", true, "Hardturmstrasse 1"), h("div", { class: "row2" }, inp("plz", "PLZ", true, "8005", { inputmode: "numeric" }), inp("ort", "Ort", true, "Zürich"))),
      h("div", { class: "row2" }, inp("kontakt", "Ansprechperson vor Ort", true, "Vorname Nachname"), inp("telefon", "Telefon", true, "044 123 45 67", { type: "tel", inputmode: "tel" })),
      inp("zutritt", "Zutritt & Hinweise", false, "Badge am Empfang, Parkplatz hinten, Lift B"),
      h("div", { class: "fld" }, h("span", { class: "l" }, "Soll: Anzahl Geräte ", h("span", { class: "req" }, "✱")), h("div", { class: "hint", style: "margin:0" }, "Austausch = alt abbauen und neu aufbauen. Beides eintragen, z. B. 2 Monitore ab und 1 Monitor auf."), soll)));
  });
}
function renderFormMat(j) {
  const box = $("fMat"); box.innerHTML = "";
  const have = {}; ((j && j.material) || []).forEach(m => have[m.name] = m.qty);
  const names = catalog.filter(c => c.mitnehmen).map(c => c.name); Object.keys(have).forEach(n => { if (!names.includes(n)) names.push(n); });
  if (!names.length) box.append(h("div", { class: "hint" }, "Katalog nicht geladen. Internet?"));
  names.forEach(n => box.append(h("label", { class: "fm" }, h("span", null, n), h("input", { type: "number", min: "0", step: "1", inputmode: "numeric", "data-mat": n, value: have[n] || "", placeholder: "0" }))));
}
function updCode() {
  const d = $("fDatum").value, k = $("fKunde").value.trim(), s = fSites[0] || {};
  const first = (s.gebaeude || "").trim() || (s.ort || "").trim();
  if (!d || !k || !first) { $("fCode").textContent = "wird aus Gebäude/Ort, Kunde und Datum gebildet"; return; }
  $("fCode").textContent = (first + "_" + k).replace(/[^A-Za-z0-9ÄÖÜäöü]+/g, "_").toUpperCase().replace(/_+/g, "_") + "_" + d.replace(/-/g, "_");
}
["fKunde", "fDatum"].forEach(id => $(id).addEventListener("input", updCode));
$("jobForm").addEventListener("input", e => { e.target.classList && e.target.classList.remove("invalid"); if ($("fErr").textContent && !document.querySelector("#jobForm .invalid")) $("fErr").textContent = ""; });
$("fCancel").onclick = () => formJob ? go("#job/" + formJob) : go("#");
$("jobForm").addEventListener("submit", async e => {
  e.preventDefault();
  document.querySelectorAll("#jobForm .invalid").forEach(x => x.classList.remove("invalid"));
  const miss = [], bad = el => { el.classList.add("invalid"); };
  const need = (id, label) => { const el = $(id); if (!el.value.trim()) { bad(el); miss.push(label); } };
  need("fKunde", "Kunde"); need("fDatum", "Datum"); need("fVon", "Zeit von"); need("fBis", "Zeit bis"); need("fLead", "Lead");
  const d = $("fDatum").value;
  if (d && !formJob && d < today()) { bad($("fDatum")); miss.push("Datum liegt in der Vergangenheit"); }
  if ($("fVon").value && $("fBis").value && $("fBis").value <= $("fVon").value) { bad($("fBis")); miss.push("«Bis» muss nach «Von» sein"); }
  fSites.forEach((s, i) => {
    const pre = fSites.length > 1 ? "Standort " + (i + 1) + ": " : "";
    [["strasse", "Strasse"], ["plz", "PLZ"], ["ort", "Ort"], ["kontakt", "Ansprechperson"], ["telefon", "Telefon"]].forEach(([k, l]) => { if (!(s[k] || "").trim()) { bad($("s" + i + k)); miss.push(pre + l); } });
    if (s.plz && !/^\d{4,5}$/.test(s.plz.trim())) { bad($("s" + i + "plz")); miss.push(pre + "PLZ ungültig"); }
    if (s.telefon && s.telefon.replace(/\D/g, "").length < 9) { bad($("s" + i + "telefon")); miss.push(pre + "Telefonnummer zu kurz"); }
    if (![...Object.values(s.soll.ab || {}), ...Object.values(s.soll.auf || {})].some(v => v > 0)) { document.querySelectorAll('[data-soll="' + i + '"]').forEach(bad); miss.push(pre + "Soll: mindestens ein Gerät"); }
  });
  if (miss.length) {
    $("fErr").innerHTML = ""; $("fErr").append("Noch nicht vollständig:", h("ul", null, miss.map(m => h("li", null, m))));
    const first = document.querySelector("#jobForm .invalid"); first && first.scrollIntoView({ behavior: "smooth", block: "center" }); beepBad(); return;
  }
  const days = (Date.parse(d) - Date.parse(today())) / 864e5;
  if (days > 60 && !e.submitter?.dataset.ok) return ask("Datum prüfen", "Der Auftrag ist am " + fmtDate(d) + ", also in " + Math.round(days) + " Tagen. Stimmt das?", [{ label: "Korrigieren", fn: () => $("fDatum").focus() }, { label: "Ja, stimmt", cls: "primary", fn: () => { $("fGo").dataset.ok = 1; $("fGo").click(); delete $("fGo").dataset.ok; } }]);
  const material = [...document.querySelectorAll("[data-mat]")].map(x => ({ name: x.dataset.mat, qty: parseInt(x.value) || 0 })).filter(m => m.qty > 0);
  const p = { id: formJob || undefined, art: fArt, tausch: $("fTausch").value, kunde: $("fKunde").value.trim(), datum: d, zeit_von: $("fVon").value, zeit_bis: $("fBis").value, wo: $("fWo").value.trim(), lead: $("fLead").value,
    material, notes: $("fNotes").value.trim(), sites: fSites.map(s => ({ id: s.id, gebaeude: s.gebaeude, strasse: s.strasse, plz: s.plz, ort: s.ort, kontakt: s.kontakt, telefon: s.telefon, zutritt: s.zutritt, soll: s.soll })) };
  $("fGo").disabled = true; $("fErr").textContent = "Speichere …";
  try {
    const r = await rpc("job_save", { p }); const i = jobs.findIndex(x => x.id === r.id); if (i >= 0) jobs[i] = r; else jobs.push(r); ls.set("jobs", jobs);
    $("fErr").textContent = ""; toast(formJob ? "Gespeichert" : "Auftrag " + r.code + " freigegeben"); beepOk(); go("#job/" + r.id);
  } catch (err) { $("fErr").textContent = errText(err); beepBad(); }
  finally { $("fGo").disabled = false; }
});

/* ---------- Benutzer (Admin) ---------- */
async function renderUsers() {
  $("topTitle").textContent = "Benutzer"; $("topSub").textContent = "";
  const box = $("userList"); box.innerHTML = "Lade …";
  try { users = await rpc("app_users") || []; } catch (e) { box.textContent = errText(e); return; }
  box.innerHTML = "";
  users.forEach(u => {
    const sel = h("select", { "aria-label": "Rolle von " + u.name, onchange: async e => {
      try { await rpc("app_set_role", { p_user: u.id, p_role: e.target.value }); u.role = e.target.value; toast(u.name + " ist jetzt " + e.target.selectedOptions[0].text); }
      catch (err) { toast(errText(err)); e.target.value = u.role; }
    } }, [["tech", "Techniker"], ["dispatcher", "Dispatcher"], ["admin", "Admin"]].map(([v, l]) => h("option", { value: v, selected: u.role === v }, l)));
    box.append(h("div", { class: "urow" }, h("div", null, h("b", null, u.name), h("small", null, u.email || "")), sel));
  });
}

/* ---------- Material-Katalog (Dispatcher) ---------- */
let catEdit = [];
function renderCat() {
  $("topTitle").textContent = "Material-Katalog"; $("topSub").textContent = "";
  catEdit = catalog.map(c => ({ ...c })); drawCat();
  rpc("catalog_get").then(c => { catalog = c || []; ls.set("catalog", catalog); catEdit = catalog.map(x => ({ ...x })); drawCat(); }).catch(() => {});
}
function drawCat() {
  const box = $("catRows"); box.innerHTML = "";
  catEdit.forEach((c, i) => box.append(h("div", { class: "catrow" },
    h("input", { type: "text", value: c.name, "aria-label": "Artikel", oninput: e => c.name = e.target.value }),
    h("input", { type: "checkbox", checked: c.mitnehmen, "aria-label": "Mitnehmen", onchange: e => c.mitnehmen = e.target.checked }),
    h("input", { type: "checkbox", checked: c.verbrauch, "aria-label": "Verbrauch", onchange: e => c.verbrauch = e.target.checked }),
    h("button", { type: "button", "aria-label": "Entfernen", onclick: () => { catEdit.splice(i, 1); drawCat(); } }, "×"))));
}
$("catAdd").onclick = () => { catEdit.push({ name: "", mitnehmen: true, verbrauch: true }); drawCat(); const ins = $("catRows").querySelectorAll('input[type=text]'); ins[ins.length - 1].focus(); };
$("catSave").onclick = async () => {
  try { await rpc("catalog_set", { p: catEdit.filter(c => c.name.trim()) }); catalog = await rpc("catalog_get") || []; ls.set("catalog", catalog); toast("Katalog gespeichert"); go("#"); }
  catch (e) { toast(errText(e)); }
};

/* ---------- Excel ---------- */
const condTxt = c => c === "defekt" ? "Defekt" : c === "gebraucht" ? "Gebrauchsspuren" : "OK";
function saveFile(blob, fn) {
  try { const f = new File([blob], fn, { type: blob.type }); if (navigator.canShare && navigator.canShare({ files: [f] }) && matchMedia("(pointer:coarse)").matches) return navigator.share({ files: [f], title: fn }).catch(() => {}); } catch (e) {}
  const a = h("a", { href: URL.createObjectURL(blob), download: fn }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const sheet = (rows, cols) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = cols.map(w => ({ wch: w })); if (rows.length > 1) ws["!autofilter"] = { ref: ws["!ref"] }; return ws; };
async function exportJob(j) {
  try { await pullJob(j.id); } catch (e) {}
  const wb = XLSX.utils.book_new(), S = id => j.sites.find(s => s.id === id) || {}, No = id => j.sites.findIndex(s => s.id === id) + 1;
  const info = [["Auftrag", j.code], ["Kunde", j.kunde], ["Datum", fmtDate(j.datum)], ["Zeit", j.zeit_von + " – " + j.zeit_bis], ["WO / INC", j.wo || ""], ["Lead", j.lead_name || ""], ["Team", (j.members || []).join(", ")], ["Status", j.status], [],
    ["Nr", "Gebäude", "Adresse", "Ansprechperson", "Telefon", "Zutritt"], ...j.sites.map((s, i) => [i + 1, s.gebaeude || "", addr(s), s.kontakt, s.telefon, s.zutritt || ""])];
  XLSX.utils.book_append_sheet(wb, sheet(info, [16, 22, 34, 22, 16, 30]), "Auftrag");
  const sc = scansOf(j.id);
  const sw = swapsOf(j.id), swNo = {}; sw.forEach(g => swNo[g.grp] = g.no);
  XLSX.utils.book_append_sheet(wb, sheet([["Nr", "Asset-ID", "Gerätetyp", "Richtung", "Art", "Austausch-Nr", "Standort", "Gebäude", "Adresse", "Etage", "Raum", "Büro", "Arbeitsplatz", "Zustand", "Notiz", "Erfasst", "Erfasst durch"],
    ...sc.map((s, i) => [i + 1, s.asset, devType(s.asset) || "Unbekannt", dirOf(s) === "ab" ? "Abbau" : "Aufbau", s.art === "tausch" ? "Austausch" : "Einzeln", swNo[s.grp] || "", No(s.site_id), S(s.site_id).gebaeude || "", addr(S(s.site_id)), s.etage || "", s.raum || "", s.buero || "", s.place || "", condTxt(s.cond), s.note || "", new Date(s.ts).toLocaleString("de-CH"), s.by || ""])],
    [5, 16, 20, 10, 11, 12, 9, 14, 30, 9, 9, 14, 12, 15, 24, 17, 20]), "Geräte");
  XLSX.utils.book_append_sheet(wb, sheet([["Austausch-Nr", "Alt (Abbau)", "Typ alt", "Neu (Aufbau)", "Typ neu", "Standort", "Adresse", "Etage", "Raum", "Arbeitsplatz", "Erfasst durch"],
    ...sw.map(g => { const f = g.alt[0] || g.neu[0] || {}; return [g.no, g.alt.map(x => x.asset).join(", "), [...new Set(g.alt.map(x => devType(x.asset) || "Unbekannt"))].join(", "), g.neu.map(x => x.asset).join(", "), [...new Set(g.neu.map(x => devType(x.asset) || "Unbekannt"))].join(", "), No(g.site_id), addr(S(g.site_id)), f.etage || "", f.raum || "", f.place || "", [...new Set([...g.alt, ...g.neu].map(x => x.by))].join(", ")]; })],
    [12, 28, 18, 28, 18, 9, 30, 9, 9, 12, 20]), "Austausch");
  const si = [["Standort", "Gebäude", "Adresse", "Richtung", "Gerätetyp", "Soll", "Ist", "Differenz"]];
  j.sites.forEach((s, i) => DIRS.forEach(([d, l]) => { const ist = counts(j.id, s.id, d), soll = sollOf(j, s.id, d); [...new Set([...Object.keys(soll), ...Object.keys(ist)])].forEach(k => si.push([i + 1, s.gebaeude || "", addr(s), l, k, soll[k] || 0, ist[k] || 0, (ist[k] || 0) - (soll[k] || 0)])); }));
  XLSX.utils.book_append_sheet(wb, sheet(si, [9, 14, 30, 10, 20, 7, 7, 10]), "Soll-Ist");
  const ms = matsOf(j.id).sort((a, b) => No(a.site_id) - No(b.site_id) || a.item.localeCompare(b.item));
  XLSX.utils.book_append_sheet(wb, sheet([["Standort", "Gebäude", "Adresse", "Material", "Anzahl", "Etage", "Raum", "Arbeitsplatz", "Erfasst durch"], ...ms.map(m => [No(m.site_id), S(m.site_id).gebaeude || "", addr(S(m.site_id)), m.item, m.qty, m.etage || "", m.raum || "", m.place || "", m.by || ""])], [9, 14, 30, 20, 8, 9, 9, 12, 20]), "Material");
  const tot = {}; ms.forEach(m => { const k = No(m.site_id) + "|" + m.item; tot[k] = (tot[k] || 0) + m.qty; });
  const tt = [["Standort", "Adresse", "Material", "Total"], ...Object.entries(tot).map(([k, q]) => { const [n, it] = k.split("|"); return [+n, addr(j.sites[n - 1] || {}), it, q]; })];
  const all = {}; ms.forEach(m => all[m.item] = (all[m.item] || 0) + m.qty); if (ms.length) { tt.push([]); tt.push(["", "", "Total Auftrag", ""]); Object.entries(all).forEach(([it, q]) => tt.push(["", "", it, q])); }
  XLSX.utils.book_append_sheet(wb, sheet(tt, [9, 34, 22, 8]), "Material Total");
  saveFile(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), j.code + ".xlsx");
}
function exportLegacy() {
  const wb = XLSX.utils.book_new();
  legacyLists().forEach((l, i) => XLSX.utils.book_append_sheet(wb, sheet([["Nr", "Asset-ID", "Gerätetyp", "Ersetzt durch", "Etage", "Raum", "Büro", "Arbeitsplatz", "Zustand", "Notiz", "Erfasst", "Erfasst durch"],
    ...l.items.slice().sort((a, b) => a.ts - b.ts).map((s, k) => [k + 1, s.asset, devType(s.asset) || "Unbekannt", s.neu || "", s.etage || "", s.raum || "", s.buero || "", s.place || "", condTxt(s.cond), s.note || "", new Date(s.ts).toLocaleString("de-CH"), s.by || ""])], [5, 16, 20, 16, 9, 9, 14, 12, 15, 24, 17, 20]),
    (l.name || "Liste " + (i + 1)).replace(/[\\/?*[\]:]/g, "-").slice(0, 28) + (i ? " " + i : "")));
  saveFile(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Alte_Listen.xlsx");
}

/* ---------- Start ---------- */
if (session && me) { badge(); }
route();
if (session) { refreshJobs(); kick(500); }
setInterval(badge, 5000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
