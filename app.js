'use strict';

/* ───────────────────────────────────────────────────────────── state */

const $ = (id) => document.getElementById(id);

const els = {
  preset: $('preset'),
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  toggleKey: $('toggleKey'),
  btnConnect: $('btnConnect'),
  connNote: $('connNote'),
  connChip: $('connChip'),
  connText: $('connText'),
  providersBlock: $('providersBlock'),
  providerCount: $('providerCount'),
  providerList: $('providerList'),
  providerNote: $('providerNote'),
  btnForgetProviders: $('btnForgetProviders'),
  modelCount: $('modelCount'),
  modelFilter: $('modelFilter'),
  modelList: $('modelList'),
  btnSelectAll: $('btnSelectAll'),
  btnSelectNone: $('btnSelectNone'),
  btnSelectFast: $('btnSelectFast'),
  selectedCount: $('selectedCount'),
  promptPreset: $('promptPreset'),
  prompt: $('prompt'),
  system: $('system'),
  temperature: $('temperature'),
  maxTokens: $('maxTokens'),
  modeToggle: $('modeToggle'),
  gapField: $('gapField'),
  gapMs: $('gapMs'),
  concField: $('concField'),
  concurrency: $('concurrency'),
  repeats: $('repeats'),
  retries: $('retries'),
  modeNote: $('modeNote'),
  btnRun: $('btnRun'),
  btnCancel: $('btnCancel'),
  runHint: $('runHint'),
  rankingPanel: $('rankingPanel'),
  ranking: $('ranking'),
  rankingCount: $('rankingCount'),
  chartPanel: $('chartPanel'),
  chartCount: $('chartCount'),
  chartTimeline: $('chartTimeline'),
  chartTps: $('chartTps'),
  chartScatter: $('chartScatter'),
  boxFigure: $('boxFigure'),
  boxMetric: $('boxMetric'),
  chartBox: $('chartBox'),
  tablePanel: $('tablePanel'),
  statStrip: $('statStrip'),
  metricsBody: $('metricsBody'),
  tableHead: document.querySelectorAll('#metricsTable thead th.sortable'),
  answersPanel: $('answersPanel'),
  answers: $('answers'),
  viewToggle: $('viewToggle'),
  btnRetryFailed: $('btnRetryFailed'),
  btnExportCsv: $('btnExportCsv'),
  btnExportJson: $('btnExportJson'),
  btnExportMd: $('btnExportMd'),
  btnExportHtml: $('btnExportHtml'),
  historyPanel: $('historyPanel'),
  historyList: $('historyList'),
  btnClearHistory: $('btnClearHistory'),
  racePanel: $('racePanel'),
  raceCount: $('raceCount'),
  raceDone: $('raceDone'),
  raceNote: $('raceNote'),
  raceRing: $('raceRing'),
  raceList: $('raceList'),
  compareBar: $('compareBar'),
  toasts: $('toasts'),
  topProgress: $('topProgress'),
  btnTheme: $('btnTheme'),
  btnMotion: $('btnMotion'),
  btnKeys: $('btnKeys'),
  keysDialog: $('keysDialog'),
  btnKeysClose: $('btnKeysClose'),
};

const state = {
  /** Setiap provider: { id, label, baseUrl, apiKey, resolvedBase, models[] } */
  providers: [],
  /** Kunci seleksi berbentuk `${providerId}::${modelId}`. */
  selected: new Set(),
  results: new Map(),
  running: false,
  controllers: new Set(),
  sort: { key: 'total', dir: 'asc' },
  mode: 'parallel',
  cancelled: false,
  done: 0,
  targets: [],
  /** true bila hasil berasal dari lebih dari satu provider (badge provider ditampilkan). */
  multiProvider: false,
  /** Metrik kunci uji sebelumnya per model, untuk menandai perubahan performa. */
  baseline: new Map(),
  /** Kunci model yang dipilih lewat tombol ⇄ untuk dibandingkan berdampingan (maks. 2). */
  picked: new Set(),
};

let flushQueued = false;
let chartSig = '';
/** Model yang sedang disematkan sorotannya di seluruh diagram. */
let pinnedModel = null;

/* ══════════════════════════════════ animasi, tema & umpan balik ═════════ */

const THEME_KEY = 'frontstellar:theme:v1';
const MOTION_KEY = 'frontstellar:motion:v1';
const RING_LEN = 119.4;
const NS = 'http://www.w3.org/2000/svg';

/** Animasi dimatikan lewat sakelar "kurangi animasi" atau preferensi sistem. */
function motionOff() {
  if (document.documentElement.dataset.motion === 'reduced') return true;
  return Boolean(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    /* localStorage penuh atau diblokir: pengaturan dilewati, aplikasi tetap jalan */
  }
}

/** Notifikasi ringkas di kanan bawah; `action` menambahkan tombol (mis. Urungkan). */
function toast(message, opts) {
  const options = opts || {};
  const node = document.createElement('div');
  node.className = 'toast' + (options.kind ? ` ${options.kind}` : '');

  const text = document.createElement('span');
  text.textContent = message;
  node.appendChild(text);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    node.classList.add('out');
    setTimeout(() => node.remove(), 200);
  };

  if (options.action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = options.action;
    button.addEventListener('click', () => {
      close();
      if (options.onAction) options.onAction();
    });
    node.appendChild(button);
  }

  els.toasts.appendChild(node);
  setTimeout(close, options.life || (options.action ? 9000 : 3200));
  return close;
}

/** Angka naik dari nilai sebelumnya ke nilai baru; langsung tampil saat animasi mati. */
function countUp(node, to, format, from) {
  if (node.__count) cancelAnimationFrame(node.__count);
  const start = Number(from);
  if (!Number.isFinite(to) || !Number.isFinite(start) || start === to || motionOff()) {
    node.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const dur = 320;
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = format(start + (to - start) * eased);
    node.__count = k < 1 ? requestAnimationFrame(tick) : null;
  };
  node.__count = requestAnimationFrame(tick);
}

