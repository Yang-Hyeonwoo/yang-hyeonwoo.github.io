/* Shared behaviour: header, data loading/saving, plan checks, charts, and one render function per page.
   Data lives in /data/*.json. Reading is public. Writing goes through the GitHub contents API with a
   token the owner pastes into this browser (kept in localStorage, never sent anywhere but api.github.com). */
(() => {
  const CFG = { owner: 'Yang-Hyeonwoo', repo: 'yang-hyeonwoo.github.io', branch: 'main', research: 'https://yang-hyeonwoo.github.io/why-ions-compute/' };
  const ROOT = document.body.dataset.root || './';
  const PAGE = document.body.dataset.page || '';
  const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const KEY = 'site.gh';
  const VERSION = '1126q';   // same value as version.txt and the ?v= on the pages; tools/bump.py changes all three

  // ---------- small helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const KO = ['일', '월', '화', '수', '목', '금', '토'];
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], NTH = ['1st', '2nd', '3rd', '4th', '5th'];
  // "Nov 4th": the week (given its Monday) belongs to the month its Thursday falls in, same rule as the plan's "11월 넷째 주"
  const weekLabel = (mon) => { const thu = addDays(mon, 3); return `${MON[thu.getMonth()]} ${NTH[Math.floor((thu.getDate() - 1) / 7)]}`; };
  const NOW = new Date(); const TODAY = iso(NOW);
  const mins = (s) => { if (!s) return null; const [a, b] = String(s).split(':').map(Number); return Number.isFinite(a) ? a * 60 + (b || 0) : null; };
  const hm = (m) => { if (m == null) return ''; const t = Math.round(m); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };
  const n0 = (v) => (v == null || v === '' ? '–' : Number(v).toLocaleString('en-US'));
  const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

  // ---------- storage ----------
  const token = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
  const canWrite = () => !!token() || LOCAL;
  const api = (name) => `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/data/${name}.json`;
  const enc = (str) => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
  async function remote(name) {
    const r = await fetch(`${api(name)}?ref=${CFG.branch}`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const j = await r.json();
    return { sha: j.sha, data: JSON.parse(dec(j.content)) };
  }
  async function fresh(name) {
    if (token()) { try { return (await remote(name)).data; } catch (e) { console.warn('fresh read failed, using published copy', e); } }
    if (LOCAL) { try { const l = localStorage.getItem('preview.' + name); if (l) return JSON.parse(l); } catch { /* ignore */ } }
    const r = await fetch(`${ROOT}data/${name}.json?v=${Date.now()}`);
    if (!r.ok) throw new Error(`${name}.json ${r.status}`);
    return r.json();
  }
  // Pages draw from the copy this browser kept from last time, so a tab appears at once. The fresh copy is
  // fetched meanwhile; if it turns out different, the page is drawn again with it (see the end of this file).
  const CACHE = 'cache.v1.'; const pending = []; let settled = false;
  const cacheGet = (name) => { try { const t = localStorage.getItem(CACHE + name); return t ? JSON.parse(t) : null; } catch { return null; } };
  const cachePut = (name, data) => { try { localStorage.setItem(CACHE + name, JSON.stringify(data)); } catch { /* storage full or blocked: just slower */ } };
  async function load(name) {
    const kept = cacheGet(name);
    if (kept && settled) return kept;
    if (kept) {
      pending.push(fresh(name).then((d) => { const changed = JSON.stringify(d) !== JSON.stringify(kept); if (changed) cachePut(name, d); return changed; }).catch(() => false));
      return kept;
    }
    const d = await fresh(name); cachePut(name, d); return d;
  }
  async function save(name, mutate, message) {
    if (!token()) {
      if (!LOCAL) throw new Error('입력 설정에서 토큰을 먼저 넣어주세요.');
      const cur = await load(name); const next = mutate(cur) || cur;
      localStorage.setItem('preview.' + name, JSON.stringify(next)); cachePut(name, next); return next;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data } = await remote(name);
      const next = mutate(data) || data;
      const r = await fetch(api(name), { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({ message, branch: CFG.branch, sha, content: enc(JSON.stringify(next, null, 1) + '\n') }) });
      if (r.ok) { cachePut(name, next); return next; }
      if (r.status !== 409) throw new Error(r.status === 401 || r.status === 403 ? '토큰이 맞지 않거나 권한이 없어요.' : `저장 실패 (GitHub ${r.status})`);
    }
    throw new Error('저장이 겹쳤어요. 다시 시도해주세요.');
  }

  // ---------- header + settings ----------
  function chrome() {
    // The hub only has the two doors. Inside Training the header becomes that section's own menu, with a way back.
    const t = (p) => (PAGE === p ? ' class="on" aria-current="page"' : '');
    const sub = PAGE !== 'hub';
    document.body.prepend(el(sub ? `<header class="site-head sub"><div class="wrap">
      <a class="brand" href="${ROOT}training/"><em>Training</em></a>
      <nav class="nav" aria-label="Training 메뉴">
        <a href="${ROOT}training/"${t('training')}>Home</a><a href="${ROOT}training/plan.html"${t('plan')}>Hyrox Plan</a>
        <a href="${ROOT}training/log.html"${t('log')}>Training Log</a><a href="${ROOT}training/records.html"${t('records')}>Daily Records</a>
      </nav>
      <a class="back" href="${ROOT}">← Main</a>
      <button class="icon-btn${token() ? ' ok' : ''}" id="keyBtn" type="button" aria-label="입력 설정" title="입력 설정">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3m-3 3 3 3m-6 0 2 2"/></svg>
      </button></div></header>` : `<header class="site-head"><div class="wrap">
      <a class="brand" href="${ROOT}">Hyeonwoo <em>Yang</em></a>
      <nav class="nav" aria-label="주 메뉴"><a href="${CFG.research}">Research</a><a href="${ROOT}training/">Training</a></nav></div></header>`));
    document.body.append(el(`<footer class="foot"><div class="wrap">© 2026 Hyeonwoo Yang · KAIST</div></footer>`));
    // fetch the other tabs ahead of time, so the first visit to each is as quick as a return visit
    ['', 'plan.html', 'log.html', 'records.html'].forEach((f) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = `${ROOT}training/${f}?v=${VERSION}`; document.head.append(l); });
    const here = $('.nav a.on'); if (here && here.scrollIntoView) here.scrollIntoView({ block: 'nearest', inline: 'center' });   // on a phone the menu scrolls sideways
    if (!sub) return;
    const dlg = el(`<dialog id="keyDlg"><h3>입력 설정</h3>
      <p class="note">이 사이트는 누구나 볼 수 있지만, 기록을 저장하려면 본인 확인용 GitHub 토큰이 필요해요. 토큰은 이 브라우저에만 저장돼요.</p>
      <ol><li>GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token</li>
      <li>Repository access: <b>${CFG.repo}</b> 하나만 선택</li><li>Permissions → Contents: <b>Read and write</b></li><li>만든 토큰을 아래에 붙여넣기</li></ol>
      <label class="note" for="keyIn">토큰</label><input class="in" id="keyIn" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…">
      <div class="form-foot"><button class="btn" id="keySave" type="button">저장</button><button class="btn line" id="keyDel" type="button">이 기기에서 지우기</button>
      <button class="btn line" id="keyClose" type="button">닫기</button></div><p class="note" id="keyMsg" style="margin-top:12px"></p></dialog>`);
    document.body.append(dlg);
    $('#keyBtn').onclick = () => { $('#keyMsg').textContent = token() ? '이 기기에 토큰이 저장되어 있어요.' : ''; dlg.showModal(); };
    $('#keyClose').onclick = () => dlg.close();
    $('#keyDel').onclick = () => { localStorage.removeItem(KEY); location.reload(); };
    $('#keySave').onclick = () => { const v = $('#keyIn').value.trim(); if (!v) return; localStorage.setItem(KEY, v); location.reload(); };
  }

  // ---------- sessions: three kinds, Hyrox / Running / Weight ----------
  const HYROX = ['Functional Training', 'Hyrox Double', 'Hyrox Single', 'Strength', 'Interval', 'Open Gym', 'Simulation', 'Test', 'Hyrox Training', 'Race'];
  const RUNS = ['Run commute', 'Jogging', 'Easy run', 'Tempo run', 'Interval run', 'Long run', 'Uphill training', 'Recovery run', 'Time trial', 'Trail run', 'Run'];
  const SESSIONS = [...HYROX.slice(0, 9), ...RUNS, 'Weight Training', 'Core', 'Cardio', 'Race'];
  const FORMATS = ['AMRAP', 'For Time', 'EMOM', 'Timed Sets', 'Interval', 'Chipper', 'Strength', 'Steady', 'Upper Body', 'Lower Body', 'Full Body'];
  const isRun = (e) => RUNS.includes(e.session);
  const kindOf = (e) => (HYROX.includes(e.session) ? 'hyrox' : isRun(e) ? 'run' : e.session === 'Weight Training' ? 'weights' : 'other');
  const KINDS = [{ k: 'hyrox', name: 'Hyrox', color: '#2b59c3' }, { k: 'run', name: 'Running', color: '#2a9d8f' }, { k: 'weights', name: 'Weight', color: '#d9731a' }];   // checked for colour-blind separation
  // The log entry that makes a plan item count as done (none = not done yet).
  function doneEntry(item, date, log) {
    const es = log.filter((e) => e.date === date);
    if (item.k === 'hyrox') return es.find((e) => HYROX.includes(e.session));
    if (item.k === 'run' || item.k === 'commute') return es.find(isRun);
    if (item.k === 'weights') return es.find((e) => e.session === 'Weight Training');
    if (item.k === 'core') return es.find((e) => e.session === 'Core' || /hanging|행잉|레이즈|toes/i.test(`${e.workout || ''} ${e.notes || ''} ${e.result || ''}`));
    return undefined;
  }
  const isDone = (item, date, log) => !!doneEntry(item, date, log);
  const KIND = { hyrox: 'Hyrox', commute: 'Run', run: 'Run', weights: 'Weight', core: 'Core', rest: 'Rest', free: 'Free' };
  const doneChip = '<span class="chip g">완료</span>';
  const doneMark = '<span class="ok" aria-label="완료">✓</span>';

  // ---------- sums ----------
  const runSum = (log, a, b) => { const r = log.filter((e) => e.date >= a && e.date <= b && isRun(e)); return { n: r.length, km: r.reduce((s, e) => s + (Number(e.km) || 0), 0) }; };
  const weekRun = (mon, plan, log) => ({ km: runSum(log, iso(mon), iso(addDays(mon, 6))).km, meta: plan.weeks.find((w) => w.start === iso(mon)) });
  const hyroxCount = (log, a, b) => log.filter((e) => e.date >= a && e.date <= b && HYROX.includes(e.session)).length;
  const live = (arr) => arr.filter((e) => !e.deleted);   // a deleted entry stays in the file, flagged: that is the trash can
  const avgOf = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  // A run always reads the same way: distance, pace, then a few words on how it went (full adds the kind and the time).
  const briefOf = (e) => e.brief || String(e.notes || '').split('\n')[0].slice(0, 28);
  const runText = (e, full) => [full && e.session, e.km ? `${Number(e.km).toFixed(1)}km` : '', e.pace ? `${e.pace}/km` : '', full && e.minutes != null ? durText(e.minutes) : '', briefOf(e)].filter(Boolean).join(' · ') || e.session;
  // One record per date: the daily row plus what was trained that day, by kind, as short text.
  function dayIndex(daily, log) {
    const ix = {}; const at = (d) => (ix[d] = ix[d] || { date: d, rec: null, log: [] });
    daily.forEach((r) => { at(r.date).rec = r; });
    log.forEach((e) => { at(e.date).log.push(e); });
    Object.values(ix).forEach((x) => { const of = (k) => x.log.filter((e) => kindOf(e) === k);
      x.hyrox = of('hyrox').map((e) => (e.session === 'Hyrox Training' || e.session === 'Race' ? e.workout || e.session : e.session)).join(', ');
      x.run = of('run').map((e) => runText(e)).join(' + '); x.runFull = of('run').map((e) => runText(e, true)).join(' + ');
      x.weights = of('weights').map((e) => e.format || 'Weight').join(', ');
      x.etc = x.log.filter((e) => e.session === 'Cardio').map((e) => e.workout || 'Cardio').join(', ');
      x.any = !!(x.hyrox || x.run || x.weights || x.etc); });
    return ix;
  }

  // ---------- charts ----------
  // Small monthly charts print their values on the marks (o.labels), like the old spreadsheet; every chart also has a hover tooltip.
  const vl = (x, y, t, anchor = 'middle') => `<text class="vl" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${t}</text>`;
  // Line with a dot on every point. o.labels prints values on the dots (thinned out when there are many), o.area tints the area under the line.
  function lineChart(box, pts, o) {
    const W = o.w || 520, H = o.h || 170, L = 36, R = 14, T = o.labels ? 24 : 12, B = 22; const xf = o.xfmt || md; const color = o.color || '#2b59c3';
    if (pts.length < 2) { box.innerHTML = '<p class="note">기록이 더 쌓이면 그래프가 보여요.</p>'; return; }
    const xs = pts.map((p) => p.x.getTime()), ys = pts.map((p) => p.y); const n = pts.length;
    let lo = Math.min(...ys, o.target ?? Infinity), hi = Math.max(...ys, o.target ?? -Infinity);
    const padY = (hi - lo || 1) * 0.15; lo -= padY * (o.area ? 2 : 1); hi += padY;
    const D = o.domain; const slot = D ? (W - L - R) / D.n : 0;     // with a domain, week i sits at the centre of slot i, exactly where barChart puts bar i
    const X = D ? (t) => L + (Math.round((t - D.start.getTime()) / (7 * 864e5)) + 0.5) * slot : (t) => L + ((t - xs[0]) / (xs[n - 1] - xs[0] || 1)) * (W - L - R);
    const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
    const grid = [0, 0.5, 1].map((f) => { const v = Math.min(...ys) + f * (Math.max(...ys) - Math.min(...ys) || 1); return `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,.06)"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${o.fmt(v)}</text>`; }).join('');
    const every = o.labels ? (o.every || Math.ceil(n / Math.floor((W - 50) / 40))) : 0; const on = (i) => every && (n - 1 - i) % every === 0;
    const xe = o.labels ? Math.max(every, Math.ceil(n / Math.floor((W - 50) / 80))) : 0;
    const idx = o.labels ? pts.map((_, i) => i).filter((i) => (n - 1 - i) % xe === 0) : n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
    const anchor = (i) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle');
    const xl = D ? Array.from({ length: D.n }, (_, i) => i).filter((i) => (D.n - 1 - i) % Math.ceil(D.n / 6) === 0).map((i) => `<text class="ax" x="${L + (i + 0.5) * slot}" y="${H - 4}" text-anchor="middle">${xf(addDays(D.start, 7 * i))}</text>`).join('')
      : idx.map((i) => `<text class="ax" x="${X(xs[i])}" y="${H - 4}" text-anchor="${anchor(i)}">${xf(pts[i].x)}</text>`).join('');
    const tgt = o.target == null ? '' : `<line x1="${L}" x2="${W - R}" y1="${Y(o.target)}" y2="${Y(o.target)}" stroke="#a1a1a6" stroke-dasharray="3 4"/><text class="ax" x="${W - R}" y="${Y(o.target) + (Y(pts[n - 1].y) < Y(o.target) && Y(o.target) - Y(pts[n - 1].y) < 30 ? 13 : -6)}" text-anchor="end">목표 ${o.fmt(o.target)}</text>`;
    const gid = `g${Math.random().toString(36).slice(2, 8)}`;
    const area = o.area ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".24"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${path} L${X(xs[n - 1]).toFixed(1)} ${H - B} L${X(xs[0]).toFixed(1)} ${H - B} Z" fill="url(#${gid})"/>` : '';
    const dots = o.labels ? pts.map((p, i) => `<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${i === n - 1 ? 5 : 3.5}" fill="${i === n - 1 ? color : '#fff'}" stroke="${i === n - 1 ? '#fff' : color}" stroke-width="2"/>${on(i) ? vl(X(xs[i]), Y(p.y) - 10, o.fmt(p.y), anchor(i)) : ''}`).join('')
      : `<circle cx="${X(xs[n - 1])}" cy="${Y(pts[n - 1].y)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="2"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${grid}${tgt}${xl}${area}
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>${dots}
      <g class="hv" style="display:none"><line y1="${T}" y2="${H - B}" stroke="rgba(0,0,0,.18)"/><circle r="5.5" fill="${color}" stroke="#fff" stroke-width="2"/></g>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/></svg><div class="tip"></div>`;
    const svg = $('svg', box), hv = $('.hv', box), tip = $('.tip', box);
    const move = (ev) => {
      const r = svg.getBoundingClientRect(); const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
      let bi = 0, bd = 1e9; xs.forEach((t, i) => { const dd = Math.abs(X(t) - px); if (dd < bd) { bd = dd; bi = i; } });
      const cx = X(xs[bi]), cy = Y(pts[bi].y);
      hv.style.display = ''; $('line', hv).setAttribute('x1', cx); $('line', hv).setAttribute('x2', cx); $('circle', hv).setAttribute('cx', cx); $('circle', hv).setAttribute('cy', cy);
      tip.innerHTML = `${pts[bi].tip || xf(pts[bi].x)} · <b>${o.fmt(pts[bi].y)}</b>${o.unit || ''}${pts[bi].n ? ` · ${pts[bi].n}일 기록` : ''}`; tip.style.left = `${Math.min(84, Math.max(16, cx / W * 100))}%`; tip.style.top = `${cy / H * r.height}px`; tip.style.opacity = 1;
    };
    const out = () => { hv.style.display = 'none'; tip.style.opacity = 0; };
    svg.addEventListener('mousemove', move); svg.addEventListener('touchstart', move, { passive: true }); svg.addEventListener('touchmove', move, { passive: true }); svg.addEventListener('mouseleave', out);
  }
  // o.zoom = step: start the axis just under the smallest value, so small differences show (values are printed on the bars).
  function barChart(box, bars, o) {
    const W = 520, H = o.h || 170, L = 36, R = 14, T = o.labels ? 20 : 12, B = 22;
    const vals = bars.filter((b) => b.y > 0).map((b) => b.y); let base = 0, ticks;
    if (o.zoom && vals.length) { const st = o.zoom, mn = Math.min(...vals); base = Math.floor(mn / st) * st; if (mn - base < st * 0.2) base -= st; base = Math.max(0, base);
      const top = Math.ceil(Math.max(...vals) / st) * st; ticks = []; for (let v = base; v <= top; v += st) ticks.push(v);
    } else { const mx = Math.max(...bars.map((b) => Math.max(b.y, b.plan || 0)), 10); const p10 = 10 ** Math.floor(Math.log10(mx / 2)); const fr = mx / 2 / p10;
      const step = (fr <= 1 ? 1 : fr <= 1.5 ? 1.5 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * p10; ticks = [0, step, step * 2]; }
    const hi = ticks[ticks.length - 1] + (ticks[ticks.length - 1] - base) * 0.04;
    const bw = (W - L - R) / bars.length; const Y = (v) => T + (1 - (v - base) / (hi - base)) * (H - T - B);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,.06)"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${o.fmt ? o.fmt(v) : v}</text>`).join('');
    const marks = bars.map((b, i) => { const pad = Math.min(8, bw * 0.16), x = L + i * bw + pad, w = Math.max(bw - 2 * pad, 2), y = Y(b.y), hgt = H - B - y, rr = Math.min(4, hgt, w / 2);
      const bar = b.y > 0 ? `<path d="M${x} ${H - B}V${y + rr}q0-${rr} ${rr}-${rr}h${w - 2 * rr}q${rr} 0 ${rr} ${rr}V${H - B}z" fill="${o.color || 'var(--accent)'}"/>${o.labels ? vl(x + w / 2, y - 4, o.vfmt ? o.vfmt(b.y) : b.y) : ''}` : '';
      const plan = b.plan ? `<line x1="${x - 2}" x2="${x + w + 2}" y1="${Y(b.plan)}" y2="${Y(b.plan)}" stroke="#111827" stroke-width="2"/>` : '';
      return `${bar}${plan}<rect data-i="${i}" x="${L + i * bw}" y="0" width="${bw}" height="${H - B}" fill="transparent"/>`; }).join('');
    const every = o.xevery || (o.labels ? 1 : Math.ceil(bars.length / 6));
    const xl = bars.map((b, i) => ((bars.length - 1 - i) % every === 0 ? `<text class="ax" x="${L + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${b.label}</text>` : '')).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${grid}${marks}${xl}</svg><div class="tip"></div>`;
    const tip = $('.tip', box);
    box.querySelectorAll('rect[data-i]').forEach((r) => {
      const b = bars[+r.dataset.i];
      const show = () => { tip.innerHTML = o.tip ? o.tip(b) : `${b.label} 주 · <b>${b.y.toFixed(1)}</b>km${b.plan ? ` (계획 ${b.plan}km)` : ''}`; tip.style.left = `${Math.min(85, Math.max(15, (L + (+r.dataset.i + 0.5) * bw) / W * 100))}%`; tip.style.top = `${Y(Math.max(b.y, b.plan || 0, base)) / H * box.offsetHeight}px`; tip.style.opacity = 1; };
      r.addEventListener('mouseenter', show); r.addEventListener('touchstart', show, { passive: true }); r.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
    });
  }
  // One bar per kind (Hyrox, Running, Weight) in each group. cats: [{ label, tip, v: [hyrox, run, weights] }]
  function kindChart(box, cats, o) {
    const W = 520, H = o.h || 170, L = 28, R = 12, T = 20, B = 22; const K = KINDS.length;
    const top = Math.max(2, Math.ceil(Math.max(...cats.map((c) => Math.max(...c.v))) / 2) * 2);
    const gw = (W - L - R) / cats.length, bw = Math.min(16, (gw - 8 - (K - 1) * 2) / K); const Y = (v) => T + (1 - v / top) * (H - T - B);
    const grid = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,.06)"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
    const bar = (x, v, color) => { if (!v) return ''; const y = Y(v), h = H - B - y, r = Math.min(3, h, bw / 2);
      return `<path d="M${x} ${H - B}V${y + r}q0-${r} ${r}-${r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${H - B}z" fill="${color}"/>${vl(x + bw / 2, y - 3, v)}`; };
    const marks = cats.map((c, i) => { const x0 = L + i * gw + (gw - K * bw - (K - 1) * 2) / 2;
      return `${c.v.map((v, k) => bar(x0 + k * (bw + 2), v, KINDS[k].color)).join('')}<rect data-i="${i}" x="${L + i * gw}" y="0" width="${gw}" height="${H - B}" fill="transparent"/>`; }).join('');
    const every = Math.ceil(cats.length / 7);
    const xl = cats.map((c, i) => ((cats.length - 1 - i) % every === 0 ? `<text class="ax" x="${L + i * gw + gw / 2}" y="${H - 4}" text-anchor="middle">${c.label}</text>` : '')).join('');
    box.innerHTML = `<div class="legend">${KINDS.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${grid}${marks}${xl}</svg><div class="tip"></div>`;
    const tip = $('.tip', box), svg = $('svg', box);
    box.querySelectorAll('rect[data-i]').forEach((r) => { const i = +r.dataset.i, c = cats[i];
      const show = () => { tip.innerHTML = `${c.tip || c.label} · ${KINDS.map((s, k) => `${s.name} <b>${c.v[k]}</b>`).join(' · ')}${o.unit}`; tip.style.left = `${Math.min(72, Math.max(28, (L + (i + 0.5) * gw) / W * 100))}%`;
        tip.style.top = `${svg.offsetTop + Y(Math.max(...c.v)) / H * svg.getBoundingClientRect().height - 8}px`; tip.style.opacity = 1; };
      r.addEventListener('mouseenter', show); r.addEventListener('touchstart', show, { passive: true }); r.addEventListener('mouseleave', () => { tip.style.opacity = 0; }); });
  }
  function rolling(daily, key, days, conv = (v) => v) {
    const from = iso(addDays(NOW, -days)); const rows = daily.filter((r) => r[key] != null && conv(r[key]) != null);
    const out = [];
    rows.forEach((r, i) => { if (r.date < from) return; const win = rows.slice(Math.max(0, i - 6), i + 1).filter((w) => (parse(r.date) - parse(w.date)) / 864e5 < 7);
      out.push({ x: parse(r.date), y: win.reduce((s, w) => s + conv(w[key]), 0) / win.length }); });
    return out;
  }

  // ---------- pages ----------
  function dday(plan) { return Math.ceil((parse(plan.race.date) - parse(TODAY)) / 864e5); }

  const ddayText = (n) => (n > 0 ? `D-${n}` : n === 0 ? 'D-Day' : `D+${-n}`);
  const MONTH0 = `${TODAY.slice(0, 8)}01`;

  async function hub() {
    const [plan, log, daily] = await Promise.all([load('plan'), load('log').then(live), load('daily')]);
    $('#hubDday').textContent = ddayText(dday(plan));
    $('#hubHyrox').textContent = `${hyroxCount(log, MONTH0, TODAY)}회`;
    $('#hubRun').textContent = `${runSum(log, MONTH0, TODAY).km.toFixed(1)} km`;
  }

  // durations: stored as minutes, typed as 37:54, shown as "37분 54초"; sleep shown as "6시간 47분"
  const hmHtml = (m) => { const t = Math.round(m); return `${Math.floor(t / 60)}<small>시간</small> ${t % 60}<small>분</small>`; };
  const durText = (min) => { const s = Math.round(min * 60); return s % 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s / 60}분`; };
  const durClock = (min) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const parseDur = (v) => { const t = String(v || '').trim(); if (!t) return null; if (!t.includes(':')) return numOrNull(t);
    const p = t.split(':').map(Number); if (p.length > 3 || p.some(Number.isNaN)) return null; return Math.round((p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60) * 100) / 100; };
  // which log session a plan item most likely becomes, so "기록" can open the form already filled in
  const HX = { 1: 'Functional Training', 2: 'Hyrox Double', 4: 'Interval', 5: 'Hyrox Single' };
  function sessionFor(it, d) {
    if (it.k === 'hyrox') return HX[parse(d).getDay()] || 'Functional Training';
    if (it.k === 'commute') return 'Run commute';
    if (it.k === 'weights') return 'Weight Training~Upper Body';
    if (it.k === 'run') return /기록 측정/.test(it.t) ? 'Time trial' : /조깅/.test(it.t) && !/세트/.test(it.t) ? 'Jogging' : /연속/.test(it.t) ? 'Tempo run' : 'Interval run';
    return '';
  }

  // Today's check: a small round button to mark a session done, and the same mark filled in once it is.
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ckBtn = (i) => `<button class="ck" type="button" data-done="${i}" title="완료로 표시" aria-label="완료로 표시">${CHECK}</button>`;
  const ckOn = `<span class="ck on" role="img" aria-label="완료">${CHECK}</span>`;
  function todayCard(plan, log, daily) {
    const day = plan.days[TODAY]; const rec = daily.find((r) => r.date === TODAY) || {};
    // One tap marks a session done; distance, time and notes can be added later from "자세히".
    const row = (it, i) => { const m = /^(\d{1,2}:\d{2})\s*·?\s*(.*)$/.exec(it.d || ''); const de = doneEntry(it, TODAY, log); let act = '';
      if (de) act = `${it.k === 'core' && de.result ? `<span class="small num muted">${esc(de.result)}</span>` : ''}<a class="small" href="log.html#edit=${encodeURIComponent(de.id)}">자세히</a>${ckOn}`;
      else if (canWrite() && it.k === 'core') act = `<input class="in sm" data-reps inputmode="text" placeholder="12, 10, 8" aria-label="세트별 개수">${ckBtn(i)}`;
      else if (canWrite() && sessionFor(it, TODAY)) act = ckBtn(i);
      return `<div class="todo${it.key ? ' key' : ''}"><span class="kind">${m ? `<b class="num">${m[1]}</b>` : ''}${KIND[it.k] || ''}</span><div class="b"><div class="t">${esc(it.t)}</div><div class="d">${esc(m ? m[2] : it.d || '')}</div></div><div class="act">${act}</div></div>`; };
    const items = day ? day.items.map(row).join('') : '<p class="note">오늘은 정해진 계획이 없어요.</p>';
    const cell = (l, got, goal, unit) => `<div><div class="l">${l}</div><div class="v num">${n0(goal)}<small>${unit}</small></div><div class="s num">${got == null ? '아직 기록 전' : `기록 ${n0(got)}${unit}`}</div></div>`;
    const kv = day ? `<div class="kv">${cell('Calories', rec.kcal, day.kcal, 'kcal')}${cell('Carbs', rec.carb, day.carb, 'g')}${cell('Protein', rec.prot, day.prot, 'g')}${cell('Fat', rec.fat, day.fat, 'g')}</div>` : '';
    const slept = mins(rec.sleep);
    return `<div class="grid g2"><div class="plate today">
        <div class="chips">${day ? `<span class="chip a">${esc(day.week)}</span>` : ''}</div>
        <h3 class="date">${NOW.getMonth() + 1}월 ${NOW.getDate()}일 <em>${KO[NOW.getDay()]}요일</em></h3>${items}
        <div class="form-foot"><a class="btn" href="log.html#new">운동 기록</a><a class="btn line" href="records.html#new">식단 · 체중 기록</a></div></div>
      <div class="soft"><h3 style="font-size:.95rem;color:var(--ink);margin-bottom:12px">Today's Targets <span class="muted" style="font-weight:500">· 오늘 목표</span></h3>${kv}
      <div class="kv" style="margin-top:8px;grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="l">Bedtime · 오늘 취침</div><div class="v num">${plan.targets.bed}</div><div class="s">기상 ${plan.targets.wake} · ${plan.targets.sleep} 수면</div></div>
      <div><div class="l">Last night · 어젯밤 수면</div><div class="v num">${slept == null ? '–' : hmHtml(slept)}</div><div class="s num">${rec.bed ? `${rec.bed} → ${rec.wake || ''}` : '기록 없음'}</div></div></div></div></div>`;
  }
  // This week, one card per day. A day with training logged is tinted blue and stamped, so it reads at a glance.
  function weekStrip(mon, plan, log) {
    return `<div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const dt = addDays(mon, i), d = iso(dt), day = plan.days[d];
      const off = !day || day.items.every((it) => it.k === 'free' || it.k === 'rest');
      const did = log.filter((e) => e.date === d && kindOf(e) !== 'other'); const trained = did.length > 0;
      const its = off && trained ? did.map((e) => `<div class="it did">${doneMark}<span>${esc(e.session)}${e.km ? ` ${e.km}km` : ''}</span></div>`).join('')
        : day ? day.items.filter((it) => it.k !== 'core').map((it) => { const ok = isDone(it, d, log);
          return `<div class="it${it.opt || it.k === 'free' ? ' optional' : ''}${ok ? ' did' : ''}">${ok ? doneMark : ''}<span>${esc(it.t)}${it.opt && it.k !== 'free' ? ' (보너스)' : ''}</span></div>`; }).join('') : '';
      return `<div class="day${d === TODAY ? ' today' : ''}${trained ? ' done' : off ? ' off' : ''}"><div class="dn"><span>${KO[dt.getDay()]}</span>${trained ? '<i class="stamp">완료</i>' : ''}<b class="num">${dt.getDate()}</b></div><div>${its}</div></div>`; }).join('')}</div>`;
  }

  async function training() {
    const [plan, daily] = await Promise.all([load('plan'), load('daily')]); let log = await load('log').then(live);
    const cur = [...plan.roadmap].reverse().find((r) => r.from <= TODAY) || plan.roadmap[0];
    const wkNow = plan.weeks.find((w) => w.start === iso(monday(NOW)) && w.concept);
    $('#goals').innerHTML = `<div class="dday"><div class="count"><div class="t">${esc(plan.race.name)} · ${esc(plan.race.division)}</div><div class="n num">${ddayText(dday(plan)).replace('-', '<i class="dash"></i>')}</div>
      <div class="r"><span class="lbl">${wkNow ? '이번 주 목표' : '이번 달 테마'}</span>${esc(wkNow ? wkNow.concept : cur.theme)}<span>${esc(plan.race.date_note)}</span></div></div>
      <div class="grid g3">${plan.goals.map((g) => `<div class="goal"><div class="g">Goal · 목표</div><div class="l">${esc(g.label)}</div><div class="v num">${esc(g.value)}</div><div class="s">${esc(g.sub)}</div></div>`).join('')}</div></div>`;
    const mon = monday(NOW), m0 = iso(mon), mo = NOW.getMonth() + 1;
    const paint = () => {
      $('#today').innerHTML = todayCard(plan, log, daily);
      const s = weekRun(mon, plan, log); const wkRows = daily.filter((r) => r.date >= m0 && r.date <= TODAY);
      const wk = wkRows.map((r) => mins(r.sleep)).filter((v) => v != null), kc = wkRows.map((r) => r.kcal).filter((v) => v != null);
      const runM = runSum(log, MONTH0, TODAY);
      $('#weekSide').textContent = `${s.meta ? s.meta.label : ''} · ${md(mon)}–${md(addDays(mon, 6))}`;
      $('#week').innerHTML = `${weekStrip(mon, plan, log)}<div class="stats" style="margin:16px 0 0">
        <div class="stat"><div class="l">Hyrox Training · ${mo}월 합계</div><div class="v num">${hyroxCount(log, MONTH0, TODAY)}<small>회</small></div><div class="s num">이번 주 ${hyroxCount(log, m0, TODAY)}회</div></div>
        <div class="stat"><div class="l">Running · ${mo}월 합계</div><div class="v num">${runM.km.toFixed(1)}<small>km · ${runM.n}회</small></div><div class="s num">이번 주 ${s.km.toFixed(1)}km${s.meta ? ` · 기본 계획 ${s.meta.run_km}km` : ''}</div></div>
        <div class="stat"><div class="l">Sleep · 이번 주 평균</div><div class="v num">${wk.length ? hmHtml(avgOf(wk)) : '–'}</div><div class="s num">목표 ${plan.targets.sleep} · ${wk.length}일 기록</div></div>
        <div class="stat"><div class="l">Intake · 이번 주 평균</div><div class="v num">${kc.length ? Math.round(avgOf(kc)).toLocaleString('en-US') : '–'}<small>kcal</small></div><div class="s num">${kc.length}일 기록</div></div></div>`;
    };
    paint();
    $('#today').onclick = async (ev) => { const b = ev.target.closest('[data-done]'); if (!b) return;
      const it = plan.days[TODAY].items[+b.dataset.done]; const [session, format] = (it.k === 'core' ? 'Core' : sessionFor(it, TODAY)).split('~');
      const e = { id: `e${Date.now().toString(36)}`, date: TODAY, session }; if (format) e.format = format;
      if (it.k === 'core') { e.workout = '행잉 레그레이즈'; const reps = $('[data-reps]', b.parentElement).value.trim(); if (reps) e.result = reps; }
      b.disabled = true;
      try { log = live(await save('log', (arr) => { arr.push(e); arr.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)); return arr; }, `log: ${e.date} ${e.session}`)); paint(); }
      catch (err) { alert(err.message); b.disabled = false; } };
    // ---- Training / Nutrition / Recovery charts ----
    // The four weekly charts share one x-axis: the same weeks, in the same positions, with the same labels.
    const C = { weight: '#2b59c3', sleep: '#6b4fc8', kcal: '#d9731a', run: '#2a9d8f' };
    const firstDay = daily.length ? daily[0].date : TODAY; const firstMon = monday(parse(firstDay));
    const allWeeks = Math.round((mon - firstMon) / (7 * 864e5)) + 1;
    const draw = (nw) => {
      const ix = dayIndex(daily, log); const n = nw || allWeeks; const start = addDays(mon, -7 * (n - 1)); const wk = [];
      for (let i = 0; i < n; i++) { const m = addDays(start, 7 * i); const a = { m, w: [], s: [], k: [], tip: `${weekLabel(m)} (${md(m)}–${md(addDays(m, 6))})` };
        for (let j = 0; j < 7; j++) { const r = (ix[iso(addDays(m, j))] || {}).rec; if (!r) continue; if (r.weight != null) a.w.push(r.weight); const sm = mins(r.sleep); if (sm != null) a.s.push(sm / 60); if (r.kcal != null) a.k.push(r.kcal); }
        wk.push(a); }
      const ser = (key) => wk.filter((a) => a[key].length).map((a) => ({ x: a.m, y: avgOf(a[key]), n: a[key].length, tip: a.tip }));
      // headline: the latest weekly average, and how far it moved over the period (green when it moved the way the plan wants)
      const head = (id, pts, fmtBig, fmtDelta, unit, want) => { const el = $(id); if (!pts.length) { el.innerHTML = '–'; return; }
        const d = pts[pts.length - 1].y - pts[0].y; const cls = !want || Math.abs(d) < 1e-9 ? '' : d * want > 0 ? ' g' : ' w';
        el.innerHTML = `${fmtBig(pts[pts.length - 1].y)}${pts.length > 1 ? `<span class="chip${cls} num">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${fmtDelta(Math.abs(d))}${unit} · ${pts.length}주 사이</span>` : ''}`; };
      const kcal = (v) => Math.round(v).toLocaleString('en-US'); const w = ser('w'), sl = ser('s'), kc = ser('k');
      const opt = { labels: true, area: true, h: 200, xfmt: weekLabel, domain: { start, n } };
      head('#nowW', w, (v) => `${v.toFixed(1)}<small>kg</small>`, (v) => v.toFixed(1), 'kg', -1);
      head('#nowS', sl, (v) => hmHtml(v * 60), (v) => `${Math.round(v * 60)}`, '분', 1);
      head('#nowK', kc, (v) => `${kcal(v)}<small>kcal</small>`, kcal, 'kcal', 0);
      lineChart($('#chW'), w, { ...opt, label: '주 평균 체중', fmt: (v) => v.toFixed(1), unit: 'kg', color: C.weight });
      lineChart($('#chS'), sl, { ...opt, label: '주 평균 수면', fmt: (v) => hm(v * 60), target: mins(plan.targets.sleep) / 60, color: C.sleep });
      lineChart($('#chK'), kc, { ...opt, label: '주 평균 섭취 칼로리', fmt: kcal, unit: 'kcal', color: C.kcal });
      const bars = wk.map((a) => { const st = weekRun(a.m, plan, log); return { label: weekLabel(a.m), tipx: a.tip, y: st.km, plan: st.meta ? st.meta.run_km : 0 }; });
      const sum = bars.reduce((s, b) => s + b.y, 0);
      $('#nowR').innerHTML = `${sum.toFixed(0)}<small>km</small><span class="chip num">${bars.length}주 합계 · 이번 주 ${bars[bars.length - 1].y.toFixed(1)}km</span>`;
      barChart($('#chR'), bars, { label: '주간 러닝 거리', labels: bars.length <= 14, h: 200, color: C.run, xevery: Math.ceil(n / 6), vfmt: (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1)),
        tip: (b) => `${b.tipx} · <b>${b.y.toFixed(1)}</b>km${b.plan ? ` (기본 계획 ${b.plan}km)` : ''}` });
      // Training: days per month, by kind
      const by = {}; const KEYS = ['hyrox', 'run', 'weights'];
      Object.values(ix).forEach((x) => { const k = x.date.slice(0, 7); const a = (by[k] = by[k] || { ym: k, v: [0, 0, 0], any: 0, days: 0 }); KEYS.forEach((key, i) => { if (x[key]) a.v[i]++; }); if (x.any) a.any++; a.days++; });
      const thisYm = TODAY.slice(0, 7); const months = Object.values(by).filter((a) => a.days >= 7 || a.ym === thisYm).sort((a, b) => (a.ym < b.ym ? -1 : 1));
      $('#nowMD').innerHTML = `${(by[thisYm] || { any: 0 }).any}<small>일 · ${MON[NOW.getMonth()]} 운동한 날</small>`;
      kindChart($('#chMD'), months.map((a) => ({ label: MON[+a.ym.slice(5) - 1], v: a.v })), { label: '월별 운동한 날', unit: '일', h: 200 });
      // Recovery: the last four weeks in numbers
      const from = iso(addDays(NOW, -27)); const rec = daily.filter((r) => r.date >= from && r.date <= TODAY && mins(r.sleep) != null);
      const late = (t) => { const v = mins(t); return v == null ? null : v < 18 * 60 ? v + 1440 : v; };      // 1:30 counts as later than 23:30
      const beds = rec.map((r) => late(r.bed)).filter((v) => v != null), wakes = rec.map((r) => mins(r.wake)).filter((v) => v != null);
      const cell = (l, v, sub) => `<div><div class="l">${l}</div><div class="v num">${v}</div><div class="s num">${sub}</div></div>`;
      $('#recov').innerHTML = rec.length ? cell('평균 수면', hmHtml(avgOf(rec.map((r) => mins(r.sleep)))), `목표 ${plan.targets.sleep} · ${rec.length}일 기록`)
        + cell('목표만큼 잔 날', `${rec.filter((r) => mins(r.sleep) >= mins(plan.targets.sleep)).length}<small>일</small>`, `${rec.length}일 중`)
        + cell('평균 취침', beds.length ? hm(avgOf(beds) % 1440) : '–', `목표 ${plan.targets.bed}`)
        + cell('평균 기상', wakes.length ? hm(avgOf(wakes)) : '–', `목표 ${plan.targets.wake}`) : '<p class="note">최근 4주 수면 기록이 없어요.</p>';
    };
    draw(0);   // the whole record by default: the long view is the point of this section
    document.querySelectorAll('#range button').forEach((b) => { b.onclick = () => { document.querySelectorAll('#range button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(+b.dataset.w); }; });
    // races, newest first; the fastest result of each event gets a PB mark
    const secsOf = (t) => t.split(':').reduce((acc, v) => acc * 60 + Number(v), 0); const best = {};
    plan.races.forEach((r) => { const v = secsOf(r.result); if (best[r.event] == null || v < best[r.event]) best[r.event] = v; });
    $('#races').innerHTML = `<div class="scroll-x"><table class="t races"><thead><tr><th>Date</th><th>Race</th><th class="dev">Event</th><th class="pb"></th><th class="r">Result</th></tr></thead><tbody>${plan.races.map((r) => `<tr><td class="num" style="white-space:nowrap">${esc(r.date)}</td><td><b>${esc(r.name)}</b><div class="mev">${esc(r.event || '')}</div></td><td class="dev">${esc(r.event || '')}</td><td class="pb">${secsOf(r.result) === best[r.event] ? '<span class="chip a">PB</span>' : ''}</td><td class="r num res"><b>${esc(r.result)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function planPage() {
    const [plan, log] = await Promise.all([load('plan'), load('log').then(live)]);
    const thisMon = iso(monday(NOW));
    const phase = [...plan.roadmap].reverse().find((r) => r.from <= TODAY) || plan.roadmap[0];
    $('#road').innerHTML = `<div class="road" style="margin-top:0">${plan.roadmap.map((r) => `<div class="${r === phase ? 'now' : r.from < phase.from ? 'past' : ''}"><div class="m">${esc(r.m)}</div><div class="th">${esc(r.theme)}</div><div class="f">${esc(r.focus)}</div></div>`).join('')}</div>`;
    const raceMon = monday(parse(plan.race.date)); const totalWeeks = Math.round((raceMon - parse(plan.weeks[0].start)) / (7 * 864e5)) + 1;
    const nowNo = Math.round((monday(NOW) - parse(plan.weeks[0].start)) / (7 * 864e5)) + 1;
    $('#weekTotal').textContent = `대회 주까지 총 ${totalWeeks}주${nowNo >= 1 && nowNo <= totalWeeks ? ` · 지금 ${nowNo}주차` : ''}`;
    $('#weeks').innerHTML = plan.weeks.map((w, wi) => { const mon = parse(w.start);
      const tone = (it) => (it.k === 'hyrox' ? (/Functional/.test(it.t) ? 'fx' : /Double/.test(it.t) ? 'db' : /Single/.test(it.t) ? 'sg' : 'iv') : it.k === 'commute' || it.k === 'run' ? 'run' : it.k === 'weights' ? 'wt' : it.k);
      const li = (it, d) => `<li${it.k === 'free' || it.k === 'rest' ? ' class="quiet"' : ''}><b class="tone-${tone(it)}">${esc(it.t)}</b>${it.d ? ` <span class="why">(${esc(it.d)})</span>` : ''}${it.first ? ' <span class="chip w">첫 Hyrox Training</span>' : ''}${it.key ? ' <span class="chip a">핵심</span>' : ''}${isDone(it, d, log) ? ` ${doneChip}` : ''}</li>`;
      const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => { const dt = addDays(mon, i), d = iso(dt), day = plan.days[d];
        return `<tr><td class="num" style="white-space:nowrap"><b>${KO[dt.getDay()]}</b> <span class="muted">${md(dt)}</span></td><td><ul class="plan-items">${day.items.map((it) => li(it, d)).join('')}</ul></td><td class="r num" style="white-space:nowrap">${n0(day.kcal)} kcal<br><span class="small muted">탄 ${day.carb} · 단 ${day.prot} · 지 ${day.fat}</span></td></tr>`; }).join('');
      return `<section class="plate plan-week${w.start === thisMon ? ' now' : ''}" id="w-${w.start}"><div class="hd"><h3>${esc(w.label)}</h3><span class="chip dark num">${wi + 1}주차</span><span class="muted small num">${md(mon)}–${md(addDays(mon, 6))}</span>${w.recovery ? '<span class="chip w">회복 주</span>' : ''}${w.start === thisMon ? '<span class="chip a">이번 주</span>' : ''}
        <span class="small muted" style="margin-left:auto">러닝 기본 <b class="num" style="color:var(--ink)">${w.run_km}km</b> (${esc(w.run_note)})${w.bonus_km ? ` · 보너스 +${w.bonus_km}km` : ''}</span></div>
        ${w.concept ? `<p class="concept">${esc(w.concept)}</p>` : ''}
        <div class="scroll-x"><table class="t"><thead><tr><th style="width:5.5rem">Day</th><th>Training</th><th class="r" style="width:9.5rem">Nutrition</th></tr></thead><tbody>${rows}</tbody></table></div></section>`; }).join('');
    const now = document.getElementById(`w-${thisMon}`); if (now && location.hash === '#now') now.scrollIntoView();

    // Paces: the newest row is "now"; older rows stay behind the fold so the change over time is visible.
    const P = plan.paces || []; const cur = P[P.length - 1]; if (!cur) return;
    const secs = (s) => { const m = /(\d+):(\d+)/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
    const clock = (v) => `${Math.floor(v / 60)}:${pad(Math.round(v) % 60)}`;
    const lap = (s) => s.split('–').map((x) => secs(x)).filter((v) => v != null).map((v) => clock(Math.round(v * 0.4))).join('–');
    const when = (d) => { const x = parse(d); return `${x.getFullYear()}.${x.getMonth() + 1}.${x.getDate()}`; };
    const row = (name, v, lapv, how) => `<tr><td><b>${name}</b></td><td class="num">${esc(v)}${/초/.test(v) ? '' : ' /km'}</td><td class="num">${lapv || '–'}</td><td>${how}</td></tr>`;
    $('#paceSide').textContent = `${when(cur.date)} 적용 · ${cur.basis}`;
    $('#paces').innerHTML = `<div class="scroll-x"><table class="t"><thead><tr><th>구분</th><th>페이스</th><th>400m 한 바퀴</th><th>어떻게</th></tr></thead><tbody>
      ${row('조깅 · 왕복 러닝', cur.easy, '', '심박 150 이하가 우선')}${row('템포런', cur.tempo, lap(cur.tempo), '20–25분 연속, 끝까지 같은 페이스')}${row('역치', cur.threshold, lap(cur.threshold), '말이 한두 마디 나오는 강도')}
      ${row('1km 인터벌', cur.rep1k, lap(cur.rep1k), '세트 사이 400m 조깅')}${row('300m 인터벌', cur.rep300, '', '100m 조깅으로 이어가기')}</tbody></table></div>
      <p class="note" style="margin-top:12px">마지막 세트까지 여유 있으면 다음 주에 km당 5초 빠르게, 못 지켰으면 5초 느리게.</p>
      <details class="more"><summary>이전 페이스와 변화 보기 <span class="muted num">· 기록 ${P.length}개</span></summary>
        ${P.length > 1 ? '<h3 style="font-size:.95rem;color:var(--ink);margin-top:16px">Threshold · 역치 페이스 변화</h3><div class="chart" id="paceChart" style="max-width:560px"></div><p class="note">아래로 내려갈수록 빨라진 거예요.</p>' : '<p class="note" style="margin-top:12px">아직 첫 기록뿐이에요. 12월 첫째 주 5km 기록을 재고 나면 두 번째 줄이 생기고, 그때부터 변화 그래프가 보여요.</p>'}
        <div class="scroll-x" style="margin-top:12px"><table class="t"><thead><tr><th>적용일</th><th>근거</th><th>조깅</th><th>템포</th><th>역치</th><th>1km</th><th>300m</th></tr></thead><tbody>
        ${[...P].reverse().map((p, i) => `<tr><td class="num" style="white-space:nowrap"><b>${when(p.date)}</b>${i === 0 ? ' <span class="chip a">지금</span>' : ''}</td><td>${esc(p.basis)}</td><td class="num">${esc(p.easy)}</td><td class="num">${esc(p.tempo)}</td><td class="num">${esc(p.threshold)}</td><td class="num">${esc(p.rep1k)}</td><td class="num">${esc(p.rep300)}</td></tr>`).join('')}</tbody></table></div></details>`;
    if (P.length > 1) lineChart($('#paceChart'), P.map((p) => ({ x: parse(p.date), y: secs(p.threshold) })).filter((p) => p.y != null), { label: '역치 페이스 변화', fmt: clock, unit: '/km' });
  }

  // ---------- 2026, the year of weight training: a recap shown inside the Training Log ----------
  const HYROX_START = '2026-11-22';     // the race that opened the Hyrox chapter; the recap covers everything before it
  // sets of one weight session: [{ name, sets: [{ kg (null for bodyweight or a pin number), reps }] }]
  const liftSets = (e) => (e.workout || '').split('\n').map((l) => /^(.+?) · (?:(.+?) × )?(.+)$/.exec(l.trim())).filter(Boolean).map((m) => { const base = m[2] || '';
    const kgOf = (t) => { const k = /(\d+(?:\.\d+)?)\s*kg/.exec(t); if (k) return +k[1]; const p = /(\d+(?:\.\d+)?)\s*lb/.exec(t); return p ? +p[1] * 0.4536 : null; };
    const sets = m[3].split(',').map((tok) => { const r = /(\d+)\s*$/.exec(tok.replace(/\([^)]*\)/g, '').trim()); return r ? { kg: kgOf(tok) ?? kgOf(base), reps: +r[1] } : null; }).filter(Boolean);
    return { name: m[1], sets }; });
  function weightRecap(log) {
    const W = log.filter((e) => e.session === 'Weight Training' && e.date < HYROX_START).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!W.length) return null;
    const withSets = W.map((e) => ({ e, lifts: liftSets(e) })).filter((s) => s.lifts.length);
    let nSets = 0, nReps = 0, vol = 0;
    withSets.forEach((s) => s.lifts.forEach((l) => l.sets.forEach((x) => { nSets++; nReps += x.reps; if (x.kg) vol += x.kg * x.reps; })));
    const first = parse(W[0].date), last = parse(W[W.length - 1].date); const weeks = Math.max(1, Math.round((last - first) / (7 * 864e5)) + 1);
    const dot = (d) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
    const t = (l, v, u, sub) => `<div class="total"><div class="l">${l}</div><div class="v num">${v}<small>${u}</small></div><div class="s num">${sub}</div></div>`;
    const runs = log.filter((e) => isRun(e) && e.date >= W[0].date && e.date < HYROX_START); const runDays = new Set(runs.map((e) => e.date)).size;
    const runKm = runs.reduce((k, e) => k + (Number(e.km) || 0), 0); const per = (v) => (v / weeks).toFixed(1);
    const tiles = t('Weight · 웨이트 한 날', W.length, '일', `${dot(first)} – ${dot(last)}`)
      + t('Running · 러닝 한 날', runDays, '일', `${runKm.toFixed(0)}km`)
      + t('Per Week · 주 평균 운동', per(W.length + runDays), '회', `웨이트 ${per(W.length)}회 · 러닝 ${per(runDays)}회`)
      + t('Reps · 반복', nReps.toLocaleString('en-US'), '회', `${nSets.toLocaleString('en-US')}세트 · 세트를 적어둔 ${withSets.length}일 기준`)
      + t('Volume · 들어 올린 무게', (vol / 1000).toFixed(0), '톤', '무게 × 횟수의 합');
    const by = {}; W.forEach((e) => { const k = e.date.slice(0, 7); by[k] = (by[k] || 0) + 1; });
    const sp = {}; W.forEach((e) => { const k = e.format || '기타'; sp[k] = (sp[k] || 0) + 1; });
    const spl = Object.entries(sp).sort((a, b) => b[1] - a[1]);
    const split = spl.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><i style="width:${Math.round(v / spl[0][1] * 100)}%"></i><b class="num">${v}</b></div>`).join('');
    // first weight vs the heaviest of the last month each lift was trained (best set of reps for bodyweight moves)
    const LIFTS = [['Bench Press', 'kg'], ['Squat', 'kg'], ['Romanian Deadlift', 'kg'], ['Hip Thrust', 'kg'], ['Dumbbell OHP', 'kg'], ['T-Bar Row', 'kg'], ['Pull-Up', '회']];
    const rows = LIFTS.map(([name, unit]) => { const pts = [];
      withSets.forEach((s) => { const l = s.lifts.find((x) => x.name === name); if (!l || !l.sets.length) return;
        const v = unit === 'kg' ? Math.max(...l.sets.map((x) => x.kg || 0)) : Math.max(...l.sets.map((x) => x.reps)); if (v > 0) pts.push({ d: s.e.date, y: v }); });
      if (pts.length < 2) return '';
      const lastM = pts[pts.length - 1].d.slice(0, 7); const end = Math.max(...pts.filter((p) => p.d.slice(0, 7) === lastM).map((p) => p.y)); const start = pts[0].y; const f = (v) => `${+v.toFixed(1)}${unit}`;
      return `<tr><td><b>${esc(name)}</b></td><td class="r num">${f(start)}</td><td class="r num"><b>${f(end)}</b></td><td class="r num">${end > start ? `<span class="chip g">▲ ${f(end - start)}</span>` : end < start ? `▼ ${f(start - end)}` : '–'}</td><td class="r num muted">${pts.length}회</td></tr>`; }).join('');
    const html = `<section class="plate recap" id="wtRecap">
      <p class="eyebrow">2026 · Weight Training</p>
      <h3>웨이트 트레이닝에 집중한 <em>2026</em></h3>
      <p class="lead">2026년의 운동 콘셉트는 웨이트였습니다. 더 무거운 무게를 들고 근육량을 늘리는 것이 목표였습니다.<br>Hyrox를 시작한 11월 22일 전까지, 그 한 해를 숫자로 정리했습니다.</p>
      <div class="totals">${tiles}</div>
      <div class="grid g2" style="margin-top:20px">
        <div><h4>Sessions · 월별 웨이트 일수</h4><div class="chart" id="wtMonths"></div></div>
        <div><h4>Split · 부위별로 한 날 수</h4>${split}</div>
      </div>
      <h4 style="margin-top:24px">Strength · 종목별 처음과 최종</h4>
      <div class="scroll-x"><table class="t"><thead><tr><th>종목</th><th class="r">처음</th><th class="r">최종</th><th class="r">변화</th><th class="r">기록</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note" style="margin-top:10px">최종은 그 종목을 마지막으로 한 달에 든 가장 무거운 무게예요. 풀업은 한 세트 최고 횟수예요.</p></section>`;
    const draw = () => { const box = $('#wtMonths'); if (box) barChart(box, Object.keys(by).sort().map((k) => ({ label: MON[+k.slice(5) - 1], y: by[k] })), { label: '월별 웨이트 일수', labels: true, h: 190, tip: (b) => `${b.label} · <b>${b.y}</b>일` }); };
    return { html, draw };
  }

  const fmtDate = (d) => { const x = parse(d); return `<b class="num">${x.getMonth() + 1}/${x.getDate()}</b>${KO[x.getDay()]}요일`; };
  async function logPage() {
    let all = await load('log'); let log = live(all); let filter = 'all'; let editing = null;
    const form = $('#logForm'), list = $('#logList'), msg = $('#logMsg'); const f = form.elements;
    const opt = (arr, v) => arr.map((s) => `<option${s === v ? ' selected' : ''}>${esc(s)}</option>`).join('');
    // Only the fields that fit the session are shown: a run asks for distance and time first, a class for the workout.
    const kind = () => kindOf({ session: f.session.value });
    const applyKind = () => { const k = kind();
      form.querySelectorAll('[data-k]').forEach((n) => { n.hidden = !n.dataset.k.split(' ').includes(k); });
      const w = $('#lfWorkout'); if (k === 'run') $('#lfMoreGrid').append(w); else $('#lfMain').insertBefore(w, $('#lfResult'));
      $('#lfWorkoutLabel').textContent = k === 'run' ? '세부 구성 (세트, 휴식)' : 'Workout · 운동 내용'; };
    const fill = (e) => { f.date.value = e.date || TODAY; f.session.innerHTML = opt(SESSIONS, e.session || 'Functional Training'); f.format.innerHTML = `<option value="">–</option>${opt(e.format && !FORMATS.includes(e.format) ? [e.format, ...FORMATS] : FORMATS, e.format)}`;
      ['km', 'pace', 'rpe', 'avg_hr', 'max_hr', 'workout', 'notes', 'result'].forEach((k) => { f[k].value = e[k] ?? ''; }); f.minutes.value = e.minutes != null ? durClock(e.minutes) : '';
      applyKind(); $('#lfMore').open = !!(e.avg_hr || e.max_hr || (kind() === 'run' && e.workout)); };
    const open = (e, preset) => { editing = e ? e.id : null; fill(e || preset || {}); msg.textContent = ''; $('#logFormWrap').hidden = false; $('#logFormTitle').textContent = e ? '기록 고치기' : '운동 기록'; $('#logFormWrap').scrollIntoView({ block: 'start' }); };
    f.session.onchange = applyKind;
    // A weight session written as "Exercise · 60kg × 8, 8, 7" lines reads best as a table; "Exercise: memo" note lines go in its last column.
    // Anything written differently falls back to plain text.
    const liftTable = (e) => {
      const lines = (e.workout || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const rows = lines.map((l) => /^(.+?) · (?:(.+?) × )?(.+)$/.exec(l));
      if (!rows.length || rows.some((m) => !m || !/^[\d[]/.test(m[3]))) return '';
      const memo = {}; const rest = [];
      (e.notes || '').split('\n').forEach((l) => { const m = rows.find((r) => l.startsWith(`${r[1]}: `));
        if (m) memo[m[1]] = [memo[m[1]], l.slice(m[1].length + 2)].filter(Boolean).join(' · '); else if (l.trim()) rest.push(l); });
      return `<div class="scroll-x"><table class="t lifts"><thead><tr><th>Exercise</th><th class="r">Weight</th><th>Reps</th><th>Memo</th></tr></thead><tbody>${rows.map((m) =>
        `<tr><td><b>${esc(m[1])}</b></td><td class="r num">${esc(m[2] || '–')}</td><td class="num">${esc(m[3])}</td><td class="muted">${esc(memo[m[1]] || '')}</td></tr>`).join('')}</tbody></table></div>${rest.length ? `<p class="note pre" style="margin-top:8px">${esc(rest.join('\n'))}</p>` : ''}`;
    };
    const ICON = { edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', del: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>' };
    const tools = (id) => (canWrite() ? `<span class="tools"><button class="ic" type="button" data-edit="${esc(id)}" title="고치기" aria-label="고치기">${ICON.edit}</button><button class="ic" type="button" data-del="${esc(id)}" title="지우기" aria-label="지우기">${ICON.del}</button></span>` : '');
    const render = () => {
      const rows = log.filter((e) => filter === 'all' || kindOf(e) === filter).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      let month = ''; let out = ''; const recap = filter === 'all' || filter === 'weights' ? weightRecap(log) : null; let placed = false;
      rows.forEach((e) => { if (recap && !placed && e.date < HYROX_START) { out += recap.html; placed = true; }
        const m = e.date.slice(0, 7); if (m !== month) { month = m; out += `<div class="month-h">${m.slice(0, 4)}년 ${+m.slice(5)}월</div>`; }
        const facts = [e.km != null && `${e.km}km`, e.minutes != null && durText(e.minutes), e.pace && `${e.pace}/km`, e.avg_hr && `평균 심박 ${e.avg_hr}`, e.max_hr && `최대 ${e.max_hr}`].filter(Boolean).map((t) => `<span class="chip num">${esc(t)}</span>`).join('');
        const col = (t, v) => (v ? `<div><h4>${t}</h4><div class="pre">${esc(v)}</div></div>` : '');
        const body = (kindOf(e) === 'weights' && liftTable(e)) || `<div class="cols">${col('Workout', e.workout)}${col('Notes', e.notes)}${col('Result', e.result)}</div>`;
        out += `<article class="entry"><div class="when">${fmtDate(e.date)}</div><div><div class="top"><span class="ttl">${esc(e.session)}</span>${e.format ? `<span class="chip a">${esc(e.format)}</span>` : ''}${e.approx ? '<span class="chip" title="엑셀에 실제 날짜가 없어서 순서와 부위로 맞춘 기록이에요">세트 기록 날짜 추정</span>' : ''}${e.rpe != null ? `<span class="chip ${e.rpe >= 9 ? 'w' : 'g'} num">RPE ${esc(e.rpe)}</span>` : ''}${facts}${tools(e.id)}</div>
          ${body}</div></article>`; });
      list.innerHTML = out || '<p class="note" style="padding:24px 0">기록이 없어요.</p>';
      if (recap && placed) recap.draw();
      if (location.hash === '#wtRecap' && $('#wtRecap') && !render.jumped) { render.jumped = true; $('#wtRecap').scrollIntoView(); }
      $('#logCount').textContent = `${rows.length}건`;
      const gone = all.filter((e) => e.deleted).sort((a, b) => (a.deleted < b.deleted ? 1 : -1));
      $('#logTrash').innerHTML = canWrite() && gone.length ? `<details class="more"><summary>휴지통 · ${gone.length}건</summary><p class="note" style="margin:8px 0">지운 기록은 여기에 남아 있어요. 되살리면 원래 날짜 자리로 돌아가요.</p>${gone.map((e) =>
        `<div class="trash-row"><span class="num"><b>${md(parse(e.date))}</b></span><span>${esc(e.session)}${e.format ? ` · ${esc(e.format)}` : ''}</span><span class="muted small num">${md(parse(e.deleted))}에 지움</span><span class="tools"><button class="btn line sm" type="button" data-restore="${esc(e.id)}">되살리기</button><button class="ic" type="button" data-purge="${esc(e.id)}" title="완전히 지우기" aria-label="완전히 지우기">${ICON.del}</button></span></div>`).join('')}</details>` : '';
    };
    render();
    document.querySelectorAll('#logFilter button').forEach((b) => { b.onclick = () => { filter = b.dataset.f; document.querySelectorAll('#logFilter button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); render(); }; });
    if (!canWrite()) { $('#logNew').hidden = true; $('#logHint').hidden = false; }
    if (LOCAL && !token()) $('#logPreview').hidden = false;
    $('#logNew').onclick = () => open(null); $('#logCancel').onclick = () => { $('#logFormWrap').hidden = true; };
    const change = async (mutate, message) => { try { all = await save('log', mutate, message); log = live(all); render(); } catch (e) { alert(e.message); } };
    list.onclick = (ev) => { const ed = ev.target.closest('[data-edit]'), del = ev.target.closest('[data-del]');
      if (ed) open(log.find((e) => e.id === ed.dataset.edit));
      if (del && confirm('이 기록을 지울까요?\n휴지통으로 옮겨지고, 목록 맨 아래 휴지통에서 되살릴 수 있어요.')) change((arr) => { const x = arr.find((e) => e.id === del.dataset.del); if (x) x.deleted = TODAY; return arr; }, `log: trash ${del.dataset.del}`); };
    $('#logTrash').onclick = (ev) => { const re = ev.target.closest('[data-restore]'), pu = ev.target.closest('[data-purge]');
      if (re) change((arr) => { const x = arr.find((e) => e.id === re.dataset.restore); if (x) delete x.deleted; return arr; }, `log: restore ${re.dataset.restore}`);
      if (pu && confirm('휴지통에서도 완전히 지울까요?\n이건 되돌릴 수 없어요.')) change((arr) => arr.filter((e) => e.id !== pu.dataset.purge), `log: purge ${pu.dataset.purge}`); };
    form.onsubmit = async (ev) => { ev.preventDefault(); const btn = $('#logSave'); const k = kind();
      const dur = parseDur(f.minutes.value); if (f.minutes.value.trim() && dur == null) { msg.textContent = '시간은 37:54 처럼 분:초로 적어주세요.'; return; }
      btn.disabled = true; msg.textContent = '저장하는 중…';
      const e = { id: editing || `e${Date.now().toString(36)}`, date: f.date.value, session: f.session.value };
      const prev = editing ? log.find((x) => x.id === editing) : null;
      if (prev && prev.shoes) e.shoes = prev.shoes; if (prev && prev.approx && prev.date === e.date) e.approx = true;
      if (k !== 'run' && f.format.value) e.format = f.format.value;
      if (dur != null) e.minutes = dur;
      ['km', 'rpe', 'avg_hr', 'max_hr'].forEach((n) => { if (n === 'km' && k !== 'run') return; const v = numOrNull(f[n].value); if (v != null) e[n] = v; });
      ['pace', 'workout', 'notes', 'result'].forEach((n) => { if ((n === 'pace' && k !== 'run') || (n === 'result' && (k === 'run' || k === 'weights'))) return; const v = f[n].value.trim(); if (v) e[n] = v; });
      if (k === 'run' && !e.pace && e.km > 0 && e.minutes > 0) e.pace = durClock(e.minutes / e.km);
      try { all = await save('log', (arr) => { const i = arr.findIndex((x) => x.id === e.id); if (i >= 0) arr[i] = e; else arr.push(e); arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); return arr; }, `log: ${e.date} ${e.session}`); log = live(all);
        msg.textContent = token() ? '저장했어요. 다른 사람에게 보이기까지 1분쯤 걸려요.' : '이 기기에만 저장했어요 (미리보기).'; $('#logFormWrap').hidden = true; render();
      } catch (err) { msg.textContent = err.message; } finally { btn.disabled = false; } };
    const h = decodeURIComponent(location.hash);
    if (h.startsWith('#edit=') && canWrite()) { const e = log.find((x) => x.id === h.slice(6)); if (e) open(e); }
    if (h.startsWith('#new') && canWrite()) { const [s, fm] = h.slice(5).split('~'); open(null, s && SESSIONS.includes(s) ? { session: s, format: fm } : null); }
  }

  // Records: every day since the first record, newest first, with the form to add or fix a day.
  async function recordsPage() {
    let daily = await load('daily'); const [plan, log] = await Promise.all([load('plan'), load('log').then(live)]); let body = await load('inbody');
    const form = $('#dayForm'), msg = $('#dayMsg'); const f = form.elements;
    const NUM = ['weight', 'kcal', 'carb', 'prot', 'fat'], TXT = ['bed', 'wake', 'note'], MEALS = ['breakfast', 'lunch', 'snack', 'dinner', 'late'];
    const OLD = { kcal: 2000, carb: 226, prot: 150, fat: 55 };          // the tracker's goals before this plan started
    const goalOf = (d) => plan.days[d] || OLD; const sleepGoal = mins(plan.targets.sleep);
    let ix = dayIndex(daily, log);
    const bar = (txt, p, cls = '') => `<span class="cellbar ${cls}" style="--p:${Math.round(Math.max(0, Math.min(100, p || 0)))}%">${txt}</span>`;
    const clip = (t, cls = '') => `<td class="clip d-only ${cls}" title="${esc(t)}">${esc(t)}</td>`;
    function table() {
      const first = daily.length ? daily[0].date : TODAY; let out = '', month = '', count = 0;
      for (let dt = parse(TODAY); iso(dt) >= first; dt = addDays(dt, -1)) { const ds = iso(dt); count++;
        if (ds.slice(0, 7) !== month) { month = ds.slice(0, 7); out += `<tr class="month-row"><td colspan="12">${month.slice(0, 4)}년 ${+month.slice(5)}월</td></tr>`; }
        const x = ix[ds] || { rec: null, hyrox: '', run: '', weights: '', etc: '' }; const r = x.rec || {}; const g = goalOf(ds); const wd = dt.getDay(); const sl = mins(r.sleep);
        const mealsT = r.meals ? Object.entries(r.meals).filter(([, v]) => v).map(([k, v]) => `${{ breakfast: '아침', lunch: '점심', snack: '간식', dinner: '저녁', late: '야식' }[k]} ${v}`).join(' · ') : '';
        const noteT = [mealsT, r.note].filter(Boolean).join(' · '); const wt = [x.weights, x.etc].filter(Boolean).join(' · ');
        const kc = r.kcal == null ? '' : bar(n0(r.kcal), r.kcal / (g.kcal + 200) * 100, `g${r.kcal > g.kcal + 200 ? ' over2' : r.kcal > g.kcal ? ' over1' : ''}`);
        const mac = (k) => (r[k] == null ? '' : bar(n0(r[k]), r[k] / g[k] * 100, 'g'));
        const dayLabel = `<b>${md(dt)}</b> <span class="${wd === 6 ? 'sat' : wd === 0 ? 'sun' : 'muted'}">${KO[wd]}</span>`;
        const allT = [x.hyrox, x.run, wt].filter(Boolean).join(' · ');
        const part = (l, t) => (t ? `<div><b>${l}</b><span>${esc(t)}</span></div>` : '');
        const detail = part('Hyrox', x.hyrox) + part('Running', x.runFull) + part('Weight', wt) + part('Sleep', r.bed ? `${r.sleep || ''} (${r.bed} → ${r.wake || ''})` : '')
          + part('Nutrition', r.kcal != null ? `${n0(r.kcal)}kcal · 탄 ${r.carb ?? '–'}g · 단 ${r.prot ?? '–'}g · 지 ${r.fat ?? '–'}g` : '') + part('Note', noteT);
        out += `<tr><td class="num">${canWrite() ? `<button class="dbtn" type="button" data-edit="${ds}" title="이 날 기록 고치기">${dayLabel}</button>` : dayLabel}</td>
          <td class="num">${sl == null ? '' : bar(r.sleep, sl / sleepGoal * 100)}</td><td class="num muted d-only">${r.bed ? `${r.bed} → ${r.wake || ''}` : ''}</td>
          ${clip(x.hyrox)}${clip(x.run)}${clip(wt)}<td class="m-only clip">${esc(allT)}</td><td class="num">${r.weight != null ? r.weight.toFixed(2) : ''}</td>
          <td class="num">${kc}</td><td class="num d-only">${mac('carb')}</td><td class="num d-only">${mac('prot')}</td><td class="num d-only">${mac('fat')}</td>${clip(noteT)}
          <td class="m-only"><button class="xp" type="button" aria-expanded="false" aria-label="${md(dt)} 자세히 보기">▾</button></td></tr>
          <tr class="more-row" hidden><td colspan="12" class="wrap">${detail || '<span class="muted">추가 기록 없음</span>'}</td></tr>`; }
      $('#dayCount').textContent = `${count}일`;
      $('#dayList').innerHTML = `<div class="scroll-x"><table class="t days"><thead><tr><th class="tl" style="width:8%">Date</th><th style="width:7%">Sleep</th><th class="d-only" style="width:9%">Bed → Wake</th><th class="d-only tl" style="width:11%">Hyrox</th><th class="d-only tl" style="width:17%">Running</th><th class="d-only tl" style="width:8%">Weight</th><th class="m-only tl">운동</th><th style="width:6%">Body kg</th><th style="width:7%">kcal</th><th class="d-only" style="width:5.5%">Carb</th><th class="d-only" style="width:5.5%">Prot</th><th class="d-only" style="width:5.5%">Fat</th><th class="d-only tl">Meals · Note</th><th class="m-only"></th></tr></thead><tbody>${out || '<tr><td colspan="12" class="muted">기록이 없어요.</td></tr>'}</tbody></table></div>`;
    }
    const fill = (d) => { const r = daily.find((x) => x.date === d) || {}; NUM.concat(TXT).forEach((k) => { f[k].value = r[k] ?? ''; }); MEALS.forEach((k) => { f[k].value = (r.meals && r.meals[k]) || ''; });
      const t = plan.days[d]; $('#dayTarget').textContent = t ? `이날 목표: ${n0(t.kcal)}kcal · 탄 ${t.carb}g · 단 ${t.prot}g · 지 ${t.fat}g` : ''; };
    const open = (d) => { f.date.value = d; fill(d); msg.textContent = ''; $('#dayFormWrap').hidden = false; $('#dayFormWrap').scrollIntoView({ block: 'center' }); };
    // Discipline: how many days were actually written down, and what they average
    const care = () => { const span = daily.length ? Math.round((parse(TODAY) - parse(daily[0].date)) / 864e5) + 1 : 0;
      const sl = daily.map((r) => mins(r.sleep)).filter((v) => v != null), kc = daily.filter((r) => r.kcal != null), bw = daily.filter((r) => r.weight != null), pr = daily.filter((r) => r.prot != null);
      const cell = (l, v, sub) => `<div><div class="l">${l}</div><div class="v num">${v}</div><div class="s num">${sub}</div></div>`;
      $('#careKv').innerHTML = cell('수면을 기록한 날', `${sl.length}<small>일</small>`, `${span}일 중 · 평균 ${sl.length ? hm(avgOf(sl)) : '–'}`)
        + cell('체중을 잰 날', `${bw.length}<small>일</small>`, `${span}일 중`)
        + cell('식단을 기록한 날', `${kc.length}<small>일</small>`, kc.length ? `평균 ${Math.round(avgOf(kc.map((r) => r.kcal))).toLocaleString('en-US')}kcal` : '')
        + cell('하루 평균 단백질', pr.length ? `${Math.round(avgOf(pr.map((r) => r.prot)))}<small>g</small>` : '–', pr.length && bw.length ? `체중 1kg당 ${(avgOf(pr.map((r) => r.prot)) / avgOf(bw.map((r) => r.weight))).toFixed(1)}g` : ''); };
    // InBody: every measurement, newest first
    const bodyTable = () => { const rows = [...body].sort((a, b) => (a.date < b.date ? 1 : -1)); const a = body[0], z = body[body.length - 1]; const sg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
      $('#bodyNote').textContent = body.length > 1 ? `첫 측정 대비 골격근량 ${sg(z.muscle - a.muscle)}kg · 체중 ${sg(z.weight - a.weight)}kg` : '';
      $('#bodyTable').innerHTML = rows.length ? `<div class="scroll-x"><table class="t"><thead><tr><th>측정일</th><th class="r">체중</th><th class="r">골격근량</th><th class="r">체지방량</th><th class="r">체지방률</th></tr></thead><tbody>${rows.map((r) => { const p = parse(r.date);
        return `<tr><td class="num">${p.getFullYear()}.${pad(p.getMonth() + 1)}.${pad(p.getDate())}</td><td class="r num">${r.weight.toFixed(1)} kg</td><td class="r num"><b>${r.muscle.toFixed(1)} kg</b></td><td class="r num">${r.fat.toFixed(1)} kg</td><td class="r num">${(r.fat_pct * 100).toFixed(1)}%</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="note">측정 기록이 없어요.</p>'; };
    const bf = $('#bodyForm'); $('#bodyNew').hidden = !canWrite();
    $('#bodyNew').onclick = () => { bf.elements.date.value = TODAY; bf.hidden = false; }; $('#bodyCancel').onclick = () => { bf.hidden = true; };
    bf.onsubmit = async (ev) => { ev.preventDefault(); const e = bf.elements; const v = (k) => numOrNull(e[k].value); const m = $('#bodyMsg');
      if ([v('weight'), v('muscle'), v('fat'), v('fat_pct')].some((x) => x == null)) { m.textContent = '네 칸을 모두 숫자로 채워주세요.'; return; }
      const row = { date: e.date.value, weight: v('weight'), muscle: v('muscle'), fat: v('fat'), fat_pct: Math.round(v('fat_pct') * 10) / 1000 };
      m.textContent = '저장하는 중…';
      try { body = await save('inbody', (arr) => { const rest = arr.filter((x) => x.date !== row.date); rest.push(row); rest.sort((x, y) => (x.date < y.date ? -1 : 1)); arr.length = 0; arr.push(...rest); return arr; }, `inbody: ${row.date}`);
        m.textContent = ''; bf.hidden = true; bf.reset(); bodyTable(); } catch (err) { m.textContent = err.message; } };
    care(); bodyTable(); table(); f.date.value = TODAY; fill(TODAY);
    f.date.onchange = () => fill(f.date.value);
    if (!canWrite()) { $('#dayNew').hidden = true; $('#dayHint').hidden = false; }
    if (LOCAL && !token()) $('#dayPreview').hidden = false;
    $('#dayNew').onclick = () => open(TODAY); $('#dayCancel').onclick = () => { $('#dayFormWrap').hidden = true; };
    // a row opens to show everything written for that day; the date itself opens the form
    $('#dayList').onclick = (ev) => { const b = ev.target.closest('[data-edit]'); if (b) { open(b.dataset.edit); return; }
      const tr = ev.target.closest('tbody tr'); if (!tr || tr.classList.contains('month-row') || tr.classList.contains('more-row')) return;
      const row = tr.nextElementSibling; row.hidden = !row.hidden; tr.classList.toggle('open', !row.hidden);
      const x = tr.querySelector('.xp'); if (x) { x.setAttribute('aria-expanded', String(!row.hidden)); x.textContent = row.hidden ? '▾' : '▴'; } };
    form.onsubmit = async (ev) => { ev.preventDefault(); const btn = $('#daySave'); btn.disabled = true; msg.textContent = '저장하는 중…'; const d = f.date.value;
      try { daily = await save('daily', (arr) => { let r = arr.find((x) => x.date === d); if (!r) { r = { date: d }; arr.push(r); }
          NUM.forEach((k) => { const v = numOrNull(f[k].value); if (v == null) delete r[k]; else r[k] = v; });
          TXT.forEach((k) => { const v = f[k].value.trim(); if (v) r[k] = v; else delete r[k]; });
          const b = mins(r.bed), w = mins(r.wake); if (b != null && w != null) r.sleep = hm((w - b + 1440) % 1440);
          const meals = {}; MEALS.forEach((k) => { const v = f[k].value.trim(); if (v) meals[k] = v; }); if (Object.keys(meals).length) r.meals = meals; else delete r.meals;
          arr.sort((a, b2) => (a.date < b2.date ? -1 : 1)); return arr; }, `daily: ${d}`);
        msg.textContent = token() ? '저장했어요. 다른 사람에게 보이기까지 1분쯤 걸려요.' : '이 기기에만 저장했어요 (미리보기).';
        ix = dayIndex(daily, log); table(); care();
      } catch (err) { msg.textContent = err.message; } finally { btn.disabled = false; } };
    if (location.hash === '#new' && canWrite()) open(TODAY);
  }

  chrome();
  const run = { hub, training, plan: planPage, log: logPage, records: recordsPage }[PAGE];
  const fail = (e) => { console.error(e); const m = $('main'); if (m) m.prepend(el(`<div class="wrap"><div class="banner" style="margin-top:16px">기록을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요. (${esc(e.message)})</div></div>`)); };
  const typing = () => !!document.querySelector('#logFormWrap:not([hidden]), #dayFormWrap:not([hidden]), dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
  if (run) run().then(() => { performance.mark('site-drawn'); return Promise.all(pending.splice(0)); }).then((changed) => { settled = true; if (changed.some(Boolean) && !typing()) return run(); return null; }).catch(fail);
  // Every link inside the site carries this page's version, so the page it opens is fetched afresh and never an
  // older copy the browser still holds: all tabs then show the same menu, wording and behaviour.
  const stamp = (ev) => { const a = ev.target.closest && ev.target.closest('a[href]'); if (!a) return; let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin || u.pathname.startsWith('/why-ions-compute') || (u.pathname === location.pathname && u.hash)) return;
    u.searchParams.set('v', VERSION); a.href = u.href; };
  document.addEventListener('click', stamp, true); document.addEventListener('auxclick', stamp, true);
  // Browsers keep each page for up to ten minutes. If the site has moved on since this copy was fetched, reload once to get the new one.
  fetch(`${ROOT}version.txt?t=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((v) => { const live = v.trim();
    if (live && live !== VERSION && !typing() && sessionStorage.getItem('site.reloaded') !== live) { sessionStorage.setItem('site.reloaded', live); location.reload(); } }).catch(() => {});
})();
