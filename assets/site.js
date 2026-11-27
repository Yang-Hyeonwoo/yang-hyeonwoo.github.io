/* Shared behaviour: header, data loading/saving, plan checks, charts, and one render function per page.
   Data lives in /data/*.json. Reading is public. Writing goes through the GitHub contents API with a
   token the owner pastes into this browser (kept in localStorage, never sent anywhere but api.github.com). */
(() => {
  const CFG = { owner: 'Yang-Hyeonwoo', repo: 'yang-hyeonwoo.github.io', branch: 'main', research: 'https://yang-hyeonwoo.github.io/why-ions-compute/' };
  const ROOT = document.body.dataset.root || './';
  const PAGE = document.body.dataset.page || '';
  const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const KEY = 'site.gh';
  const VERSION = '1127h';   // same value as version.txt and the ?v= on the pages; tools/bump.py changes all three

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
  const cacheGet = (name) => { try { const t = localStorage.getItem('cache.v1.' + name); return t ? JSON.parse(t) : null; } catch { return null; } };
  async function remote(name) {
    const r = await fetch(`${api(name)}?ref=${CFG.branch}`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) { const e = new Error(`GitHub ${r.status}`); e.status = r.status; throw e; }
    const j = await r.json();
    return { sha: j.sha, data: JSON.parse(dec(j.content)) };
  }
  // What went wrong while fetching, so the page can say so instead of quietly showing an older copy.
  const sync = { auth: false, stale: false };
  const seen = () => { try { localStorage.setItem('cache.v1.at', String(Date.now())); } catch { /* ignore */ } };
  async function fresh(name) {
    if (token()) {
      try { const d = (await remote(name)).data; seen(); return d; }
      catch (e) { console.warn('fresh read failed', e);
        if ([401, 403, 404].includes(e.status)) sync.auth = true;          // the token is dead: show the published copy and say so
        else { sync.stale = true; if (cacheGet(name)) throw e; } }         // a save takes a minute to publish, so this browser's copy may be the newer one: keep it
    }
    if (LOCAL) { try { const l = localStorage.getItem('preview.' + name); if (l) return JSON.parse(l); } catch { /* ignore */ } }
    const r = await fetch(`${ROOT}data/${name}.json?v=${Date.now()}`);
    if (!r.ok) throw new Error(`${name}.json ${r.status}`);
    const d = await r.json(); if (!token()) seen(); return d;
  }
  // Pages draw from the copy this browser kept from last time, so a tab appears at once. The fresh copy is
  // fetched meanwhile; if it turns out different, the page is drawn again with it (see the end of this file).
  const CACHE = 'cache.v1.'; const pending = []; let settled = false;
  const cachePut = (name, data) => { try { localStorage.setItem(CACHE + name, JSON.stringify(data)); } catch { /* storage full or blocked: just slower */ } };
  async function load(name) {
    const kept = cacheGet(name);
    if (kept && settled) return kept;
    if (kept) {
      pending.push(fresh(name).then((d) => { const changed = JSON.stringify(d) !== JSON.stringify(kept); if (changed) cachePut(name, d); return changed; }).catch(() => { sync.stale = true; return false; }));
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
    // a dropped connection or a dead token gets a plain sentence, not "Failed to fetch"
    const net = (p) => p.catch((e) => { throw e instanceof TypeError ? new Error('연결이 불안정해서 저장하지 못했어요. 적은 내용은 그대로 있으니 잠시 뒤 다시 저장해 주세요.')
      : [401, 403, 404].includes(e.status) ? new Error('토큰이 만료됐거나 권한이 없어요. 오른쪽 위 열쇠 버튼에서 새 토큰을 넣어주세요.') : e; });
    for (let attempt = 0; attempt < 3; attempt++) {
      const { sha, data } = await net(remote(name));
      const next = mutate(data) || data;
      const r = await net(fetch(api(name), { method: 'PUT', headers: { Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json' },
        body: JSON.stringify({ message, branch: CFG.branch, sha, content: enc(JSON.stringify(next, null, 1) + '\n') }) }));
      if (r.ok) { cachePut(name, next); seen(); return next; }
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
    const next = item.wk ? iso(addDays(parse(date), 1)) : '';      // the weekend run may be done on Sunday instead
    const es = log.filter((e) => e.date === date || e.date === next);
    if (item.k === 'hyrox') return es.find((e) => HYROX.includes(e.session));
    if (item.k === 'run' || item.k === 'commute') return es.find(isRun);
    if (item.k === 'weights') return es.find((e) => e.session === 'Weight Training');
    if (item.k === 'core') return es.find((e) => e.session === 'Core' || /hanging|행잉|레이즈|toes/i.test(`${e.workout || ''} ${e.notes || ''} ${e.result || ''}`));
    return undefined;
  }
  const isDone = (item, date, log) => !!doneEntry(item, date, log);
  const KIND = { hyrox: 'Hyrox', commute: 'Run', run: 'Run', weights: 'Weight', core: 'Core', rest: 'Rest', free: 'Free' };
  const doneChip = '<span class="chip g">완료</span>';
  const ICON_PEN = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const doneMark = '<span class="tick" role="img" aria-label="완료">✓</span>';

  // ---------- sums ----------
  const runSum = (log, a, b) => { const r = log.filter((e) => e.date >= a && e.date <= b && isRun(e)); return { n: r.length, km: r.reduce((s, e) => s + (Number(e.km) || 0), 0) }; };
  const weekRun = (mon, plan, log) => ({ km: runSum(log, iso(mon), iso(addDays(mon, 6))).km, meta: plan.weeks.find((w) => w.start === iso(mon)) });
  const hyroxCount = (log, a, b) => log.filter((e) => e.date >= a && e.date <= b && HYROX.includes(e.session)).length;
  const live = (arr) => arr.filter((e) => !e.deleted);   // a deleted entry stays in the file, flagged: that is the trash can
  // An entry written ahead (a class's WOD posted the day before) carries planned: true. It counts as done once an
  // outcome is in it (result, RPE, notes, or heart rate from the watch), or once it is checked off on Home.
  const ahead = (e) => !!e.planned && !['result', 'rpe', 'avg_hr', 'notes'].some((k) => e[k] != null && e[k] !== '');
  const done = (arr) => live(arr).filter((e) => !ahead(e));
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
    const W = o.wide && box.clientWidth > 700 ? 1040 : 520, H = o.h || 170, L = 36, R = 14, T = o.labels ? 20 : 12, B = 22;
    const vals = bars.filter((b) => b.y > 0).map((b) => b.y); let base = 0, ticks;
    if (o.zoom && vals.length) { const st = o.zoom, mn = Math.min(...vals); base = Math.floor(mn / st) * st; if (mn - base < st * 0.2) base -= st; base = Math.max(0, base);
      const top = Math.ceil(Math.max(...vals) / st) * st; ticks = []; for (let v = base; v <= top; v += st) ticks.push(v);
    } else { const mx = Math.max(...bars.map((b) => Math.max(b.y, b.plan || 0)), 10); const p10 = 10 ** Math.floor(Math.log10(mx / 2)); const fr = mx / 2 / p10;
      const step = (fr <= 1 ? 1 : fr <= 1.5 ? 1.5 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * p10; ticks = [0, step, step * 2]; }
    const hi = ticks[ticks.length - 1] + (ticks[ticks.length - 1] - base) * 0.04;
    const bw = (W - L - R) / bars.length; const Y = (v) => T + (1 - (v - base) / (hi - base)) * (H - T - B);
    const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(0,0,0,.06)"/><text class="ax" x="${L - 6}" y="${Y(v) + 3.5}" text-anchor="end">${o.fmt ? o.fmt(v) : v}</text>`).join('');
    const marks = bars.map((b, i) => { const pad = Math.min(8, bw * 0.16), x = L + i * bw + pad, w = Math.max(bw - 2 * pad, 2), y = Y(b.y), hgt = H - B - y, rr = Math.min(4, hgt, w / 2);
      const bar = b.y > 0 ? `<path d="M${x} ${H - B}V${y + rr}q0-${rr} ${rr}-${rr}h${w - 2 * rr}q${rr} 0 ${rr} ${rr}V${H - B}z" fill="${o.color || 'var(--accent)'}"${b.cur ? ' fill-opacity="0.45"' : ''}/>${o.labels ? vl(x + w / 2, y - 4, o.vfmt ? o.vfmt(b.y) : b.y) : ''}` : '';
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
  // Days trained per month, the way the old tracker drew it: one column per month as tall as the days trained (out of the
  // month's 31-day scale), split by kind in proportion to how many days each kind had, each part labelled with its count.
  // A day with two kinds counts in both, so the parts can add up to more than the total on top.
  function daysChart(box, cats, o) {
    const W = 520, H = o.h || 210, L = 26, R = 8, T = 22, B = 22; const top = 31;
    const gw = (W - L - R) / cats.length, bw = Math.min(40, gw * 0.56); const Y = (v) => T + (1 - v / top) * (H - T - B);
    const grid = [0, 10, 20, 30].map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(0,0,0,${v ? 0.06 : 0.14})"/><text class="ax" x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
    const marks = cats.map((c, i) => { const x = L + i * gw + (gw - bw) / 2; const sum = c.v.reduce((a, b) => a + b, 0); let y = H - B; let out = '';
      const parts = c.v.map((v, k) => ({ v, k })).filter((q) => q.v);
      parts.forEach((q, j) => { const h = sum ? (q.v / sum) * (H - B - Y(c.total)) : 0; const y0 = y - h; const last = j === parts.length - 1; const r = last ? Math.min(4, h, bw / 2) : 0; const gap = j ? 1 : 0;
        out += `<path d="M${x.toFixed(1)} ${(y - gap).toFixed(1)}V${(y0 + r).toFixed(1)}${r ? `q0-${r} ${r}-${r}h${(bw - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}` : `h${bw.toFixed(1)}`}V${(y - gap).toFixed(1)}z" fill="${KINDS[q.k].color}"/>`;
        if (h >= 13) out += `<text class="vl in" x="${(x + bw / 2).toFixed(1)}" y="${(y0 + h / 2 + 3.5).toFixed(1)}" text-anchor="middle">${q.v}</text>`;
        y = y0; });
      out += c.total ? `<text class="vl tot" x="${(x + bw / 2).toFixed(1)}" y="${(Y(c.total) - 5).toFixed(1)}" text-anchor="middle">${c.total}</text>` : '';
      return `${out}<rect data-i="${i}" x="${(L + i * gw).toFixed(1)}" y="0" width="${gw.toFixed(1)}" height="${H - B}" fill="transparent"/>`; }).join('');
    const xl = cats.map((c, i) => `<text class="ax" x="${(L + i * gw + gw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${c.label}</text>`).join('');
    box.innerHTML = `<div class="legend">${KINDS.map((q) => `<span><i style="background:${q.color}"></i>${q.name}</span>`).join('')}</div>
      <svg class="days-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${grid}${marks}${xl}</svg><div class="tip"></div>`;
    const tip = $('.tip', box), svg = $('svg', box);
    box.querySelectorAll('rect[data-i]').forEach((r) => { const i = +r.dataset.i, c = cats[i];
      const show = () => { tip.innerHTML = `${c.tip || c.label} · <b>${c.total}</b>일 운동 · ${KINDS.map((q, k) => `${q.name} ${c.v[k]}`).join(' · ')}`; tip.style.left = `${Math.min(72, Math.max(28, (L + (i + 0.5) * gw) / W * 100))}%`;
        tip.style.top = `${svg.offsetTop + Y(c.total) / H * svg.getBoundingClientRect().height - 12}px`; tip.style.opacity = 1; };
      r.addEventListener('mouseenter', show); r.addEventListener('touchstart', show, { passive: true }); r.addEventListener('mouseleave', () => { tip.style.opacity = 0; }); });
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
    const [plan, log, daily] = await Promise.all([load('plan'), load('log').then(done), load('daily')]);
    $('#hubDday').textContent = ddayText(dday(plan));
    $('#hubHyrox').textContent = `${hyroxCount(log, MONTH0, TODAY)}회`;
    $('#hubRun').textContent = `${runSum(log, MONTH0, TODAY).km.toFixed(1)}km`;
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
    if (it.k === 'run') return /기록 측정/.test(it.t) ? 'Time trial' : /지속주|연속/.test(it.t) ? 'Tempo run' : /×|세트/.test(it.t) ? 'Interval run' : /조깅/.test(it.t) ? 'Jogging' : 'Interval run';
    return '';
  }

  // Today's check: a small round button to mark a session done, and the same mark filled in once it is.
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ckBtn = (key) => `<button class="ck" type="button" data-done="${key}" title="완료로 표시" aria-label="완료로 표시">${CHECK}</button>`;
  const ckOn = `<span class="ck on" role="img" aria-label="완료">${CHECK}</span>`;
  function todayCard(plan, log, daily) {
    const day = plan.days[TODAY]; const rec = daily.find((r) => r.date === TODAY) || {};
    // One tap marks a session done; distance, time and notes can be added later from "자세히".
    const row = (it, i, d = TODAY) => { const m = /^(\d{1,2}:\d{2})\s*·?\s*(.*)$/.exec(it.d || ''); const de = doneEntry(it, d, log); let act = ''; const key = `${d}|${i}`;
      if (de) act = `${it.k === 'core' && de.result ? `<span class="small num muted">${esc(de.result)}</span>` : ''}<a class="small" href="log.html#edit=${encodeURIComponent(de.id)}">자세히</a>${ckOn}`;
      else if (canWrite() && it.k === 'core') act = `<input class="in sm" data-reps inputmode="text" placeholder="12, 10, 8" aria-label="세트별 개수">${ckBtn(key)}`;
      else if (canWrite() && sessionFor(it, d)) act = ckBtn(key);
      return `<div class="todo${it.key ? ' key' : ''}"><span class="kind">${m ? `<b class="num">${m[1]}</b>` : ''}${KIND[it.k] || ''}</span><div class="b"><div class="t">${esc(it.t)}</div><div class="d">${esc(m ? m[2] : it.d || '')}</div></div><div class="act">${act}</div></div>`; };
    const items = day ? day.items.map((it, i) => row(it, i)).join('') : '<p class="note">오늘은 정해진 계획이 없어요.</p>';
    // The last three days' planned sessions not checked yet, so a session logged the next day is still one tap (owner only).
    // Runs and classes the Garmin sync already filled count as done and don't show here.
    const back = canWrite() ? [1, 2, 3].map((n) => iso(addDays(parse(TODAY), -n))).map((d) => ({ d, rows: ((plan.days[d] || {}).items || [])
      .map((it, i) => (it.opt || it.k === 'free' || it.k === 'rest' || isDone(it, d, log) || !(it.k === 'core' || sessionFor(it, d)) ? '' : row(it, i, d))).join('') })).filter((x) => x.rows) : [];
    const past = back.length ? `<div class="past"><div class="past-h">아직 체크 안 한 지난 운동</div>${back.map((x) => { const dt = parse(x.d);
      return `<div class="past-d num">${md(dt)} <span class="muted">${KO[dt.getDay()]}요일</span></div>${x.rows}`; }).join('')}</div>` : '';
    const cell = (l, got, goal, unit) => `<div><div class="l">${l}</div><div class="v num">${n0(goal)}<small>${unit}</small></div><div class="s num">${got == null ? '아직 기록 전' : `기록 ${n0(got)}${unit}`}</div></div>`;
    const kv = day ? `<div class="kv">${cell('Calories', rec.kcal, day.kcal, 'kcal')}${cell('Carbs', rec.carb, day.carb, 'g')}${cell('Protein', rec.prot, day.prot, 'g')}${cell('Fat', rec.fat, day.fat, 'g')}</div>` : '';
    const slept = mins(rec.sleep);
    return `<div class="grid g2"><div class="plate today">
        <div class="chips">${day ? `<span class="chip a">${esc(day.week)}</span>` : ''}</div>
        <h3 class="date">${NOW.getMonth() + 1}월 ${NOW.getDate()}일 <em>${KO[NOW.getDay()]}요일</em></h3>${items}${past}
        <div class="form-foot"><a class="btn" href="log.html#new">운동 기록</a><a class="btn line" href="records.html#new">식단 · 체중 기록</a></div></div>
      <div class="soft"><h3 style="font-size:.95rem;color:var(--ink);margin-bottom:12px">Today's Targets <span class="muted" style="font-weight:500">· 오늘 목표</span></h3>${kv}
      <div class="kv" style="margin-top:8px;grid-template-columns:repeat(2,minmax(0,1fr))"><div><div class="l">Bedtime · 오늘 취침</div><div class="v num">${plan.targets.bed}</div><div class="s">기상 ${plan.targets.wake} · ${plan.targets.sleep} 수면</div></div>
      <div><div class="l">Last night · 어젯밤 수면</div><div class="v num">${slept == null ? '–' : hmHtml(slept)}</div><div class="s num">${rec.bed ? `${rec.bed} → ${rec.wake || ''}` : '기록 없음'}</div></div></div></div></div>`;
  }
  // This week, one card per day, one check per session. A day is tinted only when every planned session is logged;
  // "1/2" marks a day half done and "미기록" a past day with nothing logged. Bonus items and core work don't count.
  function weekStrip(mon, plan, log) {
    return `<div class="week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const dt = addDays(mon, i), d = iso(dt), day = plan.days[d];
      const idle = (it) => it.k === 'free' || it.k === 'rest';
      const items = day ? day.items.filter((it) => it.k !== 'core') : [];
      const need = items.filter((it) => !it.opt && !idle(it));
      const got = need.filter((it) => isDone(it, d, log)).length;
      const did = log.filter((e) => e.date === d && kindOf(e) !== 'other');
      const planned = new Set(items.map((it) => (it.k === 'commute' ? 'run' : it.k)));
      const lines = items.filter((it) => !(idle(it) && did.length)).map((it) => ({ ok: !idle(it) && isDone(it, d, log), t: `${esc(it.t)}${it.opt && !idle(it) ? ' (보너스)' : ''}`, quiet: it.opt || idle(it) }))
        .concat(did.filter((e) => !planned.has(kindOf(e))).map((e) => ({ ok: true, t: `${esc(e.session)}${e.km ? ` ${e.km}km` : ''}` })));   // logged, though not in the plan
      const any = lines.some((l) => l.ok);
      const its = lines.map((l) => `<div class="it${l.quiet ? ' optional' : ''}${l.ok ? ' did' : ''}">${l.ok ? doneMark : any ? '<span class="mk"></span>' : ''}<span>${l.t}</span></div>`).join('');
      const state = need.length ? (got === need.length ? 'done' : got ? 'part' : d < TODAY ? 'miss' : '') : did.length ? 'done' : 'off';
      const st = state === 'part' ? `<i class="st part num" role="img" aria-label="계획 ${need.length}개 중 ${got}개 기록">${got}/${need.length}</i>` : state === 'miss' ? '<i class="st">미기록</i>' : '';
      return `<div class="day${d === TODAY ? ' today' : ''}${state ? ` ${state}` : ''}"><div class="dn"><span>${KO[dt.getDay()]}</span>${st}<b class="num">${dt.getDate()}</b></div><div class="its">${its}</div></div>`; }).join('')}</div>
      <p class="note wk-key">파란 칸은 계획한 운동을 모두 기록한 날이에요. <b class="num">1/2</b>는 일부만 기록, <b>미기록</b>은 지난 날인데 기록이 없다는 뜻이에요.</p>`;
  }

  async function training() {
    const [plan, daily] = await Promise.all([load('plan'), load('daily')]); let log = await load('log').then(done);
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
      const [d, i] = b.dataset.done.split('|'); const it = plan.days[d].items[+i]; const [session, format] = (it.k === 'core' ? 'Core' : sessionFor(it, d)).split('~');
      const e = { id: `e${Date.now().toString(36)}`, date: d, session }; if (format) e.format = format;
      if (it.k === 'core') { e.workout = '행잉 레그레이즈'; const reps = $('[data-reps]', b.parentElement).value.trim(); if (reps) e.result = reps; }
      b.disabled = true;
      try { log = done(await save('log', (arr) => { const pre = arr.find((x) => x.date === d && !x.deleted && ahead(x) && kindOf(x) === kindOf(e));
          if (pre) { delete pre.planned; if (e.result && !pre.result) pre.result = e.result; } else arr.push(e);
          arr.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0)); return arr; }, `log: ${e.date} ${e.session}`)); paint(); }
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
      // Training: days per month, by kind
      const by = {}; const KEYS = ['hyrox', 'run', 'weights'];
      Object.values(ix).forEach((x) => { const k = x.date.slice(0, 7); const a = (by[k] = by[k] || { ym: k, v: [0, 0, 0], any: 0, days: 0 }); KEYS.forEach((key, i) => { if (x[key]) a.v[i]++; }); if (x.any) a.any++; a.days++; });
      const thisYm = TODAY.slice(0, 7); const months = Object.values(by).filter((a) => a.days >= 7 || a.ym === thisYm).sort((a, b) => (a.ym < b.ym ? -1 : 1));
      const mNow = by[thisYm] || { any: 0, v: [0, 0, 0] };
      $('#nowMD').innerHTML = `${mNow.any}<small>일 · ${NOW.getMonth() + 1}월 운동한 날</small><span class="chip num">${KINDS.map((q, k) => `${q.name} ${mNow.v[k]}`).join(' · ')}</span>`;
      daysChart($('#chMD'), months.map((a) => ({ label: `${+a.ym.slice(5)}월`, tip: `${a.ym.slice(0, 4)}년 ${+a.ym.slice(5)}월`, v: a.v, total: a.any })), { label: '월별 운동한 날', h: 210 });
      // running distance per month, same months as the chart beside it
      const mk = months.map((a) => { const [y, m] = a.ym.split('-').map(Number); return { label: `${m}월`, tip: `${y}년 ${m}월`, y: runSum(log, `${a.ym}-01`, iso(new Date(y, m, 0))).km, cur: a.ym === thisYm }; });
      const mPrev = mk.length > 1 ? mk[mk.length - 2] : null;
      $('#nowRM').innerHTML = `${mk.length ? mk[mk.length - 1].y.toFixed(1) : '0'}<small>km · ${NOW.getMonth() + 1}월 러닝</small>${mPrev ? `<span class="chip num">${mPrev.label} ${mPrev.y.toFixed(1)}km</span>` : ''}`;
      barChart($('#chRM'), mk, { label: '월별 러닝 거리', labels: true, h: 210, color: C.run, vfmt: (v) => v.toFixed(0), tip: (b) => `${b.tip} · <b>${b.y.toFixed(1)}</b>km${b.cur ? ' (진행 중)' : ''}` });
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
    // Running mileage, the number the user follows week to week: the last 12 weeks, every bar labelled, the plan's base distance
    // as a black tick, this week drawn lighter while it is still going.
    const runWeeks = () => { const bars = []; for (let i = 11; i >= 0; i--) { const m = addDays(mon, -7 * i); const st = weekRun(m, plan, log);
        bars.push({ label: md(m), tipx: `${weekLabel(m)} (${md(m)}–${md(addDays(m, 6))})`, y: st.km, plan: st.meta ? st.meta.run_km : 0, cur: i === 0 }); }
      const done4 = bars.slice(-5, -1); const avg4 = done4.reduce((a, b) => a + b.y, 0) / done4.length; const cur = bars[bars.length - 1];
      $('#nowR').innerHTML = `${cur.y.toFixed(1)}<small>km · 이번 주${cur.plan ? ` / 기본 계획 ${cur.plan}km` : ''}</small><span class="chip num">지난 4주 평균 ${avg4.toFixed(1)}km</span>`;
      barChart($('#chR'), bars, { label: '주간 러닝 거리', labels: true, wide: true, h: 220, color: C.run, vfmt: (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1)),
        tip: (b) => `${b.tipx} · <b>${b.y.toFixed(1)}</b>km${b.plan ? ` (기본 계획 ${b.plan}km)` : ''}${b.cur ? ' · 진행 중' : ''}` }); };
    runWeeks(); let rwW = $('#chR').clientWidth;
    window.addEventListener('resize', () => { const w = $('#chR').clientWidth; if ((w > 700) !== (rwW > 700)) { rwW = w; runWeeks(); } });
    document.querySelectorAll('#range button').forEach((b) => { b.onclick = () => { document.querySelectorAll('#range button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); draw(+b.dataset.w); }; });
    // races, newest first; the fastest result of each event gets a PB mark
    const secsOf = (t) => t.split(':').reduce((acc, v) => acc * 60 + Number(v), 0); const best = {};
    plan.races.forEach((r) => { const v = secsOf(r.result); if (best[r.event] == null || v < best[r.event]) best[r.event] = v; });
    $('#races').innerHTML = `<div class="scroll-x"><table class="t races"><thead><tr><th>Date</th><th>Race</th><th class="dev">Event</th><th class="pb"></th><th class="r">Result</th></tr></thead><tbody>${plan.races.map((r) => `<tr><td class="num" style="white-space:nowrap">${esc(r.date)}</td><td><b>${esc(r.name)}</b><div class="mev">${esc(r.event || '')}</div></td><td class="dev">${esc(r.event || '')}</td><td class="pb">${secsOf(r.result) === best[r.event] ? '<span class="chip a">PB</span>' : ''}</td><td class="r num res"><b>${esc(r.result)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  async function planPage() {
    const [plan, log] = await Promise.all([load('plan'), load('log').then(done)]);
    const thisMon = iso(monday(NOW));
    const phase = [...plan.roadmap].reverse().find((r) => r.from <= TODAY) || plan.roadmap[0];
    $('#road').innerHTML = `<div class="road" style="margin-top:0">${plan.roadmap.map((r) => `<div class="${r === phase ? 'now' : r.from < phase.from ? 'past' : ''}"><div class="m">${esc(r.m)}</div><div class="th">${esc(r.theme)}</div><div class="f">${esc(r.focus)}</div></div>`).join('')}</div>`;
    // the weeks at a glance, under the roadmap: one small card per week (what it is for and its base running distance, with a bar
    // to compare weeks). The Wednesday session and the day-by-day detail are in the week's own plan below; a card opens it.
    $('#weekTable').innerHTML = `<div class="wk-grid">${plan.weeks.map((w, i) => { const mon = parse(w.start); const now = w.start === thisMon;
      return `<a class="wkc${now ? ' now' : ''}${w.recovery ? ' rec' : ''}" href="#w-${w.start}"><div class="n"><b class="num">${i + 1}주차</b><span class="num">${md(mon)}–${md(addDays(mon, 6))}</span></div>
        <div class="t">${esc(w.label)}${now ? ' <span class="chip a">이번 주</span>' : ''}${w.recovery ? ' <span class="chip w">회복</span>' : ''}</div>
        <div class="c">${esc(w.concept || '')}</div>
        ${w.start <= thisMon ? (() => { const got = runSum(log, w.start, iso(addDays(mon, 6))).km;
          return `<div class="km run"><span class="num"><b>${got.toFixed(1)}</b> / ${w.run_km}km${now ? '<small> · 진행 중</small>' : ''}</span><i title="계획의 ${Math.round(got / w.run_km * 100)}%"><s style="width:${Math.min(100, got / w.run_km * 100).toFixed(1)}%"></s></i></div>`; })()
          : `<div class="km"><span class="num"><b>${w.run_km}</b>km${w.bonus_km ? `<small> · 보너스 +${w.bonus_km}</small>` : ''}</span><i></i></div>`}</a>`; }).join('')}</div>`;
    const raceMon = monday(parse(plan.race.date)); const totalWeeks = Math.round((raceMon - parse(plan.weeks[0].start)) / (7 * 864e5)) + 1;
    const nowNo = Math.round((monday(NOW) - parse(plan.weeks[0].start)) / (7 * 864e5)) + 1;
    $('#weekTotal').textContent = `대회 주까지 총 ${totalWeeks}주${nowNo >= 1 && nowNo <= totalWeeks ? ` · 지금 ${nowNo}주차` : ''}`;
    $('#weeks').innerHTML = plan.weeks.map((w, wi) => { const mon = parse(w.start);
      const tone = (it) => (it.k === 'commute' ? 'run' : it.k);     // bullet colour: the same three kinds as the charts
      const li = (it, d) => `<li class="${it.k === 'free' || it.k === 'rest' ? 'quiet' : `k-${tone(it)}`}"><b>${esc(it.t)}</b>${it.d ? ` <span class="why">(${esc(it.d)})</span>` : ''}${it.first ? ' <span class="chip w">첫 Hyrox Training</span>' : ''}${it.key ? ' <span class="chip a">핵심</span>' : ''}${isDone(it, d, log) ? ` ${doneChip}` : ''}</li>`;
      const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => { const dt = addDays(mon, i), d = iso(dt), day = plan.days[d];
        return `<tr><td class="num dcol"><b>${KO[dt.getDay()]}</b> <span class="muted">${md(dt)}</span></td><td><ul class="plan-items">${day.items.map((it) => li(it, d)).join('')}</ul><div class="m-nut num">${n0(day.kcal)}kcal · 탄 ${day.carb} · 단 ${day.prot} · 지 ${day.fat}</div></td><td class="r num d-only" style="white-space:nowrap">${n0(day.kcal)}kcal<br><span class="small muted">탄 ${day.carb} · 단 ${day.prot} · 지 ${day.fat}</span></td></tr>`; }).join('');
      return `<section class="plate plan-week${w.start === thisMon ? ' now' : ''}" id="w-${w.start}"><div class="hd"><h3>${esc(w.label)}</h3><span class="chip dark num">${wi + 1}주차</span><span class="muted small num">${md(mon)}–${md(addDays(mon, 6))}</span>${w.recovery ? '<span class="chip w">회복 주</span>' : ''}${w.start === thisMon ? '<span class="chip a">이번 주</span>' : ''}<a class="up" href="#weekTable">↑ 10주 개요</a>
        <span class="small muted" style="margin-left:auto">러닝 기본 <b class="num" style="color:var(--ink)">${w.run_km}km</b> (${esc(w.run_note)})${w.bonus_km ? ` · 보너스 +${w.bonus_km}km` : ''}</span></div>
        ${w.concept ? `<p class="concept">${esc(w.concept)}</p>` : ''}
        <div class="scroll-x"><table class="t"><thead><tr><th class="dcol">Day</th><th>Training</th><th class="r d-only" style="width:9.5rem">Nutrition</th></tr></thead><tbody>${rows}</tbody></table></div></section>`; }).join('');
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
      ${row('조깅 · 왕복 러닝', cur.easy, '', '심박 150 이하가 우선')}${row('템포 지속주', cur.tempo, lap(cur.tempo), '7km 안팎을 쉬지 않고, 끝까지 같은 페이스')}${row('역치 지속주', cur.threshold, lap(cur.threshold), '5–6km를 쉬지 않고 · 말이 한두 마디 나오는 강도')}
      ${row('1km 인터벌', cur.rep1k, lap(cur.rep1k), '세트 사이 400m 조깅')}${row('300m 인터벌', cur.rep300, '', '100m 조깅으로 이어가기')}${row('200m 빠르게', '44–46초', '', '전력 아님 · 사이는 걸어서 회복')}</tbody></table></div>
      <p class="note" style="margin-top:12px">끝까지 페이스를 지키고 여유가 있으면 다음 주에 km당 5초 빠르게, 못 지켰으면 5초 느리게. 쉬는 구간은 1km·300m 인터벌처럼 지속주로는 낼 수 없는 페이스에만 둬요.</p>
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
    const search = $('#logSearch') || document.createElement('input'); let query = search.value.trim();   // (a page copy from before the search box existed)
    const opt = (arr, v) => arr.map((s) => `<option${s === v ? ' selected' : ''}>${esc(s)}</option>`).join('');
    const FIELDS = ['date', 'session', 'format', 'km', 'minutes', 'pace', 'rpe', 'avg_hr', 'max_hr', 'workout', 'notes', 'result'];
    const vals = () => { const o = {}; FIELDS.forEach((k) => { o[k] = f[k].value.trim(); }); return o; };
    let base = {};          // what the form showed when it opened: saving an edit writes only the fields changed since then
    // A new entry being typed is kept in this browser until it is saved, so a lost connection or a closed tab does not lose it.
    const DRAFT = 'draft.log';
    const draftGet = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      return d && Date.now() - d.at < 3 * 864e5 && (d.v.workout || d.v.notes || d.v.result || d.v.km || d.v.minutes) ? d.v : null; } catch { return null; } };
    const draftDrop = () => { try { localStorage.removeItem(DRAFT); } catch { /* ignore */ } };
    form.oninput = () => { if (editing) return; try { localStorage.setItem(DRAFT, JSON.stringify({ at: Date.now(), v: vals() })); } catch { /* ignore */ } };
    // Only the fields that fit the session are shown: a run asks for distance and time first, a class for the workout.
    const kind = () => kindOf({ session: f.session.value });
    const applyKind = () => { const k = kind();
      form.querySelectorAll('[data-k]').forEach((n) => { n.hidden = !n.dataset.k.split(' ').includes(k); });
      const w = $('#lfWorkout'); if (k === 'run') $('#lfMoreGrid').append(w); else $('#lfMain').insertBefore(w, $('#lfResult'));
      $('#lfWorkoutLabel').textContent = k === 'run' ? '세부 구성 (세트, 휴식)' : 'Workout · 운동 내용'; };
    const fill = (e) => { f.date.value = e.date || TODAY; f.session.innerHTML = opt(SESSIONS, e.session || 'Functional Training'); f.format.innerHTML = `<option value="">–</option>${opt(e.format && !FORMATS.includes(e.format) ? [e.format, ...FORMATS] : FORMATS, e.format)}`;
      ['km', 'pace', 'rpe', 'avg_hr', 'max_hr', 'workout', 'notes', 'result'].forEach((k) => { f[k].value = e[k] ?? ''; }); f.minutes.value = e.minutes != null ? durClock(e.minutes) : '';
      applyKind(); $('#lfMore').open = !!(e.avg_hr || e.max_hr || (kind() === 'run' && e.workout)); base = vals(); };
    const open = (e, preset) => { editing = e ? e.id : null; fill(e || preset || {}); msg.textContent = '';
      const d = e ? null : draftGet();
      if (d) { if (SESSIONS.includes(d.session)) f.session.value = d.session; applyKind(); FIELDS.forEach((k) => { if (k !== 'session' && d[k] != null) f[k].value = d[k]; });
        msg.innerHTML = '저장하지 않고 닫았던 내용을 다시 불러왔어요. <button class="btn line sm" type="button" id="draftDrop">비우기</button>'; }
      $('#logFormWrap').hidden = false; $('#logFormTitle').textContent = e ? '기록 고치기' : '운동 기록'; $('#logFormWrap').scrollIntoView({ block: 'start' }); };
    msg.onclick = (ev) => { if (ev.target.id === 'draftDrop') { draftDrop(); open(null); } };
    f.session.onchange = applyKind;
    // A weight session written as "Exercise · 60kg × 8, 8, 7" lines reads best as a table; "Exercise: memo" note lines go in its last column.
    // Anything written differently falls back to plain text.
    const liftRows = (e) => { const rows = (e.workout || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => /^(.+?) · (?:(.+?) × )?(.+)$/.exec(l));
      return !rows.length || rows.some((m) => !m || !/^[\d[]/.test(m[3])) ? null : rows; };
    const liftTable = (e) => { const rows = liftRows(e); if (!rows) return '';
      const memo = {}; const rest = [];
      (e.notes || '').split('\n').forEach((l) => { const m = rows.find((r) => l.startsWith(`${r[1]}: `));
        if (m) memo[m[1]] = [memo[m[1]], l.slice(m[1].length + 2)].filter(Boolean).join(' · '); else if (l.trim()) rest.push(l); });
      return `<div class="scroll-x"><table class="t lifts"><thead><tr><th>Exercise</th><th class="r">Weight</th><th>Reps</th><th>Memo</th></tr></thead><tbody>${rows.map((m) =>
        `<tr><td><b>${esc(m[1])}</b></td><td class="r num">${esc(m[2] || '–')}</td><td class="num">${esc(m[3])}</td><td class="muted">${esc(memo[m[1]] || '')}</td></tr>`).join('')}</tbody></table></div>${rest.length ? `<p class="note pre" style="margin-top:8px">${esc(rest.join('\n'))}</p>` : ''}`;
    };
    const ICON = { edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', del: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>' };
    const tools = (id) => (canWrite() ? `<span class="tools"><button class="ic" type="button" data-edit="${esc(id)}" title="고치기" aria-label="고치기">${ICON.edit}</button><button class="ic" type="button" data-del="${esc(id)}" title="지우기" aria-label="지우기">${ICON.del}</button></span>` : '');

    // ---- the list: one fold per month, newest first. An entry shows its result (or, for a run, distance · time · pace);
    //      the long workout text and the notes open on demand. Search looks through everything, whatever is folded. ----
    const ALIAS = [['썰매', '슬레드', 'sled'], ['월볼', '월 볼', 'wall ball', 'wallball'], ['로잉', '로우', 'row'], ['스키', 'ski'], ['버피', 'burpee'], ['런지', 'lunge'], ['파머', 'farmer'], ['케틀벨', 'kettlebell', 'kb'],
      ['스쿼트', 'squat'], ['벤치', 'bench'], ['데드', '데드리프트', 'deadlift'], ['풀업', 'pull-up', 'pull up'], ['팔꿈치', 'elbow']];
    const words = () => query.toLowerCase().split(/\s+/).filter(Boolean).map((w) => ALIAS.find((a) => a.includes(w)) || [w]);
    const hit = (text, ws) => ws.every((alts) => alts.some((a) => text.includes(a)));
    const hay = (e) => [md(parse(e.date)), e.date, e.session, e.format, e.workout, e.result, e.notes, e.brief].filter(Boolean).join('\n').toLowerCase();
    const short = (t) => !!t && t.length <= 90 && t.split('\n').length <= 2;
    const block = (t, v) => `<div><h4>${t}</h4><div class="pre">${esc(v)}</div></div>`;
    const item = (e, ws) => { const k = kindOf(e); const vis = [md(parse(e.date)), e.date, e.session, e.format];
      const meta = [e.km != null && `${e.km}km`, e.minutes != null && durText(e.minutes), e.pace && `${e.pace}/km`, e.rpe != null && `RPE ${e.rpe}`, e.avg_hr && `평균 심박 ${e.avg_hr}`, e.max_hr && `최대 ${e.max_hr}`].filter(Boolean).map(esc);
      if (e.approx) meta.push('<span title="엑셀에 실제 날짜가 없어서 순서와 부위로 맞춘 기록이에요">세트 기록 날짜 추정</span>');
      let shown = '', hidden = '', label = ''; const rows = k === 'weights' ? liftRows(e) : null;
      if (rows) { const sum = rows.map((m) => (m[2] && /\d/.test(m[2]) ? `${m[1]} ${m[2]}` : m[1])).join(' · '); vis.push(sum);
        shown = `<p class="sum clamp">${esc(sum)}</p>`; hidden = liftTable(e); label = '세트 기록'; }
      else { const w = e.workout, n = e.notes; const parts = [];
        // the WOD is what the day was about: always shown in full, with the result beside it (under it on a phone)
        const res = e.result ? `<div class="res"><h4>Result</h4><div class="pre">${esc(e.result)}</div></div>` : '';
        if (w && res) shown += `<div class="wod"><div><h4>${k === 'hyrox' ? 'WOD' : 'Workout'}</h4><div class="pre">${esc(w)}</div></div>${res}</div>`;
        else if (w) shown += `<div class="pre sum">${esc(w)}</div>`; else shown += res;
        vis.push(w, e.result);
        if (short(n)) { shown += `<div class="pre sum q">${esc(n)}</div>`; vis.push(n); }
        else if (n) { if (e.brief) { shown += `<div class="pre sum q">${esc(e.brief)}</div>`; vis.push(e.brief); } hidden += block('Notes', n); parts.push('메모'); }
        if (hidden) hidden = `<div class="cols">${hidden}</div>`; label = parts.join(' · '); }
      const openIt = ws.length > 0 && hidden && !hit(vis.filter(Boolean).join('\n').toLowerCase(), ws);
      return `<div class="item k-${k}"><div class="top"><span class="ttl">${esc(e.session)}</span>${e.format ? `<span class="fmt">${esc(e.format)}</span>` : ''}${ahead(e) ? ' <span class="chip a">예정</span>' : ''}${tools(e.id)}</div>
        ${meta.length ? `<p class="meta num${k === 'run' ? ' fact' : ''}">${meta.join(' · ')}</p>` : ''}${shown}${hidden ? `<details class="ed"${openIt ? ' open' : ''}><summary>${label}</summary>${hidden}</details>` : ''}</div>`; };
    // a day is one row: the date once on the left, each session of that day stacked on the right
    const days = (rows, ws) => { const out = []; rows.forEach((e) => { const d = out[out.length - 1]; if (d && d.date === e.date) d.rows.push(e); else out.push({ date: e.date, rows: [e] }); });
      return out.map((d) => `<article class="entry${d.rows.length > 1 ? ' multi' : ''}"><div class="when">${fmtDate(d.date)}${d.rows.length > 1 ? `<span class="n num">${d.rows.length}개</span>` : ''}</div><div class="items">${d.rows.map((e) => item(e, ws)).join('')}</div></article>`).join(''); };
    const KN = { hyrox: 'Hyrox', run: 'Running', weights: 'Weight' };
    const render = () => { const ws = words();
      const rows = log.filter((e) => (filter === 'all' || kindOf(e) === filter) && (!ws.length || hit(hay(e), ws))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      const recap = !ws.length && (filter === 'all' || filter === 'weights') ? weightRecap(log) : null;
      // a month is one group; the month Hyrox began is two, so the 2026 recap can sit between them
      const groups = []; rows.forEach((e) => { const key = `${e.date.slice(0, 7)}${e.date >= HYROX_START ? 'h' : 'w'}`; let g = groups[groups.length - 1];
        if (!g || g.key !== key) { g = { key, rows: [] }; groups.push(g); } g.rows.push(e); });
      const isOpen = (g, i) => (ws.length ? true : list._open ? list._open.has(g.key) : i < 2);
      const split = (g) => groups.some((x) => x !== g && x.key.slice(0, 7) === g.key.slice(0, 7));
      const head = (g) => { const ym = g.key.slice(0, 7); const n = {}; const real = g.rows.filter((e) => !ahead(e)); real.forEach((e) => { const k = kindOf(e); n[k] = (n[k] || 0) + 1; });
        const kinds = filter === 'all' ? Object.keys(KN).filter((k) => n[k]).map((k) => `${KN[k]} ${n[k]}`).join(' · ') : '';
        return `<summary><span class="mo-t">${ym.slice(0, 4)}년 ${+ym.slice(5)}월${split(g) ? `<small>${g.key.endsWith('h') ? 'Hyrox 시작 후' : 'Hyrox 시작 전'}</small>` : ''}</span><span class="mo-n num">${real.length}건${real.length < g.rows.length ? ` + 예정 ${g.rows.length - real.length}` : ''}${kinds ? ` · ${kinds}` : ''}</span></summary>`; };
      let out = ''; let placed = false; const bodies = {};
      groups.forEach((g, i) => { if (recap && !placed && g.key.endsWith('w')) { out += recap.html; placed = true; }
        bodies[g.key] = () => days(g.rows, ws);
        out += `<details class="mo" data-g="${g.key}"${isOpen(g, i) ? ' open' : ''}>${head(g)}<div class="mo-b">${isOpen(g, i) ? bodies[g.key]() : ''}</div></details>`; });
      list._bodies = bodies; list._searching = ws.length > 0;
      list.innerHTML = out || `<p class="note" style="padding:24px 0">${ws.length ? `‘${esc(query)}’에 맞는 기록이 없어요.` : '기록이 없어요.'}</p>`;
      if (recap && placed) recap.draw();
      if (location.hash === '#wtRecap' && $('#wtRecap') && !render.jumped) { render.jumped = true; $('#wtRecap').scrollIntoView(); }
      $('#logCount').textContent = `${rows.length}건`;
      const gone = all.filter((e) => e.deleted).sort((a, b) => (a.deleted < b.deleted ? 1 : -1));
      $('#logTrash').innerHTML = canWrite() && gone.length ? `<details class="more"><summary>휴지통 · ${gone.length}건</summary><p class="note" style="margin:8px 0">지운 기록은 여기에 남아 있어요. 되살리면 원래 날짜 자리로 돌아가요.</p>${gone.map((e) =>
        `<div class="trash-row"><span class="num"><b>${md(parse(e.date))}</b></span><span>${esc(e.session)}${e.format ? ` · ${esc(e.format)}` : ''}</span><span class="muted small num">${md(parse(e.deleted))}에 지움</span><span class="tools"><button class="btn line sm" type="button" data-restore="${esc(e.id)}">되살리기</button><button class="ic" type="button" data-purge="${esc(e.id)}" title="완전히 지우기" aria-label="완전히 지우기">${ICON.del}</button></span></div>`).join('')}</details>` : '';
    };
    // A folded month is drawn the first time it is opened. Which months are open is remembered across redraws (not while searching).
    if (!list._bound) { list._bound = true; list.addEventListener('toggle', (ev) => { const d = ev.target; if (!d.classList || !d.classList.contains('mo') || !d.isConnected) return;
      const b = d.lastElementChild; if (d.open && !b.firstChild && list._bodies[d.dataset.g]) b.innerHTML = list._bodies[d.dataset.g]();
      if (!list._searching) list._open = new Set([...list.querySelectorAll('details.mo[open]')].map((x) => x.dataset.g)); }, true); }
    list._open = null; render();
    document.querySelectorAll('#logFilter button').forEach((b) => { b.onclick = () => { filter = b.dataset.f; list._open = null; document.querySelectorAll('#logFilter button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); render(); }; });
    let timer; search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { query = search.value.trim(); render(); }, 150); };
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
      if (k !== 'run' && f.format.value) e.format = f.format.value;
      if (dur != null) e.minutes = dur;
      ['km', 'rpe', 'avg_hr', 'max_hr'].forEach((n) => { if (n === 'km' && k !== 'run') return; const v = numOrNull(f[n].value); if (v != null) e[n] = v; });
      ['pace', 'workout', 'notes', 'result'].forEach((n) => { if ((n === 'pace' && k !== 'run') || (n === 'result' && (k === 'run' || k === 'weights'))) return; const v = f[n].value.trim(); if (v) e[n] = v; });
      if (k === 'run' && !e.pace && e.km > 0 && e.minutes > 0) e.pace = durClock(e.minutes / e.km);
      const now = vals(); const changed = FIELDS.filter((n) => now[n] !== base[n]); const wasNew = !editing;
      try { all = await save('log', (arr) => { const i = arr.findIndex((x) => x.id === e.id);
          if (i < 0) arr.push(e);
          else { // an edit starts from the entry as it is stored now and changes only what was changed in the form;
            // a different session is a rewrite, so then every field follows the form
            const next = { ...arr[i] }; (changed.includes('session') ? FIELDS : changed).forEach((n) => { if (n in e) next[n] = e[n]; else delete next[n]; });
            if (e.pace && !now.pace && (changed.includes('km') || changed.includes('minutes'))) next.pace = e.pace;   // worked out only when distance or time was edited: a day of jog + sprints keeps no overall pace
            if (changed.includes('date')) delete next.approx; if (changed.includes('notes')) delete next.brief;
            arr[i] = next; }
          arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); return arr; }, `log: ${e.date} ${e.session}`); log = live(all);
        if (wasNew) draftDrop();
        msg.textContent = token() ? '저장했어요. 다른 사람에게 보이기까지 1분쯤 걸려요.' : '이 기기에만 저장했어요 (미리보기).'; $('#logFormWrap').hidden = true; render();
      } catch (err) { msg.textContent = err.message; } finally { btn.disabled = false; } };
    const h = decodeURIComponent(location.hash);
    if (h.startsWith('#edit=') && canWrite()) { const e = log.find((x) => x.id === h.slice(6)); if (e) open(e); }
    if (h.startsWith('#new') && canWrite()) { const [s, fm] = h.slice(5).split('~'); open(null, s && SESSIONS.includes(s) ? { session: s, format: fm } : null); }
  }


  // Records: every day since the first record, newest first, with the form to add or fix a day.
  async function recordsPage() {
    let daily = await load('daily'); const [plan, log] = await Promise.all([load('plan'), load('log').then(done)]); let body = await load('inbody');
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
        out += `<tr><td class="num">${canWrite() ? `<button class="dbtn" type="button" data-edit="${ds}" title="이 날 기록 고치기" aria-label="${ds} 기록 고치기">${dayLabel}<span class="pen">${ICON_PEN}</span></button>` : dayLabel}</td>
          <td class="num">${sl == null ? '' : bar(esc(r.sleep), sl / sleepGoal * 100)}</td><td class="num muted d-only">${r.bed ? `${esc(r.bed)} → ${esc(r.wake || '')}` : ''}</td>
          ${clip(x.hyrox, 'c')}${clip(x.run, 'c')}${clip(wt, 'c')}<td class="m-only clip">${esc(allT)}</td><td class="num">${r.weight != null ? r.weight.toFixed(2) : ''}</td>
          <td class="num">${kc}</td><td class="num d-only">${mac('carb')}</td><td class="num d-only">${mac('prot')}</td><td class="num d-only">${mac('fat')}</td>${clip(noteT)}
          <td class="m-only"><button class="xp" type="button" aria-expanded="false" aria-label="${md(dt)} 자세히 보기">▾</button></td></tr>
          <tr class="more-row" hidden><td colspan="12" class="wrap">${detail || '<span class="muted">추가 기록 없음</span>'}</td></tr>`; }
      $('#dayCount').textContent = `${count}일${canWrite() ? ' · 날짜를 누르면 그날 기록을 고쳐요' : ''}`;
      $('#dayList').innerHTML = `<div class="scroll-x"><table class="t days"><thead><tr><th class="tl" style="width:8%">Date</th><th style="width:7%">Sleep</th><th class="d-only" style="width:9%">Bed → Wake</th><th class="d-only" style="width:11%">Hyrox</th><th class="d-only" style="width:17%">Running</th><th class="d-only" style="width:8%">Weight</th><th class="m-only tl">운동</th><th style="width:6%">Body kg</th><th style="width:7%">kcal</th><th class="d-only" style="width:5.5%">Carb</th><th class="d-only" style="width:5.5%">Prot</th><th class="d-only" style="width:5.5%">Fat</th><th class="d-only tl">Meals · Note</th><th class="m-only"></th></tr></thead><tbody>${out || '<tr><td colspan="12" class="muted">기록이 없어요.</td></tr>'}</tbody></table></div>`;
    }
    // The form remembers what it showed when it was filled. Saving writes only the fields changed since then, so a form left open
    // (or opened from an older copy) never blanks what another device saved in the meantime.
    const ALLF = NUM.concat(TXT, MEALS); const snap = () => { const o = {}; ALLF.forEach((k) => { o[k] = f[k].value.trim(); }); return o; }; let base = {};
    const fill = (d) => { const r = daily.find((x) => x.date === d) || {}; NUM.concat(TXT).forEach((k) => { f[k].value = r[k] ?? ''; }); MEALS.forEach((k) => { f[k].value = (r.meals && r.meals[k]) || ''; }); base = snap();
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
    // InBody: the latest measurement first, each number with its change since the one before; then every measurement as plain numbers
    // InBody (970 sheets only, the user's rule): the latest sheet first (the four main numbers, then the rest of the sheet,
    // each with its change since the last sheet that had it), then every sheet side by side.
    // Shown: the four main numbers, then score, visceral fat, BMI and BMR (the user's pick, 2026-11-27). Other sheet values stay in inbody.json, unshown.
    const BX = { weight: ['체중', 'kg', 1, 0], muscle: ['골격근량', 'kg', 1, 1], fat: ['체지방량', 'kg', 1, -1], fat_pct: ['체지방률', '%', 1, -1],
      score: ['인바디 점수', '점', 0, 1], vfa: ['내장지방', 'cm²', 1, -1], bmi: ['BMI', '', 1, 0], bmr: ['기초대사량', 'kcal', 0, 0] };   // label, unit, decimals, which way is better
    const bodyTable = () => { const rows = [...body].sort((a, b) => (a.date < b.date ? 1 : -1));
      const dot = (d) => { const p = parse(d); return `${p.getFullYear()}.${pad(p.getMonth() + 1)}.${pad(p.getDate())}`; };
      const val = (r, k) => (r[k] == null ? null : k === 'fat_pct' ? r[k] * 100 : r[k]);
      const fmt = (k, v) => (v == null ? '' : BX[k][2] === 0 ? Math.round(v).toLocaleString('en-US') : v.toFixed(BX[k][2]));
      const sg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
      const first970 = [...body].sort((a, b) => (a.date < b.date ? -1 : 1)).find((r) => r.device === '970');
      if (!rows.length) { $('#bodyNote').textContent = ''; $('#bodyTable').innerHTML = '<p class="note">측정 기록이 없어요.</p>'; return; }
      const [cur, prev] = rows;
      $('#bodyNote').textContent = first970 && first970 !== cur ? `InBody 970 첫 측정(${dot(first970.date)}) 대비 골격근량 ${sg(cur.muscle - first970.muscle)}kg · 체지방 ${sg(cur.fat - first970.fat)}kg` : '';
      // the change since the last earlier measurement that has this number (its date is named when it is not the one just before)
      const delta = (k) => { const v = val(cur, k); if (v == null) return null; const was = rows.slice(1).find((r) => val(r, k) != null); if (!was) return '첫 측정';
        const step = BX[k][2] === 3 ? 0.001 : BX[k][2] === 2 ? 0.01 : BX[k][2] === 0 ? 1 : 0.1; const d = Math.round((v - val(was, k)) / step) * step; const want = BX[k][3];
        const when = was !== prev ? ` <span class="muted">· ${md(parse(was.date))} 대비</span>` : '';
        if (Math.abs(d) < step / 2) return `직전과 같음${when}`;
        return `<span class="${!want ? '' : d * want > 0 ? 'd-good' : 'd-bad'}">${d > 0 ? '▲' : '▼'} ${BX[k][2] === 0 ? Math.round(Math.abs(d)) : Math.abs(d).toFixed(BX[k][2])}${k === 'fat_pct' ? '%p' : BX[k][1]}</span>${when}`; };
      const tile = (k) => `<div><div class="l">${BX[k][0]}</div><div class="v num">${fmt(k, val(cur, k))}<small>${BX[k][1]}</small></div><div class="s num">${delta(k)}</div></div>`;
      const more = ['score', 'vfa', 'bmi', 'bmr'].filter((k) => cur[k] != null);
      const SEG = [['la', '왼팔'], ['ra', '오른팔'], ['tr', '몸통'], ['ll', '왼다리'], ['rl', '오른다리']];
      const seg = cur.seg ? `<div class="body-box"><h4>부위별 근육 <span class="muted">· 표준 대비</span></h4><table class="t body-seg"><tbody>${SEG.filter(([k]) => cur.seg[k]).map(([k, n]) =>
        `<tr><td>${n}</td><td class="r num">${cur.seg[k][0].toFixed(2)}<small>kg</small></td><td class="r num">${cur.seg[k][1].toFixed(1)}<small>%</small></td></tr>`).join('')}</tbody></table></div>` : '';
      const side = cur.target != null ? `<div class="body-box"><h4>체중 조절 <span class="muted">· 결과지 권장</span></h4><dl class="body-dl"><dt>적정 체중</dt><dd class="num">${cur.target.toFixed(1)}<small>kg</small></dd><dt>지방 조절</dt><dd class="num">${sg(cur.fat_ctrl ?? 0)}<small>kg</small></dd><dt>근육 조절</dt><dd class="num">${sg(cur.muscle_ctrl ?? 0)}<small>kg</small></dd></dl></div>` : '';
      // every InBody 970 sheet side by side, newest first: the only measurements the user compares
      const cmpKeys = ['weight', 'muscle', 'fat', 'fat_pct', 'score', 'vfa', 'bmi', 'bmr'].filter((k) => rows.some((r) => r[k] != null));
      const cmp = rows.length > 1 ? `<h4 class="body-hist">InBody 970 결과지 비교 <span class="muted num">· ${rows.length}회 · ${dot(rows[rows.length - 1].date)}부터</span></h4><div class="scroll-x body-cmp"><table class="t body-all"><thead><tr><th></th>${rows.map((r) => `<th class="r num">${md(parse(r.date))}<br><span class="muted">${r.date.slice(0, 4)}</span></th>`).join('')}</tr></thead><tbody>${cmpKeys.map((k) =>
        `<tr${['weight', 'muscle', 'fat', 'fat_pct'].includes(k) ? ' class="key"' : ''}><td>${BX[k][0]} <small>${BX[k][1]}</small></td>${rows.map((r) => `<td class="r num">${fmt(k, val(r, k))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
      $('#bodyTable').innerHTML = `<p class="body-h">최근 측정 <b class="num">${dot(cur.date)}</b>${cur.device ? ` <span class="chip num">InBody ${esc(cur.device)}</span>` : ''}${prev ? `<span class="num">화살표는 직전 측정(${dot(prev.date)}) 대비</span>` : ''}</p>
        <div class="kv body-now">${['weight', 'muscle', 'fat', 'fat_pct'].map(tile).join('')}</div>
        ${more.length ? `<div class="kv body-more">${more.map(tile).join('')}</div>` : ''}
        ${seg || side ? `<div class="body-two">${seg}${side}</div>` : ''}
        ${cmp}`;
    };

    const bf = $('#bodyForm'); $('#bodyNew').hidden = !canWrite();
    $('#bodyNew').onclick = () => { bf.elements.date.value = TODAY; bf.hidden = false; }; $('#bodyCancel').onclick = () => { bf.hidden = true; };
    bf.onsubmit = async (ev) => { ev.preventDefault(); const e = bf.elements; const v = (k) => numOrNull(e[k].value); const m = $('#bodyMsg');
      if ([v('weight'), v('muscle'), v('fat'), v('fat_pct')].some((x) => x == null)) { m.textContent = '위의 네 칸은 숫자로 채워주세요.'; return; }
      const row = { date: e.date.value, device: '970', weight: v('weight'), muscle: v('muscle'), fat: v('fat'), fat_pct: Math.round(v('fat_pct') * 10) / 1000 };
      ['score', 'vfa', 'bmi', 'bmr'].forEach((k) => { if (v(k) != null) row[k] = v(k); });     // the rest of the sheet, when it is typed in
      m.textContent = '저장하는 중…';
      // a measurement already stored for that day keeps what this form does not ask for (segmental lean, phase angle...)
      try { body = await save('inbody', (arr) => { const had = arr.find((x) => x.date === row.date); if (had) Object.assign(had, row); else arr.push(row); arr.sort((x, y) => (x.date < y.date ? -1 : 1)); return arr; }, `inbody: ${row.date}`);
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
    form.onsubmit = async (ev) => { ev.preventDefault(); const btn = $('#daySave'); const d = f.date.value;
      const now = snap(); const changed = ALLF.filter((k) => now[k] !== base[k]);
      if (!changed.length) { msg.textContent = '바뀐 내용이 없어요.'; return; }
      const bad = ['bed', 'wake'].find((k) => changed.includes(k) && now[k] && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(now[k]));
      if (bad) { msg.textContent = '시각은 1:30이나 23:40처럼 적어주세요.'; f[bad].focus(); return; }
      btn.disabled = true; msg.textContent = '저장하는 중…';
      // the time in bed, as the site works it out; a measured sleep (a watch) is shorter than that and is never overwritten here
      const span = (r) => { const b = mins(r.bed), w = mins(r.wake); return b != null && w != null ? (w - b + 1440) % 1440 : null; };
      try { daily = await save('daily', (arr) => { let r = arr.find((x) => x.date === d); if (!r) { r = { date: d }; arr.push(r); }
          const worked = r.sleep_src !== 'garmin' && (r.sleep == null || mins(r.sleep) === span(r));     // was the stored sleep worked out from bed and wake?
          changed.forEach((k) => { const v = now[k];
            if (NUM.includes(k)) { const n = numOrNull(v); if (n == null) delete r[k]; else r[k] = n; }
            else if (TXT.includes(k)) { if (v) r[k] = v; else delete r[k]; }
            else { r.meals = r.meals || {}; if (v) r.meals[k] = v; else delete r.meals[k]; } });
          if (r.meals && !Object.keys(r.meals).length) delete r.meals;
          if (worked && (changed.includes('bed') || changed.includes('wake'))) { const m = span(r); if (m == null) delete r.sleep; else r.sleep = hm(m); }
          arr.sort((a, b2) => (a.date < b2.date ? -1 : 1)); return arr; }, `daily: ${d}`);
        msg.textContent = token() ? '저장했어요. 다른 사람에게 보이기까지 1분쯤 걸려요.' : '이 기기에만 저장했어요 (미리보기).';
        ix = dayIndex(daily, log); table(); care(); if (f.date.value === d) fill(d);      // the form now shows the day as it is stored, other devices' fields included
      } catch (err) { msg.textContent = err.message; } finally { btn.disabled = false; } };

    if (location.hash === '#new' && canWrite()) open(TODAY);
  }

  chrome();
  const run = { hub, training, plan: planPage, log: logPage, records: recordsPage }[PAGE];
  const fail = (e) => { console.error(e); const m = $('main'); if (m) m.prepend(el(`<div class="wrap"><div class="banner" style="margin-top:16px">기록을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요. (${esc(e.message)})</div></div>`)); };
  // After the background fetch: say so when the page is showing an older copy, or when the saved token no longer works.
  const notice = () => { if (PAGE === 'hub') return; const old = $('#syncNote'); if (old) old.remove(); let t = '';
    if (sync.auth) t = '이 기기에 넣어둔 토큰이 만료됐거나 권한이 없어요. 지금은 공개된 기록을 보여주고 있고, 저장은 되지 않아요. 오른쪽 위 열쇠 버튼에서 새 토큰을 넣어주세요.';
    else if (sync.stale) { let at = ''; try { const v = Number(localStorage.getItem('cache.v1.at')); if (v) { const d = new Date(v); at = `${md(d)} ${d.getHours()}:${pad(d.getMinutes())}에 `; } } catch { /* ignore */ }
      t = `연결이 불안정해서 새 기록을 받아오지 못했어요. ${at}받아둔 기록을 보여주고 있어요.`; }
    const m = $('main'); if (t && m) m.prepend(el(`<div class="wrap" id="syncNote"><div class="banner" role="status" style="margin:16px 0 0">${t}</div></div>`)); };
  // The watch sync (tools/garmin_sync.py, hourly on GitHub) leaves a mark in data/garmin.json when its Garmin login stops working.
  // Only the owner can do anything about it, so only a device with a token shows the note.
  const garminNote = () => { if (PAGE !== 'training' || !token() || $('#garminNote')) return;
    fetch(`${ROOT}data/garmin.json?v=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).then((g) => { const m = $('main');
      if (g && g.error === 'auth' && m && !$('#garminNote')) m.prepend(el('<div class="wrap" id="garminNote"><div class="banner" role="status" style="margin:16px 0 0">Garmin 연결이 끊겨서 워치 기록이 자동으로 들어오지 않고 있어요. PC에서 Garmin 로그인 도구(tools/garmin_login.py)를 한 번 다시 실행하면 이어져요.</div></div>')); }).catch(() => { /* no note is fine */ }); };
  const typing = () => !!document.querySelector('#logFormWrap:not([hidden]), #dayFormWrap:not([hidden]), dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
  if (run) run().then(() => { performance.mark('site-drawn'); return Promise.all(pending.splice(0)); }).then((changed) => { settled = true; notice(); garminNote(); if (changed.some(Boolean) && !typing()) return run(); return null; }).catch(fail);
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