function applyTheme(theme) {
  if (theme === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;

  const light = theme === 'light';
  els.btnTheme.setAttribute('aria-pressed', String(light));
  els.btnTheme.textContent = light ? 'Gelap' : 'Terang';
  els.btnTheme.title = light ? 'Ganti ke tema gelap' : 'Ganti ke tema terang';

  window.ModelCharts.refreshPalette();
  chartSig = '';
  renderCharts();
}

function applyMotion(reduce) {
  if (reduce) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;

  els.btnMotion.setAttribute('aria-pressed', String(reduce));
  els.btnMotion.textContent = reduce ? 'Hening' : 'Gerak';
  els.btnMotion.title = reduce ? 'Nyalakan kembali animasi' : 'Kurangi animasi';
}

/* ───────────────────────────────────────────────────────────── format */

const fmtMs = (v) =>
  v == null ? '—' : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`;

const fmtInt = (v) => (v == null ? '—' : String(Math.round(v)));
const fmtDec = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

/** Tooltip sebaran min–max, hanya berguna bila model diulang lebih dari sekali. */
function spreadTip(label, spread, fmt) {
  if (!spread || spread.min == null || spread.max == null || spread.min === spread.max) return '';
  return `${label}: ${fmt(spread.min)} – ${fmt(spread.max)} (nilai tabel = median)`;
}

/** Tooltip p95 & simpangan baku, hanya berguna bila ada lebih dari satu sampel. */
function statsTip(label, stats, fmt) {
  if (!stats || stats.n < 2) return '';
  return `${label} p95: ${fmt(stats.p95)} · simpangan baku: ${fmt(stats.sd)} (${stats.n} sampel)`;
}

const cellTip = (...parts) => parts.filter(Boolean).join('\n');

/** Escape untuk laporan HTML mandiri (atribut & teks). */
const htmlEscape = (value) =>
  String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/* ─────────────────────────────────────────────────────────── status */

function setConn(stateName, text) {
  els.connChip.dataset.state = stateName;
  els.connText.textContent = text;
}

function setNote(text, kind) {
  els.connNote.textContent = text;
  els.connNote.className = 'note' + (kind ? ` ${kind}` : '');
}

/* ────────────────────────────────────────────── connect & load models */

/** Nama tampil provider: pakai label preset bila cocok, kalau tidak pakai hostname. */
function providerLabel(baseUrl) {
  const opt = [...els.preset.options].find((o) => o.value && o.value === baseUrl);
  if (opt) return opt.textContent.trim();
  try {
    return new URL(baseUrl).hostname;
  } catch (_) {
    return baseUrl;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch (_) {
    return url;
  }
}

function providerById(id) {
  return state.providers.find((p) => p.id === id) || null;
}

/** Semua model dari semua provider, masing-masing membawa identitas providernya. */
function allEntries() {
  const out = [];
  for (const provider of state.providers) {
    for (const model of provider.models) {
      out.push({
        key: `${provider.id}::${model.id}`,
        providerId: provider.id,
        providerLabel: provider.label,
        modelId: model.id,
        owner: model.owner,
      });
    }
  }
  return out;
}

/** Buang pilihan yang modelnya sudah tidak ada (mis. provider dihapus). */
function pruneSelection() {
  const alive = new Set(allEntries().map((e) => e.key));
  for (const key of [...state.selected]) {
    if (!alive.has(key)) state.selected.delete(key);
  }
}

function syncConnChip() {
  if (!state.providers.length) {
    setConn('idle', 'Belum terhubung');
    return;
  }
  const models = state.providers.reduce((n, p) => n + p.models.length, 0);
  setConn('live', `${state.providers.length} provider · ${models} model`);
}

async function connect() {
  const baseUrl = els.baseUrl.value.trim();
  const apiKey = els.apiKey.value.trim();

  if (!baseUrl) {
    setNote('API Base URL wajib diisi.', 'error');
    setConn('error', 'URL kosong');
    els.baseUrl.focus();
    return;
  }

  els.btnConnect.disabled = true;
  els.btnConnect.textContent = 'Menghubungi provider…';
  setConn('busy', 'Menghubungi…');
  setNote('Mengirim GET /models ke provider…');

  // Kerangka berkilau selama daftar model dimuat, supaya tidak terlihat kosong.
  els.modelList.innerHTML = '';
  for (let i = 0; i < 4; i += 1) {
    const row = document.createElement('div');
    row.className = 'skel-row';
    els.modelList.appendChild(row);
  }

  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey }),
    });

    const data = await res.json();

    if (!data.ok) {
      const attempts = (data.attempts || [])
        .map((a) => `${a.url} → ${a.error}`)
        .join(' | ');
      setConn('error', data.status ? `Gagal (HTTP ${data.status})` : 'Gagal terhubung');
      setNote(attempts || data.error || 'Provider tidak merespons.', 'error');
      renderModelList();
      toast(`${baseUrl} tidak dapat dihubungi.`, { kind: 'err' });
      return;
    }

    const id = baseUrl;
    const provider = {
      id,
      label: providerLabel(baseUrl),
      baseUrl,
      apiKey,
      resolvedBase: data.resolvedBase || baseUrl,
      models: data.models || [],
    };

    // Provider dengan Base URL sama akan diperbarui, bukan diduplikasi.
    state.providers = state.providers.filter((p) => p.id !== id);
    state.providers.push(provider);
    pruneSelection();

    renderProviders();
    renderModelList();
    updateRunAvailability();
    saveSession();

    setNote(
      `${provider.label} siap — ${provider.models.length} model terdeteksi dalam ${data.latency} ms. ` +
        `Total ${state.providers.length} provider terhubung.`,
      'ok'
    );
    toast(`${provider.label} terhubung · ${provider.models.length} model.`, { kind: 'ok' });
  } catch (err) {
    setConn('error', 'Server tidak merespons');
    setNote(`Gagal memanggil server lokal: ${err.message}`, 'error');
    renderModelList();
  } finally {
    els.btnConnect.disabled = false;
    els.btnConnect.textContent = 'Uji Koneksi & Tambah Provider';
    updateRunAvailability();
  }
}

function renderProviders() {
  els.providersBlock.hidden = state.providers.length === 0;
  els.providerCount.textContent = String(state.providers.length);
  els.providerList.innerHTML = '';

  for (const provider of state.providers) {
    const item = document.createElement('div');
    item.className = 'provider-item';

    const dot = document.createElement('span');
    dot.className = 'provider-dot';

    const text = document.createElement('span');
    text.className = 'provider-text';

    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = provider.label;

    const meta = document.createElement('span');
    meta.className = 'provider-meta';
    meta.textContent = `${provider.models.length} model · ${hostOf(provider.baseUrl)}`;
    meta.title = provider.baseUrl;

    text.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'provider-remove';
    remove.textContent = '×';
    remove.title = `Hapus ${provider.label}`;
    remove.addEventListener('click', () => {
      if (state.running) return;
      state.providers = state.providers.filter((p) => p.id !== provider.id);
      pruneSelection();
      renderProviders();
      renderModelList();
      updateRunAvailability();
      saveSession();
    });

    item.append(dot, text, remove);
    els.providerList.appendChild(item);
  }

  syncConnChip();
}

/* ───────────────────────────── provider yang sedang digunakan (tersimpan) */

const SESSION_KEY = 'frontstellar:providers:v1';

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return saved && Array.isArray(saved.providers) ? saved : null;
  } catch (_) {
    return null;
  }
}

/** Simpan provider yang terhubung + pilihan model agar tetap ada saat halaman dimuat ulang. */
function saveSession() {
  if (!state.providers.length) {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (_) {
      /* localStorage diblokir: penyimpanan dilewati, aplikasi tetap jalan */
    }
    return;
  }

  const payload = {
    at: new Date().toISOString(),
    providers: state.providers.map((p) => ({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      resolvedBase: p.resolvedBase,
      models: p.models,
    })),
    selected: [...state.selected],
  };

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch (_) {
    /* localStorage penuh atau diblokir: provider dilewati, aplikasi tetap jalan */
  }
}

function forgetSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {
    /* abaikan */
  }
  state.providers = [];
  pruneSelection();
  renderProviders();
  renderModelList();
  updateRunAvailability();
  setNote('Provider tersimpan sudah dihapus dari browser ini.', 'ok');
}

/** Pulihkan provider yang terakhir dipakai, lengkap dengan pilihan modelnya. */
function restoreSession() {
  const saved = readSession();
  if (!saved) return;

  state.providers = saved.providers
    .filter((p) => p && p.baseUrl)
    .map((p) => ({
      id: p.id || p.baseUrl,
      label: p.label || providerLabel(p.baseUrl),
      baseUrl: p.baseUrl,
      apiKey: p.apiKey || '',
      resolvedBase: p.resolvedBase || p.baseUrl,
      models: Array.isArray(p.models) ? p.models : [],
    }));

  for (const key of saved.selected || []) state.selected.add(key);
  pruneSelection();

  renderProviders();
  renderModelList();
  updateRunAvailability();

  const models = state.providers.reduce((n, p) => n + p.models.length, 0);
  const last = state.providers[state.providers.length - 1];
  if (last) {
    els.baseUrl.value = last.baseUrl;
    els.apiKey.value = last.apiKey;
  }

  if (models) {
    setNote(
      `${state.providers.length} provider tersimpan dipulihkan (${models} model). ` +
        'Klik "Uji Koneksi" bila ingin menyegarkan daftar model.',
      'ok'
    );
  } else {
    setNote(
      `${state.providers.length} provider tersimpan dipulihkan, tetapi daftar modelnya kosong. ` +
        'Klik "Uji Koneksi" untuk memuat ulang model.',
      'warn'
    );
  }
}

/* ──────────────────────────────────────────────────────── model list */

function visibleEntries() {
  const q = els.modelFilter.value.trim().toLowerCase();
  const entries = allEntries();
  if (!q) return entries;
  return entries.filter(
    (e) => e.modelId.toLowerCase().includes(q) || e.providerLabel.toLowerCase().includes(q)
  );
}

function modelRow(entry) {
  const on = state.selected.has(entry.key);

  const label = document.createElement('label');
  label.className = 'model-item' + (on ? ' on' : '');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  box.addEventListener('change', () => {
    if (box.checked) state.selected.add(entry.key);
    else state.selected.delete(entry.key);
    label.classList.toggle('on', box.checked);
    updateSelectedCount();
    updateRunAvailability();
    saveSession();
  });

  const id = document.createElement('span');
  id.className = 'm-id';
  id.textContent = entry.modelId;
  if (entry.owner) id.title = `owner: ${entry.owner}`;

  label.append(box, id);
  return label;
}

function renderModelList() {
  const list = els.modelList;
  list.innerHTML = '';

  const entries = allEntries();
  els.modelCount.textContent = String(entries.length);

  const hasModels = entries.length > 0;
  els.modelFilter.disabled = !hasModels;
  els.btnSelectAll.disabled = !hasModels;
  els.btnSelectNone.disabled = !hasModels;
  els.btnSelectFast.disabled = !hasModels;

  if (!hasModels) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Hubungkan provider untuk memuat daftar model.';
    list.appendChild(p);
    updateSelectedCount();
    return;
  }

  const visible = visibleEntries();
  if (!visible.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Tidak ada model yang cocok dengan filter.';
    list.appendChild(p);
  }

  const frag = document.createDocumentFragment();
  let currentProvider = null;

  for (const entry of visible) {
    // Header grup muncul setiap kali provider berganti (daftar sudah terurut per provider).
    if (entry.providerId !== currentProvider) {
      currentProvider = entry.providerId;
      const provider = providerById(entry.providerId);
      const head = document.createElement('div');
      head.className = 'model-group-head';
      head.textContent = `${entry.providerLabel} · ${provider ? provider.models.length : 0} model`;
      frag.appendChild(head);
    }
    frag.appendChild(modelRow(entry));
  }

  list.appendChild(frag);
  updateSelectedCount();
}

function updateSelectedCount() {
  const n = state.selected.size;
  els.selectedCount.textContent = `${n} model dipilih`;
  const btn = els.btnRun;
  btn.textContent = n ? `Jalankan uji · ${n} model` : 'Jalankan uji';
  updateModeNote();
}

const MODE_NOTE = {
  parallel:
    'Semua model dijalankan bersamaan — paling cepat, tetapi berisiko kena 429 bila provider membatasi konkurensi.',
  sequential:
    'Satu permintaan aktif pada satu waktu, dengan jeda di antaranya — aman untuk batas konkurensi (konkuren) provider.',
};

/** Batas jumlah permintaan aktif. 0 berarti tanpa batas (semua sekaligus). */
function concurrencyLimit() {
  const raw = Number(els.concurrency.value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(64, Math.floor(raw));
}

function updateModeNote() {
  const sequential = state.mode === 'sequential';
  els.gapField.hidden = !sequential;
  els.concField.hidden = sequential;

  if (sequential) {
    els.modeNote.textContent = MODE_NOTE.sequential;
    els.modeNote.classList.remove('warn');
    return;
  }

  const limit = concurrencyLimit();
  if (limit) {
    els.modeNote.textContent = `Maksimal ${limit} model dijalankan sekaligus — tetap cepat tetapi menjaga batas konkurensi provider.`;
    els.modeNote.classList.remove('warn');
  } else {
    els.modeNote.textContent = MODE_NOTE.parallel;
    els.modeNote.classList.toggle('warn', state.selected.size > 2);
  }
}

function updateRunAvailability() {
  els.btnRun.disabled = state.running || state.selected.size === 0;
}

/* ─────────────────────────────────────────────────────── run benchmark */

function buildPayload(entry) {
  const provider = providerById(entry.providerId);
  return {
    baseUrl: provider.baseUrl,
    resolvedBase: provider.resolvedBase,
    apiKey: provider.apiKey,
    model: entry.modelId,
    prompt: els.prompt.value,
    system: els.system.value,
    temperature: els.temperature.value,
    maxTokens: els.maxTokens.value,
  };
}

function entryByKey(key) {
  return allEntries().find((e) => e.key === key) || null;
}

function createResult(entry) {
  return {
    key: entry.key,
    providerId: entry.providerId,
    modelId: entry.modelId,
    providerLabel: entry.providerLabel,
    model: entry.label, // label unik yang dipakai di seluruh tampilan
    status: 'queued',
    content: '',
    reasoning: '',
    error: null,
    errorStatus: 0,
    retryAfter: null,
    metrics: null,
    samples: [],
    firstTokenAt: null,
    /** Titik awal pengukuran E2E di sisi browser untuk sampel yang sedang berjalan. */
    e2eStart: 0,
    startedAt: 0,
    el: null,
  };
}

function answerNode(result, index) {
  const root = document.createElement('article');
  root.className = 'answer';
  root.style.animationDelay = `${Math.min(index * 35, 350)}ms`;

  const head = document.createElement('div');
  head.className = 'answer-head';

  const name = document.createElement('span');
  name.className = 'answer-name';
  name.textContent = result.model;

  const prov = document.createElement('span');
  prov.className = 'answer-prov';
  prov.textContent = result.providerLabel;
  prov.hidden = !state.multiProvider;

  const metrics = document.createElement('span');
  metrics.className = 'answer-metrics';

  const tag = document.createElement('span');
  tag.className = 'tag queued';
  tag.textContent = 'menunggu';

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'answer-pick';
  pick.textContent = '⇄';
  pick.title = 'Pilih untuk dibandingkan berdampingan (maks. 2)';
  pick.setAttribute('aria-label', `Pilih ${result.model} untuk dibandingkan`);
  pick.addEventListener('click', () => togglePick(result));

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'answer-copy';
  copy.textContent = '⧉';
  copy.title = 'Salin jawaban ke papan klip';
  copy.setAttribute('aria-label', `Salin jawaban ${result.model}`);
  copy.addEventListener('click', () => copyAnswer(result));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'answer-del';
  del.textContent = '×';
  del.title = 'Hapus model ini dari hasil uji';
  del.setAttribute('aria-label', `Hapus ${result.model} dari hasil uji`);
  del.disabled = state.running;
  del.addEventListener('click', () => removeResult(result));

  head.append(name, prov, metrics, tag, pick, copy, del);

  const reason = document.createElement('div');
  reason.className = 'answer-reason';
  reason.hidden = true;

  const body = document.createElement('div');
  body.className = 'answer-body';

  const txt = document.createElement('span');
  const caret = document.createElement('span');
  caret.className = 'caret';
  body.append(txt, caret);

  const errorBox = document.createElement('p');
  errorBox.className = 'answer-error';
  errorBox.hidden = true;

  root.append(head, reason, body, errorBox);

  result.el = { root, metrics, tag, reason, body, txt, caret, errorBox, del, pick };
  paintAnswerMetrics(result);
  return root;
}

function paintAnswerMetrics(result) {
  const el = result.el;
  if (!el) return;

  const m = result.metrics || {};
  const running = result.status === 'running';
  const liveTtft = result.firstTokenAt;
  // E2E hidup: sudah berjalan sejak permintaan dikirim dan berhenti saat jawaban penuh diterima.
  const liveE2e = running && result.e2eStart ? performance.now() - result.e2eStart : null;
  const e2e = liveE2e != null ? liveE2e : m.e2e;

  const items = [
    ['E2E', e2e != null ? fmtMs(e2e) : running ? '…' : '—', 'e2e'],
    ['TTFT', fmtMs(liveTtft == null ? null : liveTtft), 'ttft'],
    ['TOTAL', m.total != null ? fmtMs(m.total) : running ? '…' : '—', 'total'],
    ['TPS', m.tps != null ? fmtDec(m.tps) : '—', 'tps'],
    ['TOKEN', m.tokens != null ? `${m.estimatedTokens ? '~' : ''}${fmtInt(m.tokens)}` : '—', 'tokens'],
  ];

  el.metrics.textContent = '';
  for (const [k, v, metric] of items) {
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'mv';
    vEl.dataset.metric = metric;
    vEl.textContent = v;
    el.metrics.append(kEl, vEl);
  }

  for (const h of el.metrics.querySelectorAll('.mv')) h.classList.remove('hot');

  const mark = (metric, on) => {
    if (!on) return;
    const node = el.metrics.querySelector(`.mv[data-metric="${metric}"]`);
    if (node) node.classList.add('hot');
  };
  mark('e2e', !running && m.e2e != null && isWinner('e2e', result));
  mark('ttft', m.ttft != null && liveTtft != null && isWinner('ttft', result));
  mark('tps', m.tps != null && isWinner('tps', result));
}

function setTag(result, status, label) {
  if (!result.el) return;
  result.el.tag.className = `tag ${status}`;
  result.el.tag.textContent = label;
}

function handleEvent(result, evt) {
  if (evt.type === 'delta') {
    if (evt.reasoning) {
      result.reasoning += evt.reasoning;
      result.el.reason.hidden = false;
      result.el.reason.textContent = result.reasoning;
    }
    if (evt.content) {
      result.content += evt.content;
      result.el.txt.textContent = result.content;
    }
    if (result.firstTokenAt == null) {
      result.firstTokenAt = performance.now() - result.startedAt;
    }
    if (result.status !== 'running') {
      result.status = 'running';
      result.el.root.classList.add('is-running');
      setTag(result, 'running', 'streaming');
    }
  } else if (evt.type === 'error') {
    result.error = evt.message || 'Terjadi kesalahan.';
    result.errorStatus = typeof evt.status === 'number' ? evt.status : 0;
    result.retryAfter = evt.retryAfter || null;
  } else if (evt.type === 'done') {
    result.metrics = evt.metrics || {};
  }
  scheduleFlush();
}

/** Buat hasil + simpul jawaban lebih dulu, supaya model yang belum giliran terlihat "menunggu". */
function prepare(entry, index) {
  const result = createResult(entry);
  state.results.set(entry.key, result);
  els.answers.appendChild(answerNode(result, index));
  setTag(result, 'queued', 'menunggu');
  return result;
}

function repeatCount() {
  const n = Number(els.repeats.value);
  return Number.isFinite(n) && n >= 1 ? Math.min(10, Math.floor(n)) : 1;
}

function retryCount() {
  const n = Number(els.retries.value);
  return Number.isFinite(n) && n >= 0 ? Math.min(5, Math.floor(n)) : 0;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30000, Math.max(0, seconds * 1000));
  const date = Date.parse(value);
  if (Number.isNaN(date)) return 0;
  return Math.min(30000, Math.max(0, date - Date.now()));
}

/** Backoff eksponensial 1s → 8s, tetapi hormati Retry-After bila lebih lama. */
function retryDelay(attempt, retryAfter) {
  return Math.max(Math.min(8000, 1000 * 2 ** attempt), parseRetryAfter(retryAfter));
}

/** Kirim satu permintaan streaming; error provider dicatat di result, bukan dilempar. */
async function streamOnce(result, controller) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPayload(result)),
    signal: controller.signal,
  });

  if (!res.ok || !res.body) throw new Error(`Server lokal membalas HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        handleEvent(result, JSON.parse(line.slice(5).trim()));
      } catch (_) {
        /* abaikan frame rusak */
      }
    }
  }
}

