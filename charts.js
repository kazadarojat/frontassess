'use strict';

/**
 * Diagram hasil uji. Digambar langsung sebagai SVG agar tanpa dependensi
 * eksternal dan ukurannya selalu pas dengan lebar kontainer.
 *
 * Tiap diagram bisa digeser (seret dengan mouse/jari), skalanya diubah
 * (gulir roda mouse, tombol +/−, atau klik dua kali untuk mengembalikan),
 * dan tiap model bisa disorot lintas diagram dengan menunjuk batang, titik,
 * atau baris legenda. Klik baris legenda untuk menyematkan sorotan.
 *
 * rows: [{ model, ttft, total, tps, tokens, estimated }]
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  /**
   * Warna diagram diambil dari token CSS (lihat styles.css) supaya ikut berubah
   * saat tema terang/gelap diganti. Nilai di bawah hanya cadangan.
   */
  const PALETTE_VARS = {
    ttft: '--ch-ttft',
    gen: '--ch-gen',
    grid: '--ch-grid',
    axis: '--ch-axis',
    text: '--ch-text',
    dim: '--ch-dim',
    strong: '--ch-strong',
    ideal: '--ch-ideal',
    box: '--ch-box',
    whisk: '--ch-whisk',
    outlier: '--ch-outlier',
  };

  const FALLBACK = {
    ttft: '#6cb6ff',
    gen: '#b4f461',
    grid: '#1d242c',
    axis: '#2c3541',
    text: '#8b96a5',
    dim: '#5b6675',
    strong: '#e8ecf1',
    ideal: 'rgba(180, 244, 97, 0.055)',
    box: 'rgba(180, 244, 97, 0.16)',
    whisk: '#5b6675',
    outlier: '#f87171',
  };

  const C = {};

  /** Latar laporan/diagram yang diekspor agar serasi dengan temanya. */
  let canvasColor = '#0a0c0f';

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    for (const key in PALETTE_VARS) {
      const value = cs.getPropertyValue(PALETTE_VARS[key]).trim();
      C[key] = value || FALLBACK[key];
    }
    canvasColor = cs.getPropertyValue('--bg').trim() || '#0a0c0f';
  }

  readPalette();

  let clipSeq = 0;

  /* ------------------------------------------------------------ helpers */
  function el(name, attrs, content) {
    const node = document.createElementNS(NS, name);
    if (attrs) {
      for (const key in attrs) {
        if (attrs[key] != null) node.setAttribute(key, attrs[key]);
      }
    }
    if (content != null) node.textContent = content;
    return node;
  }

  const fmtMs = (v) =>
    v == null ? '—' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(2)}s`;

  const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toFixed(d));

  const clampNum = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  function clip(value, max) {
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(1, max - 1))}…`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  /* --------------------------------------------- sorotan silang & tooltip */

  /** Semua kontainer diagram yang aktif, supaya sorotan bisa lintas diagram. */
  const charts = new Set();
  /** Model yang sedang ditunjuk kursor / disematkan lewat legenda. */
  let hovered = null;
  let pinned = null;
  let tipEl = null;
  /** Dipanggil tiap sorotan tersemat berubah, agar UI luar bisa ikut menandai. */
  let pinListener = null;

  function notifyPin() {
    if (pinListener) pinListener(pinned);
  }

  const keyOf = (row) => String(row.model == null ? '' : row.model);
  const markKey = () => hovered || pinned;

  function tipNode() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  function placeTip(node, ev) {
    const gap = 14;
    const box = node.getBoundingClientRect();
    let x = ev.clientX + gap;
    let y = ev.clientY + gap;
    if (x + box.width > window.innerWidth - 8) x = ev.clientX - box.width - gap;
    if (y + box.height > window.innerHeight - 8) y = ev.clientY - box.height - gap;
    node.style.left = `${Math.max(8, x)}px`;
    node.style.top = `${Math.max(8, y)}px`;
  }

  function tipHtml(row) {
    const rows = [
      ['TTFT', fmtMs(row.ttft)],
      ['TPS', `${row.estimated ? '~' : ''}${fmtNum(row.tps)} tok/s`],
      ['Total', fmtMs(row.total)],
    ];
    if (row.tokens) rows.push(['Token', `${row.estimated ? '~' : ''}${Math.round(row.tokens)}`]);

    // Rentang antar-ulangan hanya berarti bila model diuji lebih dari sekali.
    const span = (key, fmt) => {
      const list = (((row.samples || {})[key]) || []).filter((v) => Number.isFinite(v));
      if (list.length < 2) return null;
      return `${fmt(Math.min(...list))} – ${fmt(Math.max(...list))}`;
    };
    const ttftSpan = span('ttft', fmtMs);
    const tpsSpan = span('tps', (v) => fmtNum(v));
    if (ttftSpan) rows.push(['TTFT ulangan', ttftSpan]);
    if (tpsSpan) rows.push(['TPS ulangan', `${tpsSpan} tok/s`]);

    return (
      `<span class="tip-name">${escapeHtml(row.model)}</span>` +
      rows
        .map(([k, v]) => `<span class="tip-row"><span>${k}</span><b>${v}</b></span>`)
        .join('')
    );
  }

  function showTip(html, ev) {
    const node = tipNode();
    node.innerHTML = html;
    placeTip(node, ev);
    node.dataset.show = '1';
  }

  function hideTip() {
    if (tipEl) tipEl.dataset.show = '0';
  }

  /** Tandai satu elemen sebagai milik model tertentu (ikut disorot/diredupkan). */
  function tagMark(node, key) {
    node.classList.add('mk');
    node.setAttribute('data-mk', key);
    return node;
  }

  /**
   * Penanda yang bisa ditunjuk: menyorot baris/model yang sama di semua diagram
   * dan menampilkan tooltip yang mengikuti kursor.
   */
  function interactive(node, key, row) {
    tagMark(node, key);
    node.addEventListener('pointerenter', (ev) => {
      if (hovered === key) return;
      hovered = key;
      applyHighlight();
      showTip(tipHtml(row), ev);
    });
    node.addEventListener('pointermove', (ev) => {
      if (hovered !== key) return;
      placeTip(tipNode(), ev);
    });
    node.addEventListener('pointerleave', () => {
      if (hovered !== key) return;
      hovered = null;
      applyHighlight();
      hideTip();
    });
    return node;
  }

  /** Klik baris legenda = sematkan / lepaskan sorotan model tersebut. */
  function pinnable(node, key) {
    node.classList.add('lg');
    node.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    node.addEventListener('dblclick', (ev) => ev.stopPropagation());
    node.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hovered = null;
      pinned = pinned === key ? null : key;
      hideTip();
      applyHighlight();
      notifyPin();
    });
    return node;
  }

  function applyHighlightIn(container) {
    const svg = container.querySelector('svg.chart-svg');
    if (!svg) return;
    const key = markKey();
    const st = container.__view;
    const on = key != null && st && st.keys && st.keys.has(key);
    svg.classList.toggle('has-hover', on);
    svg.querySelectorAll('[data-mk]').forEach((node) => {
      const hot = on && node.getAttribute('data-mk') === key;
      node.classList.toggle('hot', hot);
      node.classList.toggle('pinned', hot && pinned != null);
    });
  }

  function applyHighlight() {
    charts.forEach(applyHighlightIn);
  }

  /** Bersihkan sorotan & tooltip (dipakai saat data uji berubah). */
  function clearHighlight() {
    if (hovered == null && pinned == null) return;
    hovered = null;
    pinned = null;
    hideTip();
    applyHighlight();
    notifyPin();
  }

  function empty(container, message) {
    container.textContent = '';
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = message;
    container.appendChild(p);
    const tools = figureOf(container) && figureOf(container).querySelector('.chart-tools');
    if (tools) tools.hidden = true;
  }

  function figureOf(container) {
    return container.closest ? container.closest('.chart') : null;
  }

  /** Buat SVG selebar kontainer lalu jalankan painter. */
  function mount(container, height, paint) {
    container.textContent = '';
    const width = Math.max(300, Math.round(container.clientWidth || 640));
    const svg = el('svg', {
      class: 'chart-svg',
      width: '100%',
      height,
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'xMidYMin meet',
      role: 'img',
    });
    paint(svg, width, height);
    container.appendChild(svg);
  }

  /* ------------------------------- tampilan: geser (pan) + skala (zoom) */

  /**
   * Wadah status tampilan untuk satu kontainer diagram, disimpan pada elemen
   * agar tetap hidup walau SVG digambar ulang. `sig` adalah sidik data: kalau
   * berubah (hasil uji baru), skala dikembalikan ke tampilan awal.
   */
  function viewState(container, sig, opts) {
    let st = container.__view;
    if (!st) {
      st = container.__view = {
        sig: '',
        sigKey: opts.key,
        invertY: Boolean(opts.invertY),
        view: null,
        limit: null,
        keys: null,
        refresh: null,
        plot: { x: 0, y: 0, w: 1, h: 1 },
        sx: 1,
        sy: 1,
        paintWidth: 1,
        /** true berarti data berubah, jadi penanda boleh dianimasikan masuk. */
        enter: true,
        enterTimer: null,
      };
      wireViewport(container);
    }
    st.invertY = Boolean(opts.invertY);
    if (st.sig !== sig || st.sigKey !== opts.key) {
      st.sig = sig;
      st.sigKey = opts.key;
      st.view = null;
      // Geser/zoom tidak mengubah sig, jadi animasi hanya jalan saat data berubah.
      st.enter = true;
      clearHighlight();
    }
    return st;
  }

  /** Rentang yang sedang terlihat; null berarti belum pernah diubah. */
  function ensureView(st) {
    if (!st.view && st.limit) st.view = Object.assign({}, st.limit);
    return st.view;
  }

  /** Animasi dimatikan oleh preferensi sistem atau sakelar "kurangi animasi". */
  function motionOff() {
    if (document.documentElement.dataset.motion === 'reduced') return true;
    return Boolean(
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /**
   * Animasi masuk berjenjang: penanda satu model muncul bersamaan, model
   * berikutnya menyusul sedikit lebih lambat. Dijalankan sekali per data baru,
   * lalu kelasnya dilepas supaya tidak menimpa efek peredupan saat sorotan.
   */
  function playEntrance(svg, st) {
    if (!st || !st.enter) return;
    st.enter = false;
    if (motionOff()) return;

    const nodes = Array.from(svg.querySelectorAll('[data-mk]'));
    if (!nodes.length) return;

    const order = new Map();
    let step = 0;
    for (const node of nodes) {
      const key = node.getAttribute('data-mk');
      if (!order.has(key)) order.set(key, step++);
      node.style.animationDelay = `${Math.min(order.get(key) * 45, 400)}ms`;
    }

    svg.classList.add('enter');
    clearTimeout(st.enterTimer);
    st.enterTimer = setTimeout(() => {
      svg.classList.remove('enter');
      for (const node of nodes) node.style.animationDelay = '';
    }, Math.min(Math.max(step - 1, 0) * 45, 400) + 380);
  }

  /** Tahan rentang tampilan agar tidak keluar dari rentang data. */
  function clampView(st) {
    const v = st.view;
    const L = st.limit;
    if (!v || !L) return;
    const spanX = v.x1 - v.x0;
    v.x0 = clampNum(v.x0, L.x0, Math.max(L.x1 - spanX, L.x0));
    v.x1 = v.x0 + spanX;
    if (v.y0 != null && L.y0 != null) {
      const spanY = v.y1 - v.y0;
      v.y0 = clampNum(v.y0, L.y0, Math.max(L.y1 - spanY, L.y0));
      v.y1 = v.y0 + spanY;
    }
  }

  function panView(st, dx, dy) {
    const v = st.view;
    if (!v || !st.sx) return;
    v.x0 -= dx / st.sx;
    v.x1 -= dx / st.sx;
    if (v.y0 != null && st.sy) {
      const shift = ((st.invertY ? -1 : 1) * dy) / st.sy;
      v.y0 += shift;
      v.y1 += shift;
    }
    clampView(st);
  }

  /**
   * Ubah skala sebesar `factor` dengan titik (cx, cy) dalam koordinat SVG
   * sebagai pusat, supaya bagian yang ditunjuk kursor tidak berpindah.
   */
  function zoomView(st, factor, cx, cy) {
    const v = st.view;
    const L = st.limit;
    const p = st.plot;
    if (!v || !L) return;

    const fullX = L.x1 - L.x0;
    const spanX = v.x1 - v.x0;
    const fx = clampNum((cx - p.x) / (p.w || 1), 0, 1);
    const anchorX = v.x0 + spanX * fx;
    const nextSpanX = clampNum(spanX / factor, fullX / 60, fullX);
    v.x0 = anchorX - (anchorX - v.x0) * (nextSpanX / spanX);
    v.x1 = v.x0 + nextSpanX;

    if (v.y0 != null && L.y0 != null) {
      const fullY = L.y1 - L.y0;
      const spanY = v.y1 - v.y0;
      const fy = clampNum((cy - p.y) / (p.h || 1), 0, 1);
      const anchorY = st.invertY ? v.y1 - spanY * fy : v.y0 + spanY * fy;
      const nextSpanY = clampNum(spanY / factor, fullY / 60, fullY);
      v.y0 = anchorY - (anchorY - v.y0) * (nextSpanY / spanY);
      v.y1 = v.y0 + nextSpanY;
    }

    clampView(st);
  }

  /** Faktor konversi piksel layar -> satuan viewBox (SVG bisa di-skala CSS). */
  function fitFactor(container, st) {
    const svg = container.querySelector('svg.chart-svg');
    if (!svg) return 1;
    const w = svg.getBoundingClientRect().width;
    return w > 0 ? st.paintWidth / w : 1;
  }

  /** Geser + zoom dipasang sekali per kontainer; handler membaca state terkini. */
  function wireViewport(container) {
    charts.add(container);
    let drag = null;

    container.addEventListener('pointerdown', (ev) => {
      const st = container.__view;
      if (!st || !st.refresh || ev.button !== 0) return;
      drag = { x: ev.clientX, y: ev.clientY };
      if (container.setPointerCapture) container.setPointerCapture(ev.pointerId);
      container.classList.add('is-panning');
    });

    container.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const st = container.__view;
      if (!st || !st.refresh) return;
      const k = fitFactor(container, st);
      const dx = (ev.clientX - drag.x) * k;
      const dy = (ev.clientY - drag.y) * k;
      if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) return;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      ensureView(st);
      panView(st, dx, dy);
      st.refresh();
    });

    const stopDrag = (ev) => {
      if (!drag) return;
      drag = null;
      container.classList.remove('is-panning');
      if (container.hasPointerCapture && container.hasPointerCapture(ev.pointerId)) {
        container.releasePointerCapture(ev.pointerId);
      }
    };
    container.addEventListener('pointerup', stopDrag);
    container.addEventListener('pointercancel', stopDrag);

    // jaring pengaman: kursor keluar kanvas -> sorotan & tooltip dibersihkan
    container.addEventListener('pointerleave', () => {
      if (hovered == null) return;
      hovered = null;
      applyHighlight();
      hideTip();
    });

    container.addEventListener(
      'wheel',
      (ev) => {
        const st = container.__view;
        if (!st || !st.refresh) return;
        ev.preventDefault();
        const svg = container.querySelector('svg.chart-svg');
        const box = (svg || container).getBoundingClientRect();
        const k = fitFactor(container, st);
        ensureView(st);
        zoomView(st, ev.deltaY < 0 ? 1.14 : 1 / 1.14, (ev.clientX - box.left) * k, (ev.clientY - box.top) * k);
        st.refresh();
      },
      { passive: false }
    );

    container.addEventListener('dblclick', () => {
      const st = container.__view;
      if (!st || !st.refresh) return;
      st.view = null;
      st.refresh();
    });
  }

  /** Tombol +/−/Reset di caption diagram. */
  function toolsFor(container) {
    const fig = figureOf(container);
    if (!fig) return;
    let box = fig.querySelector('.chart-tools');
    if (!box) {
      const st = container.__view;
      const scatter = st && st.sigKey === 'scatter';
      box = document.createElement('span');
      box.className = 'chart-tools';
      box.innerHTML =
        `<span class="chart-hint">${
          scatter
            ? 'seret geser · gulir zoom · klik legenda menyematkan sorotan'
            : 'seret untuk geser · gulir untuk zoom'
        }</span>` +
        '<button type="button" data-act="out" title="Perkecil skala">&minus;</button>' +
        '<button type="button" data-act="in" title="Perbesar skala">+</button>' +
        '<button type="button" data-act="reset" title="Kembalikan skala awal">Reset</button>' +
        '<button type="button" data-act="svg" title="Simpan diagram sebagai berkas SVG">SVG</button>' +
        '<button type="button" data-act="png" title="Simpan diagram sebagai gambar PNG">PNG</button>';
      (fig.querySelector('figcaption') || fig).appendChild(box);

      box.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;

        if (btn.dataset.act === 'svg') return saveSvg(container);
        if (btn.dataset.act === 'png') return savePng(container);

        const st = container.__view;
        if (!st || !st.refresh) return;
        if (btn.dataset.act === 'reset') {
          st.view = null;
        } else {
          ensureView(st);
          const p = st.plot;
          zoomView(st, btn.dataset.act === 'in' ? 1.5 : 1 / 1.5, p.x + p.w / 2, p.y + p.h / 2);
        }
        st.refresh();
      });
    }
    box.hidden = false;
  }

  /* ------------------------------------------------------------- sumbu x */

  /** Garis grid + label sumbu horizontal dengan 4 interval untuk rentang [min, max]. */
  function xAxis(svg, x0, plotW, min, max, yTop, yBottom, height, format) {
    const span = max - min || 1;
    for (let i = 0; i <= 4; i += 1) {
      const value = min + (span / 4) * i;
      const px = x0 + ((value - min) / span) * plotW;
      svg.append(
        el('line', {
          x1: px,
          y1: yTop,
          x2: px,
          y2: yBottom,
          stroke: C.grid,
          'stroke-width': 1,
        })
      );
      svg.append(
        el(
          'text',
          {
            x: px,
            y: height - 8,
            fill: C.dim,
            'font-size': 10,
            'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle',
          },
          format(value)
        )
      );
    }
  }

  /** Sisipkan grup ber-clip supaya batang/titik tidak menimpa area label. */
  function clippedGroup(svg, x, y, w, h) {
    const id = `fsa-clip-${(clipSeq += 1)}`;
    const defs = el('clipPath', { id });
    defs.append(el('rect', { x, y, width: Math.max(0, w), height: Math.max(0, h) }));
    svg.append(defs);
    const group = el('g', { 'clip-path': `url(#${id})` });
    svg.append(group);
    return group;
  }

  /* -------------------------------------------------- 1. timeline durasi */

  function renderTimeline(container, rows) {
    const data = rows
      .filter((r) => r.total != null)
      .sort((a, b) => a.total - b.total);

    if (!data.length) return empty(container, 'Belum ada model yang selesai diuji.');

    const sig = data.map((d) => `${d.model}|${d.total}|${d.ttft}`).join(';');
    const st = viewState(container, sig, { key: 'timeline', invertY: false });
    const maxX = Math.max(1, ...data.map((d) => d.total));

    const rowH = 32;
    const top = 30;
    const bottom = 24;
    const height = top + data.length * rowH + bottom;
    const barH = 15;

    const paint = () => {
      mount(container, height, (svg, width) => {
        const labelW = Math.min(230, Math.max(96, width * 0.28));
        const valueW = 74;
        const padL = labelW;
        const plotW = Math.max(50, width - labelW - valueW - 4);
        const yTop = top - 8;
        const yBottom = top + data.length * rowH - 8;

        st.limit = { x0: 0, x1: maxX, y0: null, y1: null };
        st.keys = new Set(data.map(keyOf));
        const v = ensureView(st);
        st.sx = plotW / (v.x1 - v.x0 || 1);
        st.sy = 0;
        st.plot = { x: padL, y: yTop, w: plotW, h: yBottom - yTop };
        st.paintWidth = width;

        const x = (val) => padL + (val - v.x0) * st.sx;

        // legenda
        svg.append(
          el('rect', { x: padL, y: 6, width: 9, height: 9, rx: 2, fill: C.ttft }),
          el('text', { x: padL + 15, y: 14.5, fill: C.text, 'font-size': 10.5 }, 'TTFT'),
          el('rect', { x: padL + 58, y: 6, width: 9, height: 9, rx: 2, fill: C.gen }),
          el('text', { x: padL + 73, y: 14.5, fill: C.text, 'font-size': 10.5 }, 'Waktu generasi')
        );

        xAxis(svg, padL, plotW, v.x0, v.x1, yTop, yBottom, height, fmtMs);

        svg.append(
          el('line', { x1: padL, y1: yTop, x2: padL, y2: yBottom, stroke: C.axis, 'stroke-width': 1 })
        );

        const bars = clippedGroup(svg, padL, 0, plotW, yBottom + 4);

        data.forEach((row, i) => {
          const key = keyOf(row);
          const y = top + i * rowH + 4;
          const ttft = Math.max(0, row.ttft || 0);
          const startX = x(ttft);
          const endX = x(row.total);

          svg.append(
            tagMark(
              el(
                'text',
                { x: 0, y: y + barH / 2 + 4, fill: C.strong, 'font-size': 11 },
                clip(row.model, Math.floor(labelW / 6.4))
              ),
              key
            )
          );

          // segmen waktu generasi (dasar) menggantikan sisa durasi
          if (endX - startX > 0.5) {
            bars.append(
              tagMark(
                el('rect', {
                  x: startX + (ttft > 0 ? 1 : 0),
                  y,
                  width: Math.max(0.5, endX - startX - (ttft > 0 ? 1 : 0)),
                  height: barH,
                  rx: 2,
                  fill: C.gen,
                }),
                key
              )
            );
          }

          // segmen TTFT
          if (ttft > 0 && startX - x(0) > 0.5) {
            bars.append(
              tagMark(
                el('rect', {
                  x: x(0),
                  y,
                  width: Math.max(0.5, startX - x(0)),
                  height: barH,
                  rx: 2,
                  fill: C.ttft,
                }),
                key
              )
            );
          }

          svg.append(
            tagMark(
              el(
                'text',
                {
                  x: width - 4,
                  y: y + barH / 2 + 4,
                  fill: C.strong,
                  'font-size': 11,
                  'text-anchor': 'end',
                },
                fmtMs(row.total)
              ),
              key
            )
          );

          // area sentuh satu baris penuh (di atas semuanya) untuk sorotan + tooltip
          svg.append(
            interactive(
              el('rect', {
                x: 0,
                y: top + i * rowH,
                width,
                height: rowH,
                rx: 3,
                fill: 'transparent',
                class: 'row-hit',
              }),
              key,
              row
            )
          );
        });
      });
      playEntrance(svg, st);
      applyHighlightIn(container);
    };

    st.refresh = paint;
    toolsFor(container);
    paint();
  }

  /* -------------------------------------------------------- 2. bar TPS */

  function renderTps(container, rows) {
    const data = rows.filter((r) => r.tps > 0).sort((a, b) => b.tps - a.tps);

    if (!data.length) return empty(container, 'TPS belum tersedia.');

    const sig = data.map((d) => `${d.model}|${d.tps}`).join(';');
    const st = viewState(container, sig, { key: 'tps', invertY: false });
    const maxX = Math.max(1, ...data.map((d) => d.tps));

    const rowH = 32;
    const top = 22;
    const bottom = 24;
    const height = top + data.length * rowH + bottom;
    const barH = 15;

    const paint = () => {
      mount(container, height, (svg, width) => {
        const labelW = Math.min(230, Math.max(96, width * 0.28));
        const valueW = 90;
        const padL = labelW;
        const plotW = Math.max(50, width - labelW - valueW - 4);
        const yTop = top - 8;
        const yBottom = top + data.length * rowH - 8;

        st.limit = { x0: 0, x1: maxX, y0: null, y1: null };
        st.keys = new Set(data.map(keyOf));
        const v = ensureView(st);
        st.sx = plotW / (v.x1 - v.x0 || 1);
        st.sy = 0;
        st.plot = { x: padL, y: yTop, w: plotW, h: yBottom - yTop };
        st.paintWidth = width;

        const x = (val) => padL + (val - v.x0) * st.sx;

        xAxis(svg, padL, plotW, v.x0, v.x1, yTop, yBottom, height, (n) => fmtNum(n));

        svg.append(
          el('line', { x1: padL, y1: yTop, x2: padL, y2: yBottom, stroke: C.axis, 'stroke-width': 1 })
        );

        const bars = clippedGroup(svg, padL, 0, plotW, yBottom + 4);

        data.forEach((row, i) => {
          const key = keyOf(row);
          const y = top + i * rowH + 4;
          const endX = x(row.tps);

          svg.append(
            tagMark(
              el(
                'text',
                { x: 0, y: y + barH / 2 + 4, fill: C.strong, 'font-size': 11 },
                clip(row.model, Math.floor(labelW / 6.4))
              ),
              key
            )
          );

          bars.append(
            tagMark(
              el('rect', {
                x: x(0),
                y,
                width: Math.max(1.5, endX - x(0)),
                height: barH,
                rx: 2,
                fill: C.gen,
              }),
              key
            )
          );

          svg.append(
            tagMark(
              el(
                'text',
                {
                  x: width - 4,
                  y: y + barH / 2 + 4,
                  fill: C.strong,
                  'font-size': 11,
                  'text-anchor': 'end',
                },
                `${row.estimated ? '~' : ''}${fmtNum(row.tps)} tok/s`
              ),
              key
            )
          );

          svg.append(
            interactive(
              el('rect', {
                x: 0,
                y: top + i * rowH,
                width,
                height: rowH,
                rx: 3,
                fill: 'transparent',
                class: 'row-hit',
              }),
              key,
              row
            )
          );
        });
      });
      playEntrance(svg, st);
      applyHighlightIn(container);
    };

    st.refresh = paint;
    toolsFor(container);
    paint();
  }

  /* -------------------------------------------- 3. sebaran TTFT x TPS */

  function renderScatter(container, rows) {
    const data = rows.filter((r) => r.ttft != null && r.tps > 0);

    if (!data.length) return empty(container, 'Butuh TTFT dan TPS untuk menggambar sebaran.');

    const sig = data.map((d) => `${d.model}|${d.ttft}|${d.tps}`).join(';');
    const st = viewState(container, sig, { key: 'scatter', invertY: true });
    const maxX = Math.max(1, ...data.map((d) => d.ttft)) * 1.18;
    const maxY = Math.max(0.1, ...data.map((d) => d.tps)) * 1.18;

    const plotBox = 300;
    const legendH = 12 + data.length * 18;
    const height = plotBox + legendH;

    const paint = () => {
      mount(container, height, (svg, width) => {
        const padL = Math.min(96, Math.max(56, width * 0.13));
        const padR = 26;
        const padT = 26;
        const padB = 42;
        const plotW = Math.max(60, width - padL - padR);
        const plotH = plotBox - padT - padB;

        st.limit = { x0: 0, x1: maxX, y0: 0, y1: maxY };
        st.keys = new Set(data.map(keyOf));
        const v = ensureView(st);
        st.sx = plotW / (v.x1 - v.x0 || 1);
        st.sy = plotH / (v.y1 - v.y0 || 1);
        st.plot = { x: padL, y: padT, w: plotW, h: plotH };
        st.paintWidth = width;

        const px = (val) => padL + ((val - v.x0) / (v.x1 - v.x0 || 1)) * plotW;
        const py = (val) => padT + plotH - ((val - v.y0) / (v.y1 - v.y0 || 1)) * plotH;

        // area "ideal" = TTFT rendah, TPS tinggi (relatif terhadap tampilan)
        svg.append(
          el('rect', {
            x: padL,
            y: padT,
            width: plotW / 2,
            height: plotH / 2,
            fill: C.ideal,
          })
        );
        svg.append(
          el(
            'text',
            {
              x: padL + 8,
              y: padT + 15,
              fill: C.gen,
              'font-size': 10,
              'letter-spacing': '0.08em',
            },
            'IDEAL'
          )
        );

        // grid + tick
        for (let i = 0; i <= 4; i += 1) {
          const gx = padL + (plotW / 4) * i;
          const gy = padT + (plotH / 4) * i;

          svg.append(
            el('line', { x1: gx, y1: padT, x2: gx, y2: padT + plotH, stroke: C.grid, 'stroke-width': 1 }),
            el('line', {
              x1: padL,
              y1: gy,
              x2: padL + plotW,
              y2: gy,
              stroke: C.grid,
              'stroke-width': 1,
            })
          );

          svg.append(
            el(
              'text',
              {
                x: gx,
                y: padT + plotH + 15,
                fill: C.dim,
                'font-size': 10,
                'text-anchor': 'middle',
              },
              fmtMs(v.x0 + ((v.x1 - v.x0) / 4) * i)
            ),
            el(
              'text',
              {
                x: padL - 8,
                y: gy + 3.5,
                fill: C.dim,
                'font-size': 10,
                'text-anchor': 'end',
              },
              fmtNum(v.y1 - ((v.y1 - v.y0) / 4) * i)
            )
          );
        }

        svg.append(
          el('line', {
            x1: padL,
            y1: padT + plotH,
            x2: padL + plotW,
            y2: padT + plotH,
            stroke: C.axis,
            'stroke-width': 1,
          }),
          el('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: C.axis, 'stroke-width': 1 })
        );

        // judul sumbu
        svg.append(
          el(
            'text',
            {
              x: padL + plotW / 2,
              y: plotBox - 15,
              fill: C.text,
              'font-size': 10.5,
              'text-anchor': 'middle',
            },
            'TTFT (makin kecil makin baik) →'
          ),
          el(
            'text',
            {
              x: 12,
              y: padT + plotH / 2,
              fill: C.text,
              'font-size': 10.5,
              'text-anchor': 'middle',
              transform: `rotate(-90 12 ${padT + plotH / 2})`,
            },
            'TPS'
          )
        );

        // titik model: penanda bernomor supaya label panjang tidak saling menumpuk
        const area = clippedGroup(svg, padL, padT, plotW, plotH);
        const pts = data.map((row, i) => ({ row, i, x: px(row.ttft), y: py(row.tps) }));

        // Model dengan TTFT/TPS nyaris sama akan berimpit: geser sedikit supaya
        // nomor penanda tetap terbaca, lalu tarik garis tipis ke posisi aslinya.
        const minDist = 22;
        for (let pass = 0; pass < 80; pass += 1) {
          let moved = false;
          for (let a = 0; a < pts.length; a += 1) {
            for (let b = a + 1; b < pts.length; b += 1) {
              const p = pts[a];
              const q = pts[b];
              let dx = q.x - p.x;
              let dy = q.y - p.y;
              let d = Math.hypot(dx, dy);
              if (d >= minDist) continue;
              if (d < 0.01) {
                dx = 1;
                dy = -0.58;
                d = Math.hypot(dx, dy);
              }
              const push = (minDist - d) / 2;
              p.x -= (dx / d) * push;
              p.y -= (dy / d) * push;
              q.x += (dx / d) * push;
              q.y += (dy / d) * push;
              moved = true;
            }
          }
          if (!moved) break;
        }

        pts.forEach((p) => {
          const anchorX = px(p.row.ttft);
          const anchorY = py(p.row.tps);
          const inside =
            anchorX >= padL &&
            anchorX <= padL + plotW &&
            anchorY >= padT &&
            anchorY <= padT + plotH;

          if (inside) {
            p.x = clampNum(p.x, padL + 11, padL + plotW - 11);
            p.y = clampNum(p.y, padT + 11, padT + plotH - 11);
          }

          if (Math.hypot(p.x - anchorX, p.y - anchorY) > 1.5) {
            area.append(
              tagMark(
                el('line', {
                  x1: anchorX,
                  y1: anchorY,
                  x2: p.x,
                  y2: p.y,
                  stroke: C.gen,
                  'stroke-width': 1,
                  'stroke-opacity': 0.45,
                }),
                keyOf(p.row)
              )
            );
          }
        });

        pts.forEach((p) => {
          const key = keyOf(p.row);
          const group = tagMark(el('g', {}), key);

          group.append(
            el('circle', { cx: p.x, cy: p.y, r: 9, fill: '#12161b', stroke: C.gen, 'stroke-width': 1.5 }),
            el(
              'text',
              {
                x: p.x,
                y: p.y + 3.4,
                fill: C.gen,
                'font-size': 9.5,
                'font-weight': 600,
                'text-anchor': 'middle',
              },
              String(p.i + 1)
            )
          );

          // area sentuh lebih besar supaya penanda kecil tetap mudah ditunjuk
          group.append(
            interactive(el('circle', { cx: p.x, cy: p.y, r: 15, fill: 'transparent' }), key, p.row)
          );

          area.append(group);
        });

        // legenda nama model di bawah grafik (hover menyorot, klik menyematkan)
        const legendX = 14;
        const modelMax = Math.max(10, Math.floor((width - 40) / 6.1) - 26);

        data.forEach((row, i) => {
          const key = keyOf(row);
          const ly = plotBox + 16 + i * 18;
          const cy = ly - 4;

          const group = pinnable(tagMark(el('g', {}), key), key);

          group.append(
            el('circle', { cx: legendX, cy, r: 8, fill: '#12161b', stroke: C.gen, 'stroke-width': 1.3 }),
            el(
              'text',
              {
                x: legendX,
                y: cy + 3.2,
                fill: C.gen,
                'font-size': 9,
                'font-weight': 600,
                'text-anchor': 'middle',
              },
              String(i + 1)
            ),
            el(
              'text',
              {
                x: legendX + 14,
                y: ly,
                fill: C.text,
                'font-size': 11,
              },
              `${clip(row.model, modelMax)} · TTFT ${fmtMs(row.ttft)} · ${fmtNum(row.tps)} tok/s`
            ),
            interactive(
              el('rect', {
                x: 0,
                y: cy - 9,
                width,
                height: 18,
                rx: 3,
                fill: 'transparent',
                class: 'row-hit',
              }),
              key,
              row
            )
          );

          svg.append(group);
        });
      });
      playEntrance(svg, st);
      applyHighlightIn(container);
    };

    st.refresh = paint;
    toolsFor(container);
    paint();
  }

  /* -------------------------------------- 4. sebaran antar-ulangan (N×) */

  /** Kuantil dengan interpolasi linier pada deret yang sudah terurut. */
  function quantile(sorted, q) {
    const n = sorted.length;
    if (!n) return null;
    if (n === 1) return sorted[0];
    const pos = (n - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** Ringkasan lima angka + pencilan (aturan pagar 1,5×IQR) untuk satu metrik. */
  function boxStats(values) {
    const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;

    const q1 = quantile(v, 0.25);
    const median = quantile(v, 0.5);
    const q3 = quantile(v, 0.75);
    const iqr = q3 - q1;
    const inside = v.filter((x) => x >= q1 - 1.5 * iqr && x <= q3 + 1.5 * iqr);

    return {
      n: v.length,
      min: inside.length ? inside[0] : v[0],
      max: inside.length ? inside[inside.length - 1] : v[v.length - 1],
      q1,
      median,
      q3,
      outliers: v.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr),
    };
  }

  const BOX_METRICS = {
    tps: { label: 'TPS', format: (v) => `${fmtNum(v)} tok/s` },
    ttft: { label: 'TTFT', format: fmtMs },
    total: { label: 'total durasi', format: fmtMs },
    e2e: { label: 'E2E', format: fmtMs },
  };

  /**
   * Kotak-garis sebaran nilai antar-ulangan untuk satu metrik. Satu baris per
   * model: kotak = Q1–Q3, garis terang = median, ekor = min–maks dalam
   * 1,5×IQR, dan titik merah = pencilan di luar pagar tersebut.
   */
  function renderBoxplot(container, rows, metric) {
    const key = BOX_METRICS[metric] ? metric : 'tps';
    const spec = BOX_METRICS[key];
    const asc = key !== 'tps';

    const data = rows
      .map((row) => ({ row, stats: boxStats(((row.samples || {})[key]) || []) }))
      .filter((d) => d.stats)
      .sort((a, b) => (asc ? a.stats.median - b.stats.median : b.stats.median - a.stats.median));

    if (!data.length) {
      return empty(container, 'Diagram sebaran muncul setelah model diuji lebih dari sekali (ulangi N× > 1).');
    }

    const sig = `${key}:` + data.map((d) => `${d.row.model}|${d.stats.n}|${d.stats.median}`).join(';');
    const st = viewState(container, sig, { key: `box:${key}`, invertY: false });
    const maxX = Math.max(1e-6, ...data.map((d) => d.stats.max)) * 1.06;

    const rowH = 34;
    const top = 34;
    const bottom = 24;
    const height = top + data.length * rowH + bottom;
    const boxH = 18;

    const paint = () => {
      mount(container, height, (svg, width) => {
        const labelW = Math.min(210, Math.max(96, width * 0.26));
        const valueW = 104;
        const padL = labelW;
        const plotW = Math.max(50, width - labelW - valueW - 4);
        const yTop = top - 8;
        const yBottom = top + data.length * rowH - 8;

        st.limit = { x0: 0, x1: maxX, y0: null, y1: null };
        st.keys = new Set(data.map((d) => keyOf(d.row)));
        const v = ensureView(st);
        st.sx = plotW / (v.x1 - v.x0 || 1);
        st.sy = 0;
        st.plot = { x: padL, y: yTop, w: plotW, h: yBottom - yTop };
        st.paintWidth = width;

        const x = (val) => padL + (val - v.x0) * st.sx;
        const visible = (val) => val >= v.x0 && val <= v.x1;

        svg.append(
          el(
            'text',
            { x: 0, y: 13, fill: C.text, 'font-size': 10.5 },
            `Sebaran ${spec.label} antar-ulangan · kotak = Q1–Q3 · garis = median · titik = pencilan`
          )
        );

        xAxis(svg, padL, plotW, v.x0, v.x1, yTop, yBottom, height, spec.format);

        svg.append(
          el('line', { x1: padL, y1: yTop, x2: padL, y2: yBottom, stroke: C.axis, 'stroke-width': 1 })
        );

        const area = clippedGroup(svg, padL, 0, plotW, yBottom + 4);

        data.forEach(({ row, stats }, i) => {
          const mk = keyOf(row);
          const cy = top + i * rowH + rowH / 2;
          const by = cy - boxH / 2;
          const bw = Math.max(0, x(stats.q3) - x(stats.q1));

          svg.append(
            tagMark(
              el(
                'text',
                { x: 0, y: cy + 4, fill: C.strong, 'font-size': 11 },
                clip(row.model, Math.floor(labelW / 6.4))
              ),
              mk
            )
          );

          // ekor kiri & kanan beserta penanda ujungnya
          [
            [stats.min, stats.q1],
            [stats.q3, stats.max],
          ].forEach(([a, b]) => {
            if (!visible(a) && !visible(b)) return;
            area.append(
              tagMark(
                el('line', { x1: x(a), y1: cy, x2: x(b), y2: cy, stroke: C.whisk, 'stroke-width': 1.4 }),
                mk
              )
            );
            if (Math.abs(x(b) - x(a)) > 3) {
              area.append(
                tagMark(
                  el('line', {
                    x1: x(a),
                    y1: cy - 5,
                    x2: x(a),
                    y2: cy + 5,
                    stroke: C.whisk,
                    'stroke-width': 1.4,
                  }),
                  mk
                )
              );
            }
          });

          if (bw > 1.6) {
            area.append(
              tagMark(
                el('rect', {
                  x: x(stats.q1),
                  y: by,
                  width: bw,
                  height: boxH,
                  rx: 3,
                  fill: C.box,
                  stroke: C.gen,
                  'stroke-width': 1.2,
                }),
                mk
              )
            );
          }

          // Satu nilai (atau semua nilai sama) tidak punya kotak: tandai sebagai garis tunggal.
          area.append(
            tagMark(
              el('line', {
                x1: x(stats.median),
                y1: bw > 1.6 ? by : by + 3,
                x2: x(stats.median),
                y2: bw > 1.6 ? by + boxH : by + boxH - 3,
                stroke: bw > 1.6 ? C.strong : C.gen,
                'stroke-width': bw > 1.6 ? 2 : 2.4,
              }),
              mk
            )
          );

          stats.outliers.forEach((val) => {
            area.append(tagMark(el('circle', { cx: x(val), cy, r: 2.4, fill: C.outlier }), mk));
          });

          svg.append(
            tagMark(
              el(
                'text',
                {
                  x: width - 4,
                  y: cy + 4,
                  fill: C.strong,
                  'font-size': 11,
                  'text-anchor': 'end',
                },
                `${spec.format(stats.median)}${stats.n > 1 ? ` · ${stats.n}×` : ''}`
              ),
              mk
            )
          );

          svg.append(
            interactive(
              el('rect', {
                x: 0,
                y: top + i * rowH,
                width,
                height: rowH,
                rx: 3,
                fill: 'transparent',
                class: 'row-hit',
              }),
              mk,
              row
            )
          );
        });
      });
      playEntrance(svg, st);
      applyHighlightIn(container);
    };

    st.refresh = paint;
    toolsFor(container);
    paint();
  }

  /* ------------------------------------------- ekspor diagram SVG / PNG */

  /** Properti gaya yang harus dibekukan agar SVG tampil sama di luar halaman ini. */
  const EXPORT_PROPS = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'stroke-linecap',
    'stroke-linejoin',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'letter-spacing',
    'text-anchor',
    'dominant-baseline',
    'paint-order',
    'visibility',
    'display',
  ];

  /** Salin gaya terhitung ke atribut style pada klon, karena CSS luar tidak ikut terbawa. */
  function inlineStyles(source, target) {
    if (source.nodeType === 1) {
      const computed = getComputedStyle(source);
      let css = '';
      for (const prop of EXPORT_PROPS) {
        const value = computed.getPropertyValue(prop);
        if (value) css += `${prop}:${value};`;
      }
      if (css) target.setAttribute('style', css);
    }
    const kids = source.childNodes;
    const clones = target.childNodes;
    for (let i = 0; i < kids.length; i += 1) {
      if (clones[i]) inlineStyles(kids[i], clones[i]);
    }
  }

  /**
   * SVG mandiri: gaya dibekukan, ukuran eksplisit, dan latar gelap ditambahkan
   * supaya bisa diunduh sendiri atau disematkan di laporan HTML.
   */
  function snapshot(container) {
    const svg = container.querySelector('svg.chart-svg');
    if (!svg) return null;

    clearHighlight();
    const clone = svg.cloneNode(true);
    inlineStyles(svg, clone);

    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const width = Math.round(viewBox[2] || svg.getBoundingClientRect().width || 640);
    const height = Math.round(viewBox[3] || 320);

    clone.setAttribute('xmlns', NS);
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.removeAttribute('class');
    clone.insertBefore(el('rect', { x: 0, y: 0, width, height, fill: canvasColor }), clone.firstChild);

    return { markup: new XMLSerializer().serializeToString(clone), width, height };
  }

  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  };

  const slug = (text) =>
    String(text || 'diagram')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'diagram';

  function downloadBlob(name, data, mime) {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function figureName(container) {
    const fig = figureOf(container);
    const node = fig && fig.querySelector('.chart-title');
    return node ? node.textContent : 'diagram';
  }

  function saveSvg(container) {
    const shot = snapshot(container);
    if (!shot) return;
    downloadBlob(`${slug(figureName(container))}-${stamp()}.svg`, shot.markup, 'image/svg+xml;charset=utf-8');
  }

  /** PNG dari SVG: digambar lewat canvas dengan skala 2× agar tetap tajam. */
  function savePng(container) {
    const shot = snapshot(container);
    if (!shot) return;

    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(shot.width * scale);
      canvas.height = Math.round(shot.height * scale);

      const ctx = canvas.getContext('2d');
      ctx.fillStyle = canvasColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (blob) downloadBlob(`${slug(figureName(container))}-${stamp()}.png`, blob, 'image/png');
      }, 'image/png');
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(shot.markup)}`;
  }

  /* -------------------------------------------------- kendali dari luar */

  /**
   * Sorot satu model dari luar diagram (mis. klik kartu peringkat).
   * Panggil dengan null untuk melepas sorotan. Mengembalikan model yang tersemat.
   */
  function pinModel(model) {
    if (model == null) {
      hovered = null;
      pinned = null;
      hideTip();
      applyHighlight();
      notifyPin();
      return null;
    }
    const key = String(model);
    pinned = pinned === key ? null : key;
    hovered = null;
    hideTip();
    applyHighlight();
    notifyPin();
    return pinned;
  }

  /** Kembalikan semua diagram ke skala awal (pintasan R). */
  function resetView() {
    charts.forEach((container) => {
      const st = container.__view;
      if (!st) return;
      st.view = null;
      if (st.refresh) st.refresh();
    });
  }

  window.ModelCharts = {
    renderTimeline,
    renderTps,
    renderScatter,
    renderBoxplot,
    snapshot,
    resetView,
    pinModel,
    refreshPalette: readPalette,
    /** Daftarkan penerima kabar saat sorotan tersemat berubah. */
    onPinChange: (fn) => {
      pinListener = typeof fn === 'function' ? fn : null;
    },
  };
})();