async function runOne(result) {
  const repeats = repeatCount();
  const retries = retryCount();

  const controller = new AbortController();
  state.controllers.add(controller);

  result.status = 'running';
  setTag(result, 'running', 'menghubungi');

  try {
    for (let sample = 0; sample < repeats && !state.cancelled; sample += 1) {
      if (sample > 0) {
        // Bersihkan tampilan sebelum pengulangan berikutnya.
        result.content = '';
        result.reasoning = '';
        result.firstTokenAt = null;
        result.el.txt.textContent = '';
        result.el.reason.textContent = '';
        result.el.reason.hidden = true;
      }

      const base = repeats > 1 ? `ulang ${sample + 1}/${repeats}` : 'menghubungi';

      // E2E diukur di browser: sejak permintaan dikirim hingga jawaban penuh diterima.
      result.e2eStart = performance.now();

      for (let attempt = 0; ; attempt += 1) {
        if (state.cancelled) break;

        result.error = null;
        result.errorStatus = 0;
        result.retryAfter = null;
        result.metrics = null;
        result.startedAt = performance.now();

        setTag(result, 'running', attempt === 0 ? base : `${base} · coba ${attempt + 1}`);

        let thrown = null;
        try {
          await streamOnce(result, controller);
        } catch (err) {
          thrown = err;
        }

        if (state.cancelled) break;

        // Hanya 429 tanpa konten yang diulang — permintaan itu belum memakai kuota provider.
        if (result.errorStatus === 429 && !result.content && attempt < retries) {
          const wait = retryDelay(attempt, result.retryAfter);
          setTag(result, 'running', `429 · tunggu ${(wait / 1000).toFixed(1)}s`);
          await waitGap(wait);
          continue;
        }

        if (thrown && !result.error) {
          result.error =
            thrown.name === 'AbortError'
              ? 'Dibatalkan oleh pengguna.'
              : thrown.message || String(thrown);
        }

        if (!result.error && result.metrics && !result.metrics.failed) {
          result.samples.push(sampleOf(result.metrics, performance.now() - result.e2eStart));
        }
        break;
      }

      // Berhenti mengulang bila sampel ini gagal atau dibatalkan.
      if (state.cancelled || result.error || !result.metrics || result.metrics.failed) break;
      if (sample < repeats - 1) await waitGap(150);
    }
  } finally {
    state.controllers.delete(controller);

    if (!result.metrics) result.metrics = { total: performance.now() - result.startedAt };

    const failed = Boolean(result.error) || Boolean(result.metrics.failed);

    // Saat gagal, E2E tetap dicatat: itu justru waktu nyata yang dialami pengguna (termasuk tunggu retry).
    if (failed && result.e2eStart && result.metrics.e2e == null) {
      result.metrics.e2e = performance.now() - result.e2eStart;
    }

    if (!failed && result.samples.length) {
      result.metrics = aggregateSamples(result.samples);
      result.firstTokenAt = result.metrics.ttft;
    } else if (result.metrics.ttft != null) {
      result.firstTokenAt = result.metrics.ttft;
    }

    result.el.caret.remove();
    result.el.root.classList.remove('is-running');
    result.status = failed ? 'error' : 'done';
    result.el.root.classList.toggle('is-error', failed);

    if (failed) {
      setTag(result, 'error', 'gagal');
      result.el.errorBox.hidden = false;
      result.el.errorBox.textContent = result.error || 'Provider mengembalikan kesalahan.';
      if (!result.content) result.el.body.hidden = true;
    } else {
      const n = result.metrics.n > 1 ? ` · ${result.metrics.n}×` : '';
      setTag(result, 'done', `${fmtDec(result.metrics.tps)} tok/s${n}`);
    }

    paintAnswerMetrics(result);
    state.done += 1;
    updateProgress();
    scheduleFlush();
  }
}

function sampleOf(m, e2e) {
  return {
    /** Latensi end-to-end dari sisi pengguna (browser), termasuk waktu tunggu retry. */
    e2e: e2e == null ? null : e2e,
    ttft: m.ttft == null ? null : m.ttft,
    total: m.total,
    tokens: m.tokens,
    tps: m.tps,
    chars: m.chars,
    reasoningChars: m.reasoningChars || 0,
    estimatedTokens: Boolean(m.estimatedTokens),
  };
}

const median = (values) => {
  const nums = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
};

/** Statistik satu metrik lintas sampel: median, p95, simpangan baku, dan rentang. */
function metricStats(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;

  const at = (q) => {
    if (nums.length === 1) return nums[0];
    const pos = (nums.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return nums[lo] + (nums[hi] - nums[lo]) * (pos - lo);
  };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;

  return {
    n: nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
    p50: at(0.5),
    p95: at(0.95),
    sd: Math.sqrt(variance),
  };
}

/** Metrik representatif = median lintas sampel; sebaran min–max disimpan untuk tooltip. */
function aggregateSamples(samples) {
  const pick = (key) => median(samples.map((s) => s[key]));
  const spread = (key) => {
    const nums = samples.map((s) => s[key]).filter((v) => v != null && Number.isFinite(v));
    return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
  };
  const stat = (key) => metricStats(samples.map((s) => s[key]));

  return {
    e2e: pick('e2e'),
    ttft: pick('ttft'),
    total: pick('total'),
    tokens: pick('tokens'),
    tps: pick('tps'),
    chars: pick('chars'),
    reasoningChars: pick('reasoningChars'),
    estimatedTokens: samples.some((s) => s.estimatedTokens),
    n: samples.length,
    spread: {
      e2e: spread('e2e'),
      ttft: spread('ttft'),
      total: spread('total'),
      tps: spread('tps'),
    },
    /** p95 & simpangan baku per metrik — dipakai tabel, ekspor, dan laporan HTML. */
    stats: {
      e2e: stat('e2e'),
      ttft: stat('ttft'),
      total: stat('total'),
      tps: stat('tps'),
    },
  };
}

function updateProgress() {
  if (!state.running) return;
  // Mode berurutan mengelola teksnya sendiri di dalam loop (menampilkan model yang sedang diuji).
  if (state.mode === 'parallel') {
    const limit = concurrencyLimit();
    els.runHint.textContent = limit
      ? `Maks. ${limit} sekaligus · ${state.done}/${state.targets.length} model selesai…`
      : `Menjalankan ${state.done}/${state.targets.length} model…`;
    els.runHint.className = 'run-hint active';
  }
}

function setHint(text, kind) {
  els.runHint.textContent = text;
  els.runHint.className = 'run-hint' + (kind ? ` ${kind}` : '');
}

/** Jalankan model dengan batas jumlah permintaan aktif (worker pool). */
async function runPool(items, limit) {
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      if (state.cancelled) return;
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await runOne(items[index]);
    }
  };
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: size }, worker));
}

/** Jeda yang bisa dipotong saat dibatalkan. */
async function waitGap(ms) {
  const step = 100;
  let waited = 0;
  while (waited < ms && !state.cancelled) {
    const slice = Math.min(step, ms - waited);
    await new Promise((resolve) => setTimeout(resolve, slice));
    waited += slice;
  }
}

/** Jalankan sekumpulan hasil memakai mode & batas konkurensi yang dipilih (dipakai uji penuh & ulang gagal). */
async function runBatch(items) {
  if (state.mode === 'sequential') {
    // Satu permintaan aktif pada satu waktu + jeda opsional, agar tidak menabrak batas konkurensi provider.
    const gap = Math.max(0, Math.min(60000, Number(els.gapMs.value) || 0));
    for (let i = 0; i < items.length; i += 1) {
      if (state.cancelled) break;
      setHint(`Berurutan ${i + 1}/${items.length} · ${items[i].model}`, 'active');
      await runOne(items[i]);
      if (state.cancelled || i === items.length - 1) break;
      if (gap > 0) {
        setHint(`Jeda ${gap} ms sebelum model berikutnya…`, 'active');
        await waitGap(gap);
      }
    }
    return;
  }

  // Batasi berapa model berjalan sekaligus agar cepat, tetapi tetap di bawah batas konkurensi provider.
  const limit = concurrencyLimit();
  if (limit && limit < items.length) await runPool(items, limit);
  else await Promise.all(items.map((result) => runOne(result)));
}

async function runAll() {
  const entries = [...state.selected].map(entryByKey).filter(Boolean);
  if (!entries.length || state.running) return;

  // Bila model bernama sama muncul di beberapa provider, tambahkan nama provider agar label unik.
  const counts = new Map();
  for (const entry of entries) counts.set(entry.modelId, (counts.get(entry.modelId) || 0) + 1);
  for (const entry of entries) {
    entry.label =
      counts.get(entry.modelId) > 1 ? `${entry.providerLabel} · ${entry.modelId}` : entry.modelId;
  }

  state.multiProvider =
    state.providers.length > 1 || new Set(entries.map((e) => e.providerLabel)).size > 1;

  state.running = true;
  state.cancelled = false;
  state.done = 0;
  state.targets = entries;
  state.results.clear();
  state.controllers.clear();

  // Pembanding: entri riwayat terakhir masih milik uji sebelumnya karena uji ini belum disimpan.
  state.baseline = baselineFrom(readHistory()[0]);

  els.answers.innerHTML = '';
  els.metricsBody.innerHTML = '';
  els.ranking.innerHTML = '';
  els.rankingPanel.hidden = true;
  els.chartPanel.hidden = true;
  els.tablePanel.hidden = true;
  els.answersPanel.hidden = false;
  chartSig = '';
  state.picked.clear();
  applyCompare();

  const prepared = entries.map((entry, i) => prepare(entry, i));

  startRace();
  els.btnRun.disabled = true;
  els.btnCancel.hidden = false;
  els.topProgress.hidden = false;
  updateProgress();

  await runBatch(prepared);

  state.running = false;
  els.btnCancel.hidden = true;
  els.btnRun.disabled = false;
  els.topProgress.hidden = true;

  for (const result of prepared) {
    if (result.status === 'queued') {
      result.status = 'skipped';
      setTag(result, 'queued', 'dilewati');
    }
  }

  const ok = prepared.filter((r) => r.status === 'done').length;
  const failed = prepared.filter((r) => r.status === 'error').length;

  if (state.cancelled) {
    setHint(`Dibatalkan · ${ok} dari ${prepared.length} model selesai.`, ok ? '' : 'error');
    toast(`Uji dibatalkan · ${ok} dari ${prepared.length} model selesai.`, { kind: ok ? 'ok' : 'err' });
  } else {
    setHint(`Selesai · ${ok} berhasil${failed ? `, ${failed} gagal` : ''}.`, ok ? '' : 'error');
    toast(`Uji selesai · ${ok} berhasil${failed ? `, ${failed} gagal` : ''}.`, {
      kind: failed ? 'err' : 'ok',
    });
  }

  flush();
  saveHistory();
}

function cancelAll() {
  state.cancelled = true;
  for (const controller of state.controllers) controller.abort();
}

/* ──────────────────────────── pilih, salin & bandingkan dua jawaban */

/** Tandai / lepaskan satu kartu jawaban untuk dibandingkan (maks. 2 sekaligus). */
function togglePick(result) {
  if (state.running) return;
  if (state.picked.has(result.key)) {
    state.picked.delete(result.key);
  } else {
    if (state.picked.size >= 2) state.picked.delete(state.picked.values().next().value);
    state.picked.add(result.key);
  }
  applyCompare();
}

/** Sorotan pilihan selalu mengikuti hasil yang masih ada. */
function prunePicks() {
  for (const key of [...state.picked]) {
    if (!state.results.has(key)) state.picked.delete(key);
  }
}

const COMPARE_FIELDS = [
  ['ttft', 'TTFT', (v) => fmtMs(v)],
  ['tps', 'TPS', (v) => `${fmtDec(v)} tok/s`],
  ['total', 'Total', (v) => fmtMs(v)],
  ['e2e', 'E2E', (v) => fmtMs(v)],
];

function compareLine(keys) {
  const [a, b] = keys.map((key) => state.results.get(key)).filter(Boolean);
  if (!a || !b) return '';
  const parts = COMPARE_FIELDS.map(([metric, label, fmt]) => {
    const av = a.metrics ? a.metrics[metric] : null;
    const bv = b.metrics ? b.metrics[metric] : null;
    if (av == null && bv == null) return null;
    return `${label} ${fmt(av)} lawan ${fmt(bv)}`;
  }).filter(Boolean);

  return (
    `<b>${htmlEscape(a.model)}</b> ⇄ <b>${htmlEscape(b.model)}</b>` +
    (parts.length ? ` · ${htmlEscape(parts.join(' · '))}` : '')
  );
}

/** Tampilkan hanya dua kartu terpilih beserta ringkasan selisihnya. */
function applyCompare() {
  prunePicks();
  const keys = [...state.picked];
  const on = keys.length === 2;

  for (const result of state.results.values()) {
    const chosen = state.picked.has(result.key);
    if (result.el && result.el.pick) result.el.pick.classList.toggle('on', chosen);
    if (result.el && result.el.root) result.el.root.classList.toggle('cmp', on && chosen);
  }

  els.compareBar.hidden = !on;
  if (!on) {
    delete els.answers.dataset.compare;
    els.compareBar.innerHTML = '';
    return;
  }

  els.answers.dataset.compare = 'on';
  els.compareBar.innerHTML = '';

  const text = document.createElement('span');
  text.className = 'grow';
  text.innerHTML = compareLine(keys);
  els.compareBar.appendChild(text);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'ghost-btn';
  clear.textContent = 'Bersihkan';
  clear.addEventListener('click', () => {
    state.picked.clear();
    applyCompare();
  });
  els.compareBar.appendChild(clear);
}

async function copyAnswer(result) {
  if (!result.content) {
    toast('Jawaban masih kosong.', { kind: 'err' });
    return;
  }
  try {
    await navigator.clipboard.writeText(result.content);
    toast(`Jawaban ${result.model} disalin.`, { kind: 'ok', life: 1800 });
  } catch (_) {
    toast('Papan klip tidak dapat diakses browser ini.', { kind: 'err' });
  }
}

/* ─────────────────────────────────────────── balapan uji langsung */

let raceRows = [];

function raceMeter(result, now) {
  const live = result.status === 'running';
  const m = result.metrics || {};

  if (result.status === 'queued') return { ttft: '—', tps: '—', tokens: '—', mode: 'waiting' };
  if (result.status === 'error') return { ttft: '—', tps: '—', tokens: '—', mode: 'failed' };
  if (!live) {
    return {
      ttft: fmtMs(m.ttft),
      tps: fmtDec(m.tps),
      tokens: m.tokens == null ? '—' : fmtInt(m.tokens),
      mode: 'ready',
    };
  }

  const ttft = result.firstTokenAt != null ? result.firstTokenAt : now - result.startedAt;
  const chars = result.content.length;
  const since = result.firstTokenAt != null ? now - result.startedAt - result.firstTokenAt : 0;
  const tps = since > 0 ? chars / 4 / (since / 1000) : null;
  return {
    ttft: fmtMs(ttft),
    tps: tps == null ? '…' : fmtDec(tps),
    tokens: chars ? `~${fmtInt(chars / 4)}` : '—',
    mode: 'live',
    chars,
  };
}

/** Baris balapan dibuat sekali di awal uji; metriknya diperbarui tiap flush. */
function startRace() {
  els.raceList.innerHTML = '';
  els.racePanel.hidden = false;
  els.raceCount.textContent = `${state.targets.length} model`;
  els.raceNote.textContent = state.mode === 'sequential' ? 'berurutan' : 'paralel';
  raceRows = [];

  state.targets.forEach((result, i) => {
    const row = document.createElement('div');
    row.className = 'race-row';
    row.style.animationDelay = `${Math.min(i * 40, 320)}ms`;

    const name = document.createElement('span');
    name.className = 'race-name';
    name.textContent = result.model;

    const mkStat = (label, extra) => {
      const node = document.createElement('span');
      node.className = 'race-stat' + (extra ? ` ${extra}` : '');
      node.innerHTML = `${label} <b>—</b>`;
      node.dataset.label = label;
      return node;
    };
    const ttft = mkStat('TTFT');
    const tps = mkStat('TOK/S');
    const tokens = mkStat('TOKEN', 'tokens');

    const track = document.createElement('span');
    track.className = 'race-track';
    const fill = document.createElement('i');
    fill.className = 'race-fill waiting';
    track.appendChild(fill);

    const spark = document.createElement('span');
    spark.className = 'race-spark';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 24');
    svg.setAttribute('preserveAspectRatio', 'none');
    const poly = document.createElementNS(NS, 'polyline');
    poly.setAttribute('fill', 'none');
    poly.style.stroke = 'var(--info)';
    poly.style.strokeWidth = '1.5';
    poly.style.strokeLinejoin = 'round';
    svg.appendChild(poly);
    spark.appendChild(svg);

    row.append(name, ttft, tps, tokens, track, spark);
    els.raceList.appendChild(row);

    raceRows.push({ result, row, ttft, tps, tokens, fill, poly, series: [], lastAt: 0 });
  });
}

const setStat = (node, value) => {
  const bold = node.querySelector('b');
  if (bold) bold.textContent = value;
};

function renderRace() {
  if (els.racePanel.hidden) return;
  const now = performance.now();
  let doneCount = 0;
  let failCount = 0;
  let liveCount = 0;

  for (const entry of raceRows) {
    const { result } = entry;
    if (result.status === 'done') doneCount += 1;
    else if (result.status === 'error') failCount += 1;
    else if (result.status === 'running') liveCount += 1;

    const meter = raceMeter(result, now);
    setStat(entry.ttft, meter.ttft);
    setStat(entry.tps, meter.tps);
    setStat(entry.tokens, meter.tokens);

    entry.row.classList.toggle('is-error', result.status === 'error');
    entry.row.classList.toggle('is-done', result.status === 'done');

    if (meter.mode === 'waiting') {
      entry.fill.className = 'race-fill waiting';
    } else if (meter.mode === 'ready') {
      entry.fill.className = 'race-fill ready';
    } else if (meter.mode === 'failed') {
      entry.fill.className = 'race-fill failed';
    } else {
      entry.fill.className = 'race-fill';
      const cap = Math.max(120, Number(els.maxTokens.value) || 320);
      const pct = Math.min(100, ((meter.chars || 0) / 4 / cap) * 100);
      entry.fill.style.width = `${pct}%`;
    }

    // Denyut kecepatan dicatat tiap ~400 ms agar garisnya terbaca.
    if (result.status === 'running' && meter.tps !== '…' && now - entry.lastAt > 400) {
      entry.lastAt = now;
      entry.series.push(Number(meter.tps) || 0);
      if (entry.series.length > 60) entry.series.shift();
      const max = Math.max(...entry.series, 1);
      entry.poly.setAttribute(
        'points',
        entry.series
          .map((v, i) => `${(i / Math.max(1, entry.series.length - 1)) * 118 + 1},${22 - (v / max) * 20}`)
          .join(' ')
      );
    }
  }

  const total = raceRows.length;
  els.raceDone.textContent = `${doneCount + failCount}/${total}`;
  els.raceRing.style.strokeDashoffset = String(RING_LEN * (1 - (total ? (doneCount + failCount) / total : 0)));
  els.raceNote.textContent = state.running
    ? `${doneCount} selesai · ${liveCount} berjalan${failCount ? ` · ${failCount} gagal` : ''}`
    : `selesai · ${doneCount} berhasil${failCount ? `, ${failCount} gagal` : ''}`;
}

/* ──────────────────────────────── hapus hasil & ulang model yang gagal */

/**
 * Buang satu model dari hasil uji (kartu jawaban, tabel, peringkat, dan diagram
 * ikut diperbarui). Tersedia tombol "Urungkan" selama notifikasinya masih tampil.
 */
function removeResult(result) {
  if (state.running || !state.results.has(result.key)) return;

  const order = [...state.results.keys()];
  const index = order.indexOf(result.key);
  state.results.delete(result.key);
  if (result.el && result.el.root) result.el.root.remove();
  state.picked.delete(result.key);
  applyCompare();
  chartSig = '';
  flush();

  toast(`${result.model} dihapus dari hasil.`, {
    action: 'Urungkan',
    onAction: () => {
      const list = [...state.results.values()];
      list.splice(Math.min(index, list.length), 0, result);
      state.results = new Map(list.map((r) => [r.key, r]));
      if (result.el && result.el.root) els.answers.appendChild(result.el.root);
      chartSig = '';
      flush();
      toast(`${result.model} dikembalikan.`, { kind: 'ok', life: 1800 });
    },
  });
}

/** Hasil gagal yang providernya masih terhubung, jadi masih bisa diulang. */
const retryableFailed = () =>
  [...state.results.values()].filter((r) => r.status === 'error' && providerById(r.providerId));

/** Tombol "ulang yang gagal" hanya muncul saat ada model gagal yang bisa diulang dan uji tidak berjalan. */
function updateRetryButton() {
  const n = state.running ? 0 : retryableFailed().length;
  els.btnRetryFailed.hidden = n === 0;
  if (n) els.btnRetryFailed.textContent = `Ulang yang gagal · ${n}`;
}

/** Kosongkan satu hasil lalu bangun ulang kartunya agar siap diuji lagi dari awal. */
function resetResult(result, index) {
  if (result.el && result.el.root) result.el.root.remove();
  result.status = 'queued';
  result.content = '';
  result.reasoning = '';
  result.error = null;
  result.errorStatus = 0;
  result.retryAfter = null;
  result.metrics = null;
  result.samples = [];
  result.firstTokenAt = null;
  result.e2eStart = 0;
  result.startedAt = 0;
  els.answers.appendChild(answerNode(result, index));
}

async function retryFailed() {
  if (state.running) return;

  const failed = retryableFailed();
  if (!failed.length) return;

  state.running = true;
  state.cancelled = false;
  state.done = 0;
  state.targets = failed;

  failed.forEach((result, i) => resetResult(result, i));
  applyCompare();

  startRace();
  els.btnRun.disabled = true;
  els.btnCancel.hidden = false;
  els.topProgress.hidden = false;
  updateRetryButton();
  updateProgress();
  setHint(`Mengulang ${failed.length} model yang gagal…`, 'active');

  await runBatch(failed);

  state.running = false;
  els.btnCancel.hidden = true;
  els.btnRun.disabled = false;
  els.topProgress.hidden = true;

  for (const result of failed) {
    if (result.status === 'queued') {
      result.status = 'skipped';
      setTag(result, 'queued', 'dilewati');
    }
  }

  const ok = failed.filter((r) => r.status === 'done').length;
  const still = failed.length - ok;
  setHint(
    `Ulang selesai · ${ok} berhasil${still ? `, ${still} masih gagal` : ''}.`,
    ok ? '' : 'error'
  );
  toast(`Ulang selesai · ${ok} berhasil${still ? `, ${still} masih gagal` : ''}.`, {
    kind: still ? 'err' : 'ok',
  });

  flush();
  saveHistory();
}

/* ──────────────────────────────────────────────────────── aggregation */

const finished = () =>
  [...state.results.values()].filter((r) => r.status === 'done' && r.metrics);

function best(key, dir) {
  const rows = finished().filter((r) => r.metrics[key] != null && !r.metrics.failed);
  if (!rows.length) return null;
  return rows.reduce((acc, r) =>
    dir === 'min' ? (r.metrics[key] < acc.metrics[key] ? r : acc) : r.metrics[key] > acc.metrics[key] ? r : acc
  );
}

const leaders = { total: null, tps: null, ttft: null, e2e: null };

function computeLeaders() {
  const total = best('total', 'min');
  const tps = best('tps', 'max');
  const ttft = best('ttft', 'min');
  const e2e = best('e2e', 'min');
  leaders.total = total ? total.model : null;
  leaders.tps = tps ? tps.model : null;
  leaders.ttft = ttft ? ttft.model : null;
  leaders.e2e = e2e ? e2e.model : null;
  return { total, tps, ttft, e2e };
}

function isWinner(key, result) {
  return leaders[key] === result.model;
}

function scheduleFlush() {
  if (flushQueued) return;
  flushQueued = true;
  requestAnimationFrame(() => {
    flushQueued = false;
    flush();
  });
}

function flush() {
  const { total, tps, ttft, e2e } = computeLeaders();

  els.rankingPanel.hidden = !(total || tps || ttft || e2e);
  if (!els.rankingPanel.hidden) {
    els.rankingCount.textContent = `${finished().length}/${state.results.size} selesai`;
    renderRanking({ total, tps, ttft, e2e });
  }

  els.tablePanel.hidden = state.results.size === 0;
  if (els.tablePanel.hidden) els.metricsBody.innerHTML = '';
  else {
    renderStatStrip();
    renderTable();
  }

  els.answersPanel.hidden = state.results.size === 0;

  for (const result of state.results.values()) {
    paintAnswerMetrics(result);
    if (result.el && result.el.del) result.el.del.disabled = state.running;
  }

  // Balapan live ikut menghilang saat hasil dikosongkan seluruhnya.
  if (state.results.size === 0) {
    els.racePanel.hidden = true;
    raceRows = [];
  } else {
    renderRace();
  }

  updateRetryButton();
  renderCharts();
}

/* ──────────────────────────────────────────── statistik ringkas hasil */

/** Kategori pesan kegagalan untuk rincian error. */
function errorKind(result) {
  if (result.errorStatus) return `HTTP ${result.errorStatus}`;
  const message = (result.error || '').toLowerCase();
  if (message.includes('dibatalkan')) return 'Dibatalkan pengguna';
  if (message.includes('timeout') || message.includes('abort')) return 'Waktu habis';
  if (message.includes('json') || message.includes('parse')) return 'Format respons';
  return 'Kesalahan lain';
}

/** Ubah entri riwayat menjadi peta metrik kunci per model, untuk pembanding. */
function baselineFrom(entry) {
  const map = new Map();
  for (const row of (entry && entry.rows) || []) {
    if (row.status !== 'done' || row.total_ms == null) continue;
    map.set(row.model, { total: row.total_ms, tps: row.tps, ttft: row.ttft_ms, e2e: row.e2e_ms });
  }
  return map;
}

/** Selisih total durasi terhadap uji sebelumnya; `up` berarti lebih cepat. */
function deltaOf(result) {
  const base = state.baseline.get(result.model);
  const m = result.metrics;
  if (!base || !m || m.total == null || !(base.total > 0)) return null;
  const pct = ((m.total - base.total) / base.total) * 100;
  return Math.abs(pct) < 1 ? { pct, dir: 'same' } : { pct, dir: pct > 0 ? 'down' : 'up' };
}

/** Tingkat keberhasilan, rincian jenis error, dan perubahan performa vs uji sebelumnya. */
function renderStatStrip() {
  const results = [...state.results.values()];
  if (!results.length) {
    els.statStrip.hidden = true;
    els.statStrip.innerHTML = '';
    return;
  }

  const done = results.filter((r) => r.status === 'done');
  const failed = results.filter((r) => r.status === 'error');
  const pct = Math.round((done.length / results.length) * 100);

  els.statStrip.hidden = false;
  els.statStrip.innerHTML = '';

  const rate = document.createElement('span');
  rate.className = 'stat-rate';
  rate.innerHTML = `<b>${pct}%</b> berhasil <span class="stat-sub">${done.length}/${results.length} model</span>`;

  const bar = document.createElement('span');
  bar.className = 'stat-bar';
  const fill = document.createElement('i');
  fill.style.width = `${pct}%`;
  if (pct < 100) fill.className = 'partial';
  bar.appendChild(fill);
  rate.appendChild(bar);
  els.statStrip.appendChild(rate);

  const kinds = new Map();
  for (const result of failed) {
    const kind = errorKind(result);
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
  }
  for (const [kind, count] of kinds) {
    const chip = document.createElement('span');
    chip.className = 'stat-chip err';
    chip.innerHTML = `${htmlEscape(kind)} <b>×${count}</b>`;
    els.statStrip.appendChild(chip);
  }

  let faster = 0;
  let slower = 0;
  for (const result of done) {
    const delta = deltaOf(result);
    if (!delta || delta.dir === 'same') continue;
    if (delta.dir === 'up') faster += 1;
    else slower += 1;
  }
  if (faster || slower) {
    const chip = document.createElement('span');
    chip.className = 'stat-chip ' + (slower ? 'down' : 'up');
    chip.innerHTML =
      `vs uji sebelumnya: <b>${faster}</b> lebih cepat` + (slower ? ` · <b>${slower}</b> lebih lambat` : '');
    els.statStrip.appendChild(chip);
  }
}

/* ─────────────────────────────────────────────────────────── diagram */

/** Deret nilai mentah tiap metrik dari sampel berulang (untuk diagram sebaran & tooltip). */
function sampleSeries(result) {
  const series = { tps: [], ttft: [], total: [], e2e: [] };
  for (const sample of result.samples || []) {
    for (const key in series) {
      if (sample[key] != null && Number.isFinite(sample[key])) series[key].push(sample[key]);
    }
  }
  return series;
}

function chartRows() {
  return finished()
    .filter((r) => !r.metrics.failed && r.metrics.total != null)
    .map((r) => ({
      model: r.model,
      ttft: r.metrics.ttft == null ? null : r.metrics.ttft,
      total: r.metrics.total,
      tps: r.metrics.tps || 0,
      tokens: r.metrics.tokens || 0,
      estimated: Boolean(r.metrics.estimatedTokens),
      samples: sampleSeries(r),
    }));
}

/** Metrik yang sedang dipilih pada diagram sebaran antar-ulangan. */
function boxMetric() {
  const active = els.boxMetric && els.boxMetric.querySelector('button.active');
  return active ? active.dataset.metric : 'tps';
}

function renderCharts() {
  const rows = chartRows();

  els.chartPanel.hidden = rows.length === 0;
  if (!rows.length) {
    chartSig = '';
    return;
  }

  // Diagram sebaran hanya berguna bila ada model yang diuji lebih dari sekali.
  const hasRepeats = rows.some(
    (r) => (r.samples.tps || []).length > 1 || (r.samples.ttft || []).length > 1
  );
  els.boxFigure.hidden = !hasRepeats;

  // SVG digambar ulang hanya saat komposisi hasil berubah atau ukuran berubah.
  const sig = rows
    .map((r) => `${r.model}|${r.total}|${r.ttft}|${r.tps}|${(r.samples.tps || []).join(',')}`)
    .join(';');
  if (sig === chartSig) return;
  chartSig = sig;

  els.chartCount.textContent = `${rows.length} model dianalisis`;
  window.ModelCharts.renderTimeline(els.chartTimeline, rows);
  window.ModelCharts.renderTps(els.chartTps, rows);
  window.ModelCharts.renderScatter(els.chartScatter, rows);
  if (hasRepeats) window.ModelCharts.renderBoxplot(els.chartBox, rows, boxMetric());
}

/* Kartu peringkat dipakai ulang antar-render supaya angka & nama bisa dianimasikan
   alih-alih dibangun ulang setiap kali hasil berubah. */
let rankCards = [];

function ensureRankCards() {
  if (rankCards.length === 4 && rankCards[0].div.isConnected) return rankCards;

  els.ranking.innerHTML = '';
  rankCards = Array.from({ length: 4 }, (_, i) => {
    const div = document.createElement('div');
    div.className = 'rank empty';
    div.style.animationDelay = `${i * 60}ms`;

    const label = document.createElement('span');
    label.className = 'rank-label';

    const name = document.createElement('span');
    name.className = 'rank-model';

    const value = document.createElement('span');
    value.className = 'rank-value';

    const sub = document.createElement('span');
    sub.className = 'rank-sub';

    div.append(label, name, value, sub);
    div.addEventListener('click', () => {
      const model = div.dataset.model;
      if (!model) return;
      const pinned = window.ModelCharts.pinModel(model);
      if (pinned) toast(`Menyorot ${model} di semua diagram.`, { life: 2000 });
    });

    els.ranking.appendChild(div);
    return { div, label, name, value, sub, prev: null };
  });
  return rankCards;
}

/** Tandai kartu peringkat yang modelnya sedang disematkan di seluruh diagram. */
function syncRankPins(model) {
  for (const card of rankCards) {
    card.div.classList.toggle('pin', Boolean(model) && card.div.dataset.model === model);
  }
}

function renderRanking({ total, tps, ttft, e2e }) {
  const rows = [
    {
      label: 'E2E tercepat',
      result: e2e,
      num: e2e ? e2e.metrics.e2e : null,
      fmt: fmtMs,
      sub: e2e ? 'dari prompt dikirim hingga jawaban utuh diterima' : 'belum ada data',
    },
    {
      label: 'Total tercepat',
      result: total,
      num: total ? total.metrics.total : null,
      fmt: fmtMs,
      sub: total ? `selesai paling cepat dari ${finished().length} model` : 'belum ada data',
    },
    {
      label: 'TPS tertinggi',
      result: tps,
      num: tps ? tps.metrics.tps : null,
      fmt: (v) => `${fmtDec(v)} tok/s`,
      sub: tps
        ? `${fmtInt(tps.metrics.tokens)}${tps.metrics.estimatedTokens ? '~' : ''} token dihasilkan`
        : 'belum ada data',
    },
    {
      label: 'TTFT tercepat',
      result: ttft,
      num: ttft ? ttft.metrics.ttft : null,
      fmt: fmtMs,
      sub: ttft ? 'respons token pertama paling responsif' : 'belum ada data',
    },
  ];

  const cards = ensureRankCards();
  rows.forEach((row, i) => {
    const card = cards[i];
    const model = row.result ? row.result.model : '';
    const changed = card.div.dataset.model !== model;

    card.div.classList.toggle('empty', !row.result);
    card.div.dataset.model = model;
    card.label.textContent = row.label;
    card.name.textContent = model || '—';
    card.sub.textContent = row.sub;
    countUp(card.value, row.num, row.fmt, card.prev);
    card.prev = row.num;

    if (changed && model && !motionOff()) {
      card.div.animate(
        [
          { opacity: 0.4, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' }
      );
    }
  });

  syncRankPins(pinnedModel);
}

function sortValue(result, key) {
  const m = result.metrics || {};
  if (key === 'model') return result.model.toLowerCase();
  if (key === 'status') return result.status;
  if (m.failed) return null;
  return m[key] == null ? null : m[key];
}

/** Posisi baris tabel sebelum urutan diubah, untuk animasi tukar posisi (FLIP). */
function captureRowTops() {
  const tops = new Map();
  if (motionOff()) return tops;
  for (const tr of els.metricsBody.children) {
    if (tr.dataset.key) tops.set(tr.dataset.key, tr.getBoundingClientRect().top);
  }
  return tops;
}

/** Geser tiap baris dari posisi lamanya ke posisi barunya dengan transisi CSS. */
function playRowFlip(tops) {
  if (!tops.size || motionOff()) return;
  for (const tr of els.metricsBody.children) {
    const before = tops.get(tr.dataset.key);
    if (before == null) continue;
    const delta = before - tr.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;

    tr.classList.add('flip');
    tr.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      tr.style.transform = '';
    });
    setTimeout(() => {
      tr.classList.remove('flip');
      tr.style.transform = '';
    }, 420);
  }
}

function renderTable() {
  const { key, dir } = state.sort;
  const rows = [...state.results.values()].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    // Baris tanpa nilai selalu diletakkan di bawah, apa pun arah pengurutannya.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' || typeof bv === 'string') {
      const cmp = String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    }
    return dir === 'asc' ? av - bv : bv - av;
  });

  els.tableHead.forEach((th) => {
    const active = th.dataset.key === key;
    th.dataset.active = String(active);
    if (active) th.dataset.dir = dir;
    else delete th.dataset.dir;
  });

  els.metricsBody.innerHTML = '';
  for (const result of rows) {
    const m = result.metrics || {};
    const tr = document.createElement('tr');
    tr.className = result.status === 'error' ? 'is-error' : '';
    tr.dataset.key = result.key;

    const multiProvider = state.multiProvider;
    const n = m.n > 1 ? ` · ${m.n}×` : '';
    const stats = m.stats || {};

    const cells = [
      { text: result.model, cls: 'model', provider: multiProvider ? result.providerLabel : '', delta: deltaOf(result) },
      {
        text: `${m.ttft == null ? '—' : fmtMs(m.ttft)}${n}`,
        cls: `num${isWinner('ttft', result) && m.ttft != null ? ' win' : ''}`,
        tip: cellTip(
          spreadTip('TTFT', m.spread && m.spread.ttft, fmtMs),
          statsTip('TTFT', stats.ttft, fmtMs)
        ),
      },
      {
        text: `${m.total != null ? fmtMs(m.total) : '—'}${n}`,
        cls: `num${isWinner('total', result) && m.total != null ? ' win' : ''}`,
        tip: cellTip(
          spreadTip('Total', m.spread && m.spread.total, fmtMs),
          statsTip('Total', stats.total, fmtMs)
        ),
      },
      {
        text: `${m.e2e != null ? fmtMs(m.e2e) : '—'}${n}`,
        cls: `num${isWinner('e2e', result) && m.e2e != null ? ' win' : ''}`,
        tip: cellTip(
          spreadTip('E2E', m.spread && m.spread.e2e, fmtMs),
          statsTip('E2E', stats.e2e, fmtMs)
        ),
      },
      {
        text: m.tokens != null ? `${m.estimatedTokens ? '~' : ''}${fmtInt(m.tokens)}` : '—',
        cls: `num${m.estimatedTokens ? ' est' : ''}`,
      },
      {
        text: `${m.tps != null ? fmtDec(m.tps) : '—'}${n}`,
        cls: `num${isWinner('tps', result) && m.tps != null ? ' win' : ''}`,
        tip: cellTip(
          spreadTip('TPS', m.spread && m.spread.tps, (v) => `${fmtDec(v)} tok/s`),
          statsTip('TPS', stats.tps, (v) => `${fmtDec(v)} tok/s`)
        ),
      },
      { text: m.chars != null ? fmtInt(m.chars) : '—', cls: 'num' },
    ];

    for (const cell of cells) {
      const td = document.createElement('td');
      td.className = cell.cls;
      td.textContent = cell.text;
      if (cell.tip) td.title = cell.tip;

      if (cell.delta) {
        const delta = document.createElement('span');
        delta.className = `delta ${cell.delta.dir}`;
        delta.textContent =
          cell.delta.dir === 'same'
            ? '≈'
            : `${cell.delta.dir === 'up' ? '▲' : '▼'} ${Math.abs(cell.delta.pct).toFixed(0)}%`;
        delta.title = `Total ${cell.delta.pct >= 0 ? 'naik' : 'turun'} ${Math.abs(cell.delta.pct).toFixed(1)}% dibanding uji sebelumnya`;
        td.appendChild(delta);
      }

      if (cell.provider) {
        const sub = document.createElement('span');
        sub.className = 'm-prov';
        sub.textContent = cell.provider;
        td.appendChild(sub);
      }
      tr.appendChild(td);
    }

    const statusTd = document.createElement('td');
    const tag = document.createElement('span');
    const statusMap = {
      queued: ['queued', 'menunggu'],
      running: ['running', 'berjalan'],
      done: ['done', 'selesai'],
      error: ['error', 'gagal'],
      skipped: ['queued', 'dilewati'],
    };
    const [cls, label] = statusMap[result.status] || ['queued', result.status];
    tag.className = `tag ${cls}`;
    tag.textContent = label;
    statusTd.appendChild(tag);
    tr.appendChild(statusTd);

    const actTd = document.createElement('td');
    actTd.className = 'act';
    const actBtn = document.createElement('button');
    actBtn.type = 'button';
    actBtn.className = 'act-btn';
    actBtn.textContent = '×';
    actBtn.title = 'Hapus model ini dari hasil uji';
    actBtn.setAttribute('aria-label', `Hapus ${result.model} dari hasil uji`);
    actBtn.disabled = state.running;
    actBtn.addEventListener('click', () => removeResult(result));
    actTd.appendChild(actBtn);
    tr.appendChild(actTd);

    els.metricsBody.appendChild(tr);
  }
}

/* ─────────────────────────────────────────── ekspor hasil & riwayat */

const HISTORY_KEY = 'frontstellar:history:v1';
const HISTORY_MAX = 20;

const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const edge = (part, key) => round2(part && part[key]);

/** Satu baris datar per model — dipakai bersama oleh ekspor dan riwayat. */
function exportRow(result) {
  const m = result.metrics || {};
  const spread = m.spread || {};
  const stats = m.stats || {};
  const stat = (key, field) => round2(stats[key] && stats[key][field]);
  return {
    provider: result.providerLabel,
    model: result.model,
    status: result.status,
    ttft_ms: round2(m.ttft),
    ttft_min_ms: edge(spread.ttft, 'min'),
    ttft_max_ms: edge(spread.ttft, 'max'),
    ttft_p95_ms: stat('ttft', 'p95'),
    ttft_sd_ms: stat('ttft', 'sd'),
    total_ms: round2(m.total),
    total_min_ms: edge(spread.total, 'min'),
    total_max_ms: edge(spread.total, 'max'),
    total_p95_ms: stat('total', 'p95'),
    total_sd_ms: stat('total', 'sd'),
    e2e_ms: round2(m.e2e),
    e2e_min_ms: edge(spread.e2e, 'min'),
    e2e_max_ms: edge(spread.e2e, 'max'),
    e2e_p95_ms: stat('e2e', 'p95'),
    e2e_sd_ms: stat('e2e', 'sd'),
    tokens: round2(m.tokens),
    estimated_tokens: m.estimatedTokens ? 1 : 0,
    tps: round2(m.tps),
    tps_min: edge(spread.tps, 'min'),
    tps_max: edge(spread.tps, 'max'),
    tps_p95: stat('tps', 'p95'),
    tps_sd: stat('tps', 'sd'),
    chars: round2(m.chars),
    samples: m.n || 1,
    error: result.error || '',
    answer: result.content || '',
  };
}

const exportRows = () => [...state.results.values()].map(exportRow);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv() {
  const rows = exportRows();
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','));
  download(`frontstellar-${stamp()}.csv`, lines.join('\r\n'), 'text/csv');
}

function exportJson() {
  const rows = exportRows();
  if (!rows.length) return;
  const payload = {
    app: 'FrontStellar Assess',
    exportedAt: new Date().toISOString(),
    prompt: els.prompt.value,
    system: els.system.value,
    mode: state.mode,
    repeats: repeatCount(),
    rows,
  };
  download(`frontstellar-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function exportMarkdown() {
  const rows = exportRows();
  if (!rows.length) return;
  const v = (x) => (x == null ? '—' : String(x));
  const head = ['Provider', 'Model', 'Status', 'TTFT (ms)', 'Total (ms)', 'E2E (ms)', 'Token', 'TPS', 'Karakter', 'N'];
  const lines = [
    '# FrontStellar Assess — hasil uji',
    '',
    `- Prompt: ${els.prompt.value.replace(/\s+/g, ' ').trim()}`,
    `- Diekspor: ${new Date().toLocaleString('id-ID')}`,
    `- Mode: ${state.mode}${repeatCount() > 1 ? ` · ${repeatCount()}× per model` : ''}`,
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
  ];
  for (const r of rows) {
    lines.push(
      `| ${[
        r.provider,
        r.model,
        r.status,
        v(r.ttft_ms),
        v(r.total_ms),
        v(r.e2e_ms),
        `${r.estimated_tokens ? '~' : ''}${v(r.tokens)}`,
        v(r.tps),
        v(r.chars),
        r.samples,
      ].join(' | ')} |`
    );
  }
  lines.push('', '## Jawaban', '');
  for (const r of rows) {
    lines.push(`### ${r.model}`, '', r.answer.trim() || `_${r.error || 'tanpa jawaban'}_`, '');
  }
  download(`frontstellar-${stamp()}.md`, lines.join('\n'), 'text/markdown');
}

/** Angka untuk laporan: bulatkan, tanda pisah bila kosong. */
const reportNum = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));

const REPORT_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 28px 64px; background: #0a0c0f; color: #e8ecf1;
    font: 400 14px/1.55 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 20px; }
  h2 { margin: 34px 0 12px; font-size: 15px; color: #b4f461; }
  h3 { margin: 0 0 6px; font-size: 13.5px; display: flex; justify-content: space-between; gap: 12px; }
  h3 span { color: #5b6675; font-weight: 400; font-size: 12px; }
  .sub { margin: 0; color: #8b96a5; font-size: 12.5px; }
  .meta { margin: 16px 0 0; padding: 0; list-style: none; font-size: 12.5px; color: #8b96a5; }
  .meta li { margin: 3px 0; }
  .meta b { color: #e8ecf1; font-weight: 500; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
  .chip { padding: 5px 10px; border: 1px solid #212831; border-radius: 999px; font-size: 12px; color: #8b96a5; }
  .chip b { color: #b4f461; }
  .chip.err { border-color: rgba(248,113,113,0.35); color: #f87171; }
  figure { margin: 0 0 22px; }
  figcaption { margin-bottom: 8px; }
  figcaption b { font-size: 13px; font-weight: 500; }
  figcaption span { margin-left: 8px; color: #5b6675; font-size: 11.5px; }
  figure svg { display: block; width: 100%; height: auto; }
  .table-wrap { overflow-x: auto; border: 1px solid #212831; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #212831; text-align: left; white-space: nowrap; }
  th { color: #8b96a5; font-weight: 500; background: #12161b; }
  td.num { text-align: right; font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; }
  td.model { font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; }
  tr.is-error td { color: #f87171; }
  tr:last-child td { border-bottom: none; }
  article { padding: 14px 0; border-top: 1px solid #212831; }
  article:first-of-type { border-top: none; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 400 13px/1.6 "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace; }
  .err { margin: 0; color: #f87171; font-size: 13px; }
  footer { margin-top: 40px; color: #5b6675; font-size: 11.5px; }
  @media print {
    body { background: #fff; color: #111; }
    h2, .sub, .meta { color: #333; }
    .table-wrap, th, td { border-color: #ccc; }
    th { background: #f4f4f4; color: #333; }
    figure svg { background: #0a0c0f; }
  }
`;

/** Laporan HTML mandiri: ringkasan, diagram SVG tersemat, tabel metrik, dan semua jawaban. */
function exportHtml() {
  const results = [...state.results.values()];
  if (!results.length) return;

  const rows = exportRows();
  const done = results.filter((r) => r.status === 'done');
  const failed = results.filter((r) => r.status === 'error');
  const pct = Math.round((done.length / results.length) * 100);

  const charts = [...document.querySelectorAll('#chartPanel .chart')]
    .filter((fig) => !fig.hidden)
    .map((fig) => {
      const canvas = fig.querySelector('.chart-canvas');
      const shot = canvas && window.ModelCharts.snapshot(canvas);
      if (!shot) return '';
      const title = fig.querySelector('.chart-title');
      const sub = fig.querySelector('.chart-sub');
      return (
        `<figure><figcaption><b>${htmlEscape(title && title.textContent)}</b>` +
        `<span>${htmlEscape(sub && sub.textContent)}</span></figcaption>${shot.markup}</figure>`
      );
    })
    .join('');

  const chips = [`<span class="chip"><b>${pct}%</b> berhasil · ${done.length}/${results.length} model</span>`];
  const kinds = new Map();
  for (const result of failed) {
    const kind = errorKind(result);
    kinds.set(kind, (kinds.get(kind) || 0) + 1);
  }
  for (const [kind, count] of kinds) {
    chips.push(`<span class="chip err">${htmlEscape(kind)} · ${count}×</span>`);
  }

  const head = [
    'Model', 'Provider', 'Status', 'TTFT', 'TTFT p95', 'Total', 'Total p95',
    'E2E', 'Token', 'TPS', 'TPS p95', 'N',
  ];
  const body = rows
    .map(
      (r) => `<tr class="${r.status === 'error' ? 'is-error' : ''}">` +
        `<td class="model">${htmlEscape(r.model)}</td>` +
        `<td>${htmlEscape(r.provider)}</td>` +
        `<td>${r.status === 'done' ? 'selesai' : 'gagal'}</td>` +
        `<td class="num">${reportNum(r.ttft_ms)}</td>` +
        `<td class="num">${reportNum(r.ttft_p95_ms)}</td>` +
        `<td class="num">${reportNum(r.total_ms)}</td>` +
        `<td class="num">${reportNum(r.total_p95_ms)}</td>` +
        `<td class="num">${reportNum(r.e2e_ms)}</td>` +
        `<td class="num">${r.tokens == null ? '—' : `${r.estimated_tokens ? '~' : ''}${reportNum(r.tokens)}`}</td>` +
        `<td class="num">${reportNum(r.tps)}</td>` +
        `<td class="num">${reportNum(r.tps_p95)}</td>` +
        `<td class="num">${r.samples}</td>` +
        '</tr>'
    )
    .join('');

  const answers = results
    .map((result) => {
      const bodyHtml =
        result.status === 'error'
          ? `<p class="err">${htmlEscape(result.error || 'Provider mengembalikan kesalahan.')}</p>`
          : `<pre>${htmlEscape((result.content || '').trim() || '(tanpa jawaban)')}</pre>`;
      return (
        `<article><h3>${htmlEscape(result.model)}<span>${htmlEscape(result.providerLabel)}</span></h3>` +
        `${bodyHtml}</article>`
      );
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FrontStellar Assess — laporan uji</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>FrontStellar Assess — laporan uji</h1>
  <p class="sub">${htmlEscape(new Date().toLocaleString('id-ID'))}</p>
  <ul class="meta">
    <li><b>Prompt:</b> ${htmlEscape((els.prompt.value || '').replace(/\s+/g, ' ').trim() || '(kosong)')}</li>
    ${
      els.system.value.trim()
        ? `<li><b>System:</b> ${htmlEscape(els.system.value.replace(/\s+/g, ' ').trim())}</li>`
        : ''
    }
    <li><b>Mode:</b> ${htmlEscape(state.mode)}${
      repeatCount() > 1 ? ` · ${repeatCount()}× pengulangan per model` : ''
    }</li>
    <li><b>Provider:</b> ${htmlEscape([...new Set(rows.map((r) => r.provider).filter(Boolean))].join(', ') || '—')}</li>
  </ul>
  <div class="chips">${chips.join('')}</div>
  ${charts ? `<h2>Diagram</h2>${charts}` : ''}
  <h2>Perbandingan metrik</h2>
  <div class="table-wrap">
    <table>
      <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <p class="sub" style="margin-top:10px">Nilai tabel = median lintas sampel · p95 = persentil ke-95 · N = jumlah ulangan.</p>
  <h2>Jawaban</h2>
  ${answers}
  <footer>Dibuat oleh FrontStellar Assess. Berkas ini mandiri: tidak memuat aset atau skrip eksternal.</footer>
</div>
</body>
</html>
`;

  download(`frontstellar-${stamp()}.html`, html, 'text/html');
}

function readHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function writeHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch (_) {
    /* localStorage penuh atau diblokir: riwayat dilewati, uji tetap berjalan */
  }
}

function bestRow(rows, key, dir) {
  const valid = rows.filter((r) => r[key] != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (dir === 'min' ? (b[key] < a[key] ? b : a) : b[key] > a[key] ? b : a));
}

/** Simpan ringkasan hasil tiap kali uji selesai, paling banyak HISTORY_MAX entri. */
function saveHistory() {
  const rows = exportRows().filter((r) => r.status === 'done' || r.status === 'error');
  if (!rows.some((r) => r.status === 'done')) return;

  const list = readHistory();
  list.unshift({
    id: String(Date.now()),
    at: new Date().toISOString(),
    prompt: els.prompt.value,
    mode: state.mode,
    repeats: repeatCount(),
    rows,
  });
  writeHistory(list.slice(0, HISTORY_MAX));
  renderHistory();
}

function renderHistory() {
  const list = readHistory();
  els.historyPanel.hidden = list.length === 0;
  els.historyList.innerHTML = '';
  if (!list.length) return;

  for (const entry of list) {
    const done = entry.rows.filter((r) => r.status === 'done');
    const failed = entry.rows.length - done.length;

    const item = document.createElement('div');
    item.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = entry.prompt.replace(/\s+/g, ' ').trim() || '(prompt kosong)';
    title.title = entry.prompt;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent =
      `${new Date(entry.at).toLocaleString('id-ID')} · ${done.length}/${entry.rows.length} model` +
      `${failed ? ` · ${failed} gagal` : ''} · ${entry.mode}${entry.repeats > 1 ? ` · ${entry.repeats}×` : ''}`;

    const best = document.createElement('div');
    best.className = 'history-best';
    const pairs = [
      ['total', bestRow(done, 'total_ms', 'min')],
      ['TTFT', bestRow(done, 'ttft_ms', 'min')],
      ['TPS', bestRow(done, 'tps', 'max')],
    ];
    pairs.forEach(([label, row], i) => {
      best.append(document.createTextNode(`${label} `));
      const b = document.createElement('b');
      b.textContent = row ? row.model : '—';
      best.append(b);
      if (i < pairs.length - 1) best.append(document.createTextNode(' · '));
    });

    main.append(title, meta, best);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'ghost-btn';
    load.textContent = 'Muat';
    load.disabled = state.running;
    load.addEventListener('click', () => restoreSnapshot(entry));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ghost-btn';
    del.textContent = 'Hapus';
    del.addEventListener('click', () => {
      writeHistory(readHistory().filter((h) => h.id !== entry.id));
      renderHistory();
    });

    actions.append(load, del);
    item.append(main, actions);
    els.historyList.appendChild(item);
  }
}

const pairEdge = (min, max) => (min == null || max == null ? null : { min, max });

/** Tampilkan kembali hasil uji lama tanpa memanggil provider lagi. */
function restoreSnapshot(entry) {
  if (state.running) return;

  state.results.clear();
  state.controllers.clear();
  state.cancelled = false;
  state.done = entry.rows.length;
  els.answers.innerHTML = '';
  els.metricsBody.innerHTML = '';
  els.ranking.innerHTML = '';
  chartSig = '';
  state.picked.clear();
  applyCompare();
  els.racePanel.hidden = true;
  raceRows = [];

  // Pembanding: entri riwayat tepat sebelum yang sedang dimuat.
  const history = readHistory();
  const position = history.findIndex((h) => h.id === entry.id);
  state.baseline = baselineFrom(position >= 0 ? history[position + 1] : null);

  const providers = new Set(entry.rows.map((r) => r.provider).filter(Boolean));
  state.multiProvider = state.providers.length > 1 || providers.size > 1;

  entry.rows.forEach((row, index) => {
    const metrics = {
      ttft: row.ttft_ms,
      total: row.total_ms,
      e2e: row.e2e_ms,
      tokens: row.tokens,
      tps: row.tps,
      chars: row.chars,
      estimatedTokens: Boolean(row.estimated_tokens),
      n: row.samples || 1,
      spread: {
        ttft: pairEdge(row.ttft_min_ms, row.ttft_max_ms),
        total: pairEdge(row.total_min_ms, row.total_max_ms),
        e2e: pairEdge(row.e2e_min_ms, row.e2e_max_ms),
        tps: pairEdge(row.tps_min, row.tps_max),
      },
    };

    const result = {
      key: `${row.provider}::${row.model}`,
      providerId: row.provider,
      modelId: row.model,
      providerLabel: row.provider,
      model: row.model,
      status: row.status === 'error' ? 'error' : 'done',
      content: row.answer || '',
      reasoning: '',
      error: row.error || null,
      errorStatus: 0,
      retryAfter: null,
      metrics: row.status === 'error' ? null : metrics,
      samples: [],
      firstTokenAt: row.ttft_ms == null ? null : row.ttft_ms,
      e2eStart: 0,
      startedAt: 0,
      el: null,
    };

    state.results.set(result.key, result);
    const node = answerNode(result, index);
    result.el.caret.remove();
    result.el.txt.textContent = result.content;

    if (result.status === 'error') {
      node.classList.add('is-error');
      setTag(result, 'error', 'gagal');
      result.el.errorBox.hidden = false;
      result.el.errorBox.textContent = result.error || 'Provider mengembalikan kesalahan.';
      if (!result.content) result.el.body.hidden = true;
    } else {
      setTag(result, 'done', `${fmtDec(metrics.tps)} tok/s${metrics.n > 1 ? ` · ${metrics.n}×` : ''}`);
    }

    paintAnswerMetrics(result);
    els.answers.appendChild(node);
  });

  els.answersPanel.hidden = false;
  flush();
  setHint(`Riwayat dimuat · ${entry.rows.length} model.`, '');
  toast(`Riwayat dimuat · ${entry.rows.length} model.`, { kind: 'ok' });
}

/* ─────────────────────────────────────────────────────────── events */

els.toggleKey.addEventListener('click', () => {
  const shown = els.apiKey.type === 'text';
  els.apiKey.type = shown ? 'password' : 'text';
  els.toggleKey.textContent = shown ? 'Lihat' : 'Sembunyi';
});

els.preset.addEventListener('change', () => {
  if (els.preset.value) els.baseUrl.value = els.preset.value;
});

els.btnConnect.addEventListener('click', connect);

els.modelFilter.addEventListener('input', renderModelList);

els.btnSelectAll.addEventListener('click', () => {
  for (const entry of visibleEntries()) state.selected.add(entry.key);
  renderModelList();
  updateRunAvailability();
  saveSession();
});

els.btnSelectNone.addEventListener('click', () => {
  state.selected.clear();
  renderModelList();
  updateRunAvailability();
  saveSession();
});

els.btnSelectFast.addEventListener('click', () => {
  const preferred = [
    /flash/i,
    /mini|nano|small|haiku/i,
    /8b|7b|3b|1b/i,
    /turbo|instant/i,
    /lite/i,
  ];
  const scored = allEntries()
    .map((entry) => {
      const rank = preferred.findIndex((re) => re.test(entry.modelId));
      return { key: entry.key, id: entry.modelId, rank: rank === -1 ? preferred.length : rank };
    })
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  state.selected.clear();
  scored.slice(0, 4).forEach((entry) => state.selected.add(entry.key));
  renderModelList();
  updateRunAvailability();
  saveSession();
});

els.modeToggle.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-mode]');
  if (!button || state.running) return;
  state.mode = button.dataset.mode;
  els.modeToggle
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('active', b === button));
  updateModeNote();
});

els.concurrency.addEventListener('input', updateModeNote);

els.promptPreset.addEventListener('change', () => {
  if (els.promptPreset.value) els.prompt.value = els.promptPreset.value;
});

// Mengetik manual menandai prompt sebagai kustom lagi.
els.prompt.addEventListener('input', () => {
  if (els.promptPreset.value && els.prompt.value !== els.promptPreset.value) {
    els.promptPreset.value = '';
  }
});

els.btnRun.addEventListener('click', runAll);
els.btnCancel.addEventListener('click', cancelAll);
els.btnRetryFailed.addEventListener('click', retryFailed);

els.viewToggle.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-view]');
  if (!button) return;
  els.viewToggle.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
  els.answers.dataset.view = button.dataset.view;
});

// Metrik "makin besar makin baik" diurutkan menurun pada klik pertama.
const DESC_FIRST = { tokens: true, tps: true, chars: true };

els.tableHead.forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.key;
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.key = key;
      state.sort.dir = DESC_FIRST[key] ? 'desc' : 'asc';
    }
    // Posisi lama dicatat agar baris yang berpindah bisa dianimasikan (FLIP).
    const before = captureRowTops();
    renderTable();
    playRowFlip(before);
  });
});

/* ── tema, animasi & dialog pintasan */

els.btnTheme.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  writeStore(THEME_KEY, next);
});

els.btnMotion.addEventListener('click', () => {
  const reduce = document.documentElement.dataset.motion !== 'reduced';
  applyMotion(reduce);
  writeStore(MOTION_KEY, reduce ? 'reduced' : 'full');
});

const openKeys = () => {
  if (typeof els.keysDialog.showModal === 'function') els.keysDialog.showModal();
};

els.btnKeys.addEventListener('click', openKeys);
els.btnKeysClose.addEventListener('click', () => els.keysDialog.close());

/** Pintasan papan tombol: tidak aktif saat kursor berada di kolom teks. */
document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = Boolean(
    target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
  );

  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    runAll();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault();
    if (els.modelFilter.disabled) toast('Hubungkan provider dulu untuk mencari model.', { life: 2600 });
    else {
      els.modelFilter.focus();
      els.modelFilter.select();
    }
    return;
  }

  if (event.key === 'Escape') {
    if (els.keysDialog.open) els.keysDialog.close();
    else if (state.picked.size) {
      state.picked.clear();
      applyCompare();
    } else if (state.running) cancelAll();
    else {
      window.ModelCharts.pinModel(null);
      syncRankPins(null);
    }
    return;
  }

  if (typing) return;

  if (event.key === 'r' || event.key === 'R') {
    window.ModelCharts.resetView();
    toast('Skala semua diagram dikembalikan.', { life: 2000 });
    return;
  }

  if (event.key === 'c' || event.key === 'C') {
    if (state.picked.size === 2) {
      state.picked.clear();
      applyCompare();
    } else {
      toast('Tandai 2 kartu jawaban dengan tombol ⇄ untuk membandingkannya.', { life: 4000 });
    }
    return;
  }

  if (event.key === '?') openKeys();
});

// Diagram digambar pada lebar piksel nyata, jadi perlu digambar ulang saat ukuran berubah.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    chartSig = '';
    renderCharts();
  }, 150);
});

for (const button of [els.btnExportCsv, els.btnExportJson, els.btnExportMd, els.btnExportHtml]) {
  button.addEventListener('click', () => toast('Menyiapkan berkas hasil uji…', { life: 2200 }));
}

els.boxMetric.addEventListener('click', (e) => {
  const button = e.target.closest('button[data-metric]');
  if (!button) return;
  els.boxMetric.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
  window.ModelCharts.renderBoxplot(els.chartBox, chartRows(), boxMetric());
});

els.btnClearHistory.addEventListener('click', () => {
  if (!readHistory().length) return;
  if (!window.confirm('Hapus seluruh riwayat uji?')) return;
  writeHistory([]);
  renderHistory();
  toast('Riwayat uji dibersihkan.', { kind: 'ok' });
});

els.btnForgetProviders.addEventListener('click', () => {
  if (!state.providers.length) return;
  if (!window.confirm('Hapus provider tersimpan (termasuk API key) dari browser ini?')) return;
  forgetSession();
  toast('Provider tersimpan dihapus dari browser.', { kind: 'ok' });
});

// Sorotan yang disematkan dari dalam diagram (klik legenda) tetap disinkronkan ke kartu peringkat.
window.ModelCharts.onPinChange((model) => {
  pinnedModel = model;
  syncRankPins(model);
});

const prefersReduced =
  Boolean(window.matchMedia) && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
applyTheme(readStore(THEME_KEY) === 'light' ? 'light' : 'dark');
applyMotion(readStore(MOTION_KEY) === 'reduced' || (readStore(MOTION_KEY) === null && prefersReduced));

renderHistory();
restoreSession();
renderProviders();
renderModelList();
updateRunAvailability();
