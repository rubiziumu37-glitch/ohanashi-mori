// おはなしの森の図書館 ― 本だな・札でしぼりこみ・本文の表示（見せ方・しるし・読む行だけ）・範読・印刷
// データは data/stories.json（物語）と data/words.json（札）。この画面は読むだけで、書きかえない。
'use strict';

const $ = (id) => document.getElementById(id);
const KANSUJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MARKS = ['hito', 'kaiwa', 'toki', 'basho', 'oto', 'kokoro'];
const MARK_TAG = /\[(人|時|所|音|心):([^\[\]]+)\]/;   // しるし1つ（内側から順に外す）
const MARK_CLASS = { 人: 'm-hito', 時: 'm-toki', 所: 'm-basho', 音: 'm-oto', 心: 'm-kokoro' };
const MARK_SEL = { hito: '.m-hito', kaiwa: '.ln.kaiwa', toki: '.m-toki', basho: '.m-basho', oto: '.m-oto', kokoro: '.m-kokoro' };   // しるしの種類ごとの、本文の中の場所
const PREF_KEY = 'ohanashi-mori-view';   // 見せ方の好みだけを端末に覚える（物語や記録ではない）

const app = {
  stories: [],
  words: [],
  filter: null,      // いま選んでいる札の名前（null＝すべて）
  story: null,       // 開いている物語
  view: { vertical: true, fs: null, wakachi: true, slit: false, ui: true, motion: true, markOne: false },
  lit: new Set(),    // ついているしるし（本文の中の通し番号 data-id）。1つずつ、つけたり消したりできる
  cur: 0,            // 読む行（行の通し番号）
  audio: null,       // 範読の音声（audio/*.wav）。音声のある物語だけ
  reading: false,    // 範読の途中（読んでいる行に色をつける）
};

// ---------- 小さな道具 ----------
function kansuji(n) {
  // 1〜99 を漢数字に（十一、二十 など）
  if (n < 10) return KANSUJI[n];
  const t = Math.floor(n / 10), o = n % 10;
  return (t === 1 ? '' : KANSUJI[t]) + '十' + (o ? KANSUJI[o] : '');
}
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function plain(t) {
  // しるしの記号を外した本文（入れ子のしるしも外す）
  while (MARK_TAG.test(t)) t = t.replace(MARK_TAG, '$2');
  return t;
}
function charCount(story) {
  // 文字数（言葉の区切りの空白は数えない）
  let n = 0;
  story.scenes.forEach((sc) => sc.forEach((l) => { n += plain(l.t).replace(/[\s　]/g, '').length; }));
  return n;
}
function wordColor(name) {
  const w = app.words.find((x) => x.name === name);
  return w ? w.color : '#9E9E9E';
}
function loadPref() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    Object.assign(app.view, p, { slit: false, ui: true, fs: null });
  } catch (e) { /* 覚えられない端末では、毎回はじめの見せ方 */ }
}
function savePref() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ vertical: app.view.vertical, wakachi: app.view.wakachi, motion: app.view.motion, markOne: app.view.markOne }));
  } catch (e) { /* なにもしない */ }
}

// ---------- 読みこみ ----------
async function load() {
  try {
    const [s, w] = await Promise.all([
      fetch('data/stories.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/words.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    app.stories = s.stories.slice().sort((a, b) => a.no - b.no);
    app.words = w.words;
  } catch (e) {
    $('bookcase').innerHTML = '<p class="empty" style="color:#fff">物語のデータを読みこめませんでした。インターネットにつながっているか確かめて、ページを読みこみ直してください。</p>';
    return;
  }
  loadPref();
  syncMotion();
  renderChips();
  renderShelf();
  if (location.hash.startsWith('#s')) openStory(location.hash.slice(1));
}

// ---------- 本だな ----------
function renderChips() {
  // 物語に使われている札だけを、words.json の順に出す
  const used = app.words.filter((w) => app.stories.some((s) => s.words.includes(w.name)));
  const chips = [{ name: null, label: 'すべて', color: '#5D4037', n: app.stories.length }]
    .concat(used.map((w) => ({ name: w.name, label: w.name, color: w.color, n: app.stories.filter((s) => s.words.includes(w.name)).length })));
  const box = $('chips');
  box.innerHTML = '';
  chips.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.setProperty('--c', c.color);
    b.setAttribute('aria-pressed', String(app.filter === c.name));
    b.innerHTML = `${esc(c.label)}<span class="n">${c.n}</span>`;
    b.onclick = () => { app.filter = c.name; renderChips(); renderShelf(); };
    box.appendChild(b);
  });
}

function renderShelf() {
  const list = app.stories.filter((s) => !app.filter || s.words.includes(app.filter));
  const shelf = $('bookcase');
  shelf.innerHTML = '';
  $('empty').hidden = list.length > 0;
  // 2段の棚に、上の段から半分ずつならべる（1段は11冊まで）
  const upper = document.createElement('div'), lower = document.createElement('div');
  upper.className = 'row upper';
  lower.className = 'row lower';
  shelf.appendChild(upper);
  shelf.appendChild(lower);
  const split = Math.min(11, Math.ceil(list.length / 2));
  list.forEach((s, idx) => {
    const b = document.createElement('button');
    b.className = 'book';
    // 本の背の色：しぼりこみ中はその札の色、ふだんは最初の札の色
    b.style.setProperty('--c', wordColor(app.filter || s.words[0]));
    b.title = `${s.title}（${charCount(s)}字）\nねらい：${s.aim || ''}\n札：${s.words.join('・')}`;
    b.innerHTML = `<span class="no">${kansuji(s.no)}</span><span class="ttl">${esc(s.title)}</span><span class="band"></span><span class="kind">${esc(s.type)}</span>`;
    b.onclick = () => playIntro(b, s);
    (idx < split ? upper : lower).appendChild(b);
  });
}

function syncMotion() {
  $('btnMotion').setAttribute('aria-pressed', String(app.view.motion));
  $('btnMotion').textContent = app.view.motion ? '動き：あり' : '動き：なし';
}

// ---------- 本をひらく動き：本を棚からとる → 光 → 表紙がひらく → 本文がふわっと浮かぶ ----------
let intro = null;   // 動いている最中の { el, anims, timers }

function motionOk() {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return app.view.motion && !reduce && !!Element.prototype.animate;
}

function finishIntro() {
  if (!intro) return;
  intro.timers.forEach(clearTimeout);
  intro.anims.forEach((a) => { try { a.cancel(); } catch (e) { /* なにもしない */ } });
  intro.el.remove();
  intro = null;
}

function playIntro(btn, s) {
  if (!motionOk() || intro) { openStory(s.id); return; }
  const vw = window.innerWidth, vh = window.innerHeight;
  const bh = Math.min(vh * 0.62, 460), bw = bh * 0.76;
  const r = btn.getBoundingClientRect();
  const color = getComputedStyle(btn).getPropertyValue('--c') || '#2E6B3F';
  const el = document.createElement('div');
  el.className = 'intro';
  el.style.setProperty('--bw', bw + 'px');
  el.style.setProperty('--bh', bh + 'px');
  el.style.setProperty('--c', color);
  el.innerHTML = '<div class="glow"></div><div class="book3d"><div class="back"></div><div class="blk"></div>' +
    '<div class="cover"><div class="face front"><span class="no">' + kansuji(s.no) + '</span><span class="ttl">' + esc(s.title) + '</span></div><div class="face inside"></div></div></div>' +
    '<div class="openbook"><img src="img/book-open.png" alt=""><div class="pg lp"><span class="t">' + s.title.split('　').map((w) => '<span>' + esc(w) + '</span>').join('') + '</span></div>' +
    '<div class="pg rp">' + s.scenes.flat().slice(0, 6).map((l) => '<span>' + esc(plain(l.t).replace(/[\s　]/g, '')) + '</span>').join('') + '</div></div>';
  document.body.appendChild(el);
  const book = el.querySelector('.book3d'), cover = el.querySelector('.cover'), glow = el.querySelector('.glow');
  intro = { el, anims: [], timers: [] };
  const go = (node, frames, opt) => { const a = node.animate(frames, Object.assign({ fill: 'both' }, opt)); intro.anims.push(a); return a; };
  const later = (ms, fn) => intro.timers.push(setTimeout(fn, ms));

  // 1. 本をとる：棚の本の位置から、画面の中央へ
  const dx = r.left + r.width / 2 - vw / 2, dy = r.top + r.height / 2 - vh / 2;
  go(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
  go(book, [
    { transform: `translate(${dx}px, ${dy}px) scale(${r.width / bw}, ${r.height / bh}) rotateY(0deg)` },
    { transform: `translate(0px, ${-bh * 0.04}px) scale(1.04) rotateY(-14deg)`, offset: 0.7 },
    { transform: 'translate(0px, 0px) scale(1) rotateY(-14deg)' },
  ], { duration: 800, easing: 'cubic-bezier(.25,.8,.3,1)' });
  // 2. 光がふくらむ
  go(glow, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: .9, transform: 'scale(1.6)' }], { duration: 900, delay: 650, easing: 'ease-out' });
  // 3. 表紙がひらく
  go(cover, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-172deg)' }], { duration: 1000, delay: 1050, easing: 'cubic-bezier(.4,.1,.2,1)' });
  go(book, [{ transform: 'translate(0,0) scale(1) rotateY(-14deg)' }, { transform: `translate(${bw / 2}px, 0) scale(1.05) rotateY(0deg)` }], { duration: 1000, delay: 1050, easing: 'ease-in-out' });
  go(glow, [{ opacity: .9, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(4.2)' }], { duration: 900, delay: 1500, easing: 'ease-in' });
  // 表紙がひらききるころ、ひらいた本の絵に入れかえる
  go(el.querySelector('.openbook'),[{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 1750 });
  go(book, [{ opacity: 1 }, { opacity: 0 }], { duration: 450, delay: 1750 });
  // 4. 光のなかで本文を出し、光がやわらぐ。本文はふわっと浮かぶ
  later(2250, () => {
    openStory(s.id);
    const page = $('page');
    page.classList.add('rise');
    page.addEventListener('animationend', () => page.classList.remove('rise'), { once: true });
    go(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' });
    go(glow, [{ opacity: 1 }, { opacity: 0 }], { duration: 700 });
    later(950, finishIntro);
  });
  // 途中で押したら、すぐ本文へ
  el.onclick = () => { if (!app.story) { finishIntro(); openStory(s.id); } };
}

// ---------- 本文 ----------
function openStory(id) {
  const s = app.stories.find((x) => x.id === id);
  if (!s) return;
  app.story = s;
  app.cur = 0;
  app.view.fs = null;
  app.lit = new Set();
  app.view.slit = false;
  setupAudio(s);
  history.replaceState(null, '', '#' + id);
  $('shelf').hidden = true;
  $('reader').hidden = false;
  const head = s.title.startsWith('ミニストーリー') ? s.title : `ミニストーリー${kansuji(s.no)}　${s.title.replace(/　/g, ' ')}`;
  $('info').textContent = `${head}　（${charCount(s)}字）`;
  renderPage();
  syncButtons();
  fitText();
  // 文字の形（フォント）が読みこまれたら、もう一度合わせる
  if (document.fonts) document.fonts.ready.then(() => { if (app.story === s) fitText(); });
}

function closeStory() {
  teardownAudio();
  app.story = null;
  history.replaceState(null, '', location.pathname);
  $('reader').hidden = true;
  $('shelf').hidden = false;
}

function lineHtml(t, wakachi = app.view.wakachi) {
  let h = esc(t);
  if (!wakachi) h = h.replace(/　/g, '');
  // 入れ子のしるし（[心:[音:にっこり]　わらいました]）は内側から順に span にする
  while (MARK_TAG.test(h)) h = h.replace(MARK_TAG, (m, k, w) => `<span class="${MARK_CLASS[k]} mk-i">${w}</span>`);
  return h;
}

function renderPage() {
  const s = app.story;
  const page = $('page');
  const parts = [`<div class="ttl">${esc(s.title)}</div>`];
  let i = 0;
  s.scenes.forEach((sc) => {
    parts.push('<div class="scene">');
    sc.forEach((l) => {
      const kind = s.type === '詩' ? 'shi' : (l.t.startsWith('「') ? 'kaiwa' : 'ji');
      const sp = l.sp ? ` data-sp="${esc(l.sp)}"` : '';
      parts.push(`<span class="ln ${kind}${kind === 'kaiwa' ? ' mk-i' : ''}" data-i="${i}"${sp}>${lineHtml(l.t)}</span>`);
      i++;
    });
    parts.push('</div>');
  });
  page.innerHTML = parts.join('');
  // しるしに通し番号をつけ、ついているものをもどす（分かち書きを切りかえても、ついたまま）
  page.querySelectorAll('.mk-i').forEach((el, n) => { el.dataset.id = n; el.classList.toggle('on', app.lit.has(n)); });
  applyView();
}

function applyView() {
  const page = $('page');
  const v = app.view;
  page.classList.toggle('v', v.vertical);
  page.classList.toggle('h', !v.vertical);
  // 横書きで行が多いときは2段にして、文字を大きく保つ
  page.classList.toggle('cols', !v.vertical && page.querySelectorAll('.ln').length >= 12);
  page.classList.toggle('slit', v.slit);
  page.classList.toggle('reading', app.reading);
  page.querySelectorAll('.ln').forEach((el) => el.classList.toggle('cur', +el.dataset.i === app.cur));
  if (v.fs) page.style.setProperty('--fs', v.fs + 'px');
  // 左のパネルのはばのぶん、本文を右に
  const tb = $('toolbar');
  tb.hidden = !v.ui;
  $('btnShow').hidden = v.ui;
  $('reader').style.setProperty('--tb-w', v.ui ? tb.offsetWidth + 'px' : '0px');
}

function syncButtons() {
  const v = app.view;
  $('btnDir').textContent = v.vertical ? '縦書き' : '横書き';
  $('btnDir').setAttribute('aria-pressed', 'false');
  $('btnWakachi').setAttribute('aria-pressed', String(v.wakachi));
  $('btnSlit').setAttribute('aria-pressed', String(v.slit));
  $('btnMarkMode').textContent = v.markOne ? '1つずつ順番に' : 'いっせいに';
  $('btnMarkMode').setAttribute('aria-pressed', String(v.markOne));
  // しるしのボタン：ついた数／ぜんぶ。本文にないしるしのボタンは押せなくする（詩には会話文がない、など）
  document.querySelectorAll('#toolbar .mk').forEach((b) => {
    const items = markItems(b.dataset.mark);
    const lit = items.filter((el) => el.classList.contains('on')).length;
    if (!b.dataset.name) b.dataset.name = b.textContent;
    b.innerHTML = esc(b.dataset.name) + (items.length ? `<span class="cnt">${lit} / ${items.length}</span>` : '');
    b.setAttribute('aria-pressed', String(lit > 0));
    b.disabled = !items.length;
    b.style.opacity = items.length ? 1 : .4;
  });
}

function hasMark(m) {
  const s = app.story;
  if (!s) return false;
  const lines = s.scenes.flat();
  if (m === 'kaiwa') return s.type !== '詩' && lines.some((l) => l.t.startsWith('「'));
  const key = { hito: '[人:', toki: '[時:', basho: '[所:', oto: '[音:', kokoro: '[心:' }[m];
  return lines.some((l) => l.t.includes(key));
}

// ---------- しるし：1つずつ、つけたり消したりする ----------
function markItems(m) {
  return Array.from($('page').querySelectorAll(MARK_SEL[m]));
}

function setLit(el, on, pop) {
  const id = +el.dataset.id;
  if (on) app.lit.add(id); else app.lit.delete(id);
  el.classList.toggle('on', on);
  if (on && pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
}

// しるしのボタン：「いっせいに」なら全部つける（全部ついていたら消す）。
// 「1つずつ順番に」なら、まだついていない次の1つをつける（全部ついていたら消して、はじめから）
function pressMark(m) {
  const items = markItems(m);
  const off = items.filter((el) => !el.classList.contains('on'));
  if (!off.length) items.forEach((el) => setLit(el, false));
  else if (app.view.markOne) {
    setLit(off[0], true, true);
    off[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else off.forEach((el) => setLit(el, true));
  syncButtons();
}

// 本文を押したとき：しるしのある言葉はその言葉だけ、会話文の行はその行だけ、ついたり消えたりする。
// 「読む行だけ」のときは、言葉以外のところを押すと読む行が動く
function onPageClick(e) {
  if (!app.story) return;
  const item = e.target.closest('.mk-i');
  const ln = e.target.closest('.ln');
  if (item && !item.classList.contains('ln')) { setLit(item, !item.classList.contains('on'), true); syncButtons(); return; }
  if (ln && app.view.slit) { setCur(+ln.dataset.i); return; }
  if (item) { setLit(item, !item.classList.contains('on'), true); syncButtons(); }
}

// 画面に収まるいちばん大きい文字にする
function fitText() {
  const page = $('page');
  const fits = (px) => {
    page.style.setProperty('--fs', px + 'px');
    return page.scrollWidth <= page.clientWidth + 1 && page.scrollHeight <= page.clientHeight + 1;
  };
  let lo = 14, hi = 140;
  if (!fits(lo)) { app.view.fs = lo; return; }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid;
  }
  app.view.fs = lo;
  page.style.setProperty('--fs', lo + 'px');
}

function setCur(i) {
  const n = $('page').querySelectorAll('.ln').length;
  app.cur = Math.max(0, Math.min(n - 1, i));
  applyView();
  const el = $('page').querySelector('.ln.cur');
  if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---------- 範読（音声）：story.audio = { src, cues }。cues[i] は i 行目を読みはじめる秒 ----------
function teardownAudio() {
  if (app.audio) { app.audio.pause(); app.audio.removeAttribute('src'); app.audio.load(); }
  app.audio = null;
  app.reading = false;
  $('grpAudio').hidden = true;
  $('btnPlay').setAttribute('aria-pressed', 'false');
}

function setupAudio(s) {
  teardownAudio();
  if (!s.audio) return;
  const a = new Audio(s.audio.src);
  a.preload = 'auto';
  a.onended = () => { app.reading = false; syncPlay(); applyView(); };
  a.onpause = syncPlay;
  a.ontimeupdate = syncLine;   // 画面が見えていないときなど、描画が止まる場合の保険
  a.onplay = () => { app.reading = true; syncPlay(); tickAudio(); };
  app.audio = a;
  $('grpAudio').hidden = false;
  syncPlay();
}

function syncPlay() {
  const playing = !!app.audio && !app.audio.paused && !app.audio.ended;
  $('btnPlay').setAttribute('aria-pressed', String(playing));
  $('btnPlay').textContent = playing ? '■ とめる' : '▶ 範読';
}

function lineAt(t) {
  // 時刻 t にいる行（題名のあいだは -1）
  const cues = app.story.audio.cues;
  let i = -1;
  while (i + 1 < cues.length && cues[i + 1] <= t) i++;
  return i;
}

function syncLine() {
  const a = app.audio;
  if (!a || !app.reading) return;
  const i = lineAt(a.currentTime);
  if (i !== app.cur) {
    app.cur = i;
    applyView();
    const el = $('page').querySelector('.ln.cur');
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function tickAudio() {
  const a = app.audio;
  if (!a || a.paused || a.ended) return;
  syncLine();
  requestAnimationFrame(tickAudio);
}

function togglePlay() {
  const a = app.audio;
  if (!a) return;
  if (a.paused || a.ended) {
    if (a.ended) a.currentTime = 0;
    a.play().catch(() => { /* 音が出せない端末では、何もしない */ });
  } else {
    a.pause();
  }
}

function rewindAudio() {
  const a = app.audio;
  if (!a) return;
  a.pause();
  a.currentTime = 0;
  app.reading = false;
  app.cur = 0;
  syncPlay();
  applyView();
}

// ---------- 印刷（プリント・ワークシートをつくる） ----------
// 左で形をえらび、右に A4 の仕上がりを出す。印刷はブラウザの印刷（PDFに保存もできる）。
const SEIRI_LABEL = { 登場人物: 'だれ', 時間: 'いつ', 場所: 'どこ', 心情: 'きもち' };   // 整理欄の見出し（ほかの札は札の名前）
const PR_MARKS = [['hito', '登場人物'], ['kaiwa', '会話文'], ['toki', '時間'], ['basho', '場所'], ['oto', 'オノマトペ'], ['kokoro', '心情']];
const MM = 96 / 25.4;   // 1mm のピクセル数
let pr = null;          // 印刷の設定（開くたびに、いまの本文の見せ方から作る）

function openPrinter() {
  const s = app.story;
  if (!s) return;
  const sw = s.words.filter((w) => SEIRI_LABEL[w]);
  pr = {
    title: s.title,
    landscape: true, vertical: app.view.vertical, wakachi: app.view.wakachi,
    fs: 'auto', marks: Object.fromEntries(MARKS.map((m) => [m, markItems(m).some((el) => el.classList.contains('on'))])), dots: false, kuten: false,
    name: true, date: true,
    seiriOn: false, seiri: {}, boxes: 5,
  };
  sw.forEach((w) => { pr.seiri[w] = true; });
  $('reader').hidden = true;
  $('printer').hidden = false;
  buildPrintOpts();
  renderSheet();
}

function closePrinter() {
  $('printer').hidden = true;
  $('reader').hidden = false;
  pr = null;
  fitText();
}

function buildPrintOpts() {
  const s = app.story;
  const box = $('prOpts');
  const tog = (k, v, text) => `<button class="btn tog" data-k="${k}" data-v="${v}" aria-pressed="${String(pr[k] === v)}">${text}</button>`;
  const ck = (k, text) => `<label class="ck"><input type="checkbox" data-ck="${k}" ${pr[k] ? 'checked' : ''}>${text}</label>`;
  const seiriWords = s.words.map((w) => `<label class="ck"><input type="checkbox" data-seiri="${esc(w)}" ${pr.seiri[w] ? 'checked' : ''}>${SEIRI_LABEL[w] ? `「${esc(SEIRI_LABEL[w])}」（${esc(w)}）` : esc(w)}</label>`).join('');
  box.innerHTML = `
    <h3>題名</h3>
    <div class="row"><input type="text" id="prTitle" value="${esc(pr.title)}"></div>
    <h3>用紙（A4）</h3>
    <div class="row">${tog('landscape', true, '横')}${tog('landscape', false, '縦')}</div>
    <h3>書き方</h3>
    <div class="row">${tog('vertical', true, '縦書き')}${tog('vertical', false, '横書き')}</div>
    <div class="row">${ck('wakachi', '分かち書き（言葉の区切りをあける）')}</div>
    <h3>文字の大きさ</h3>
    <div class="row"><select id="prFs">
      ${['auto', 14, 16, 18, 20, 24, 28].map((v) => `<option value="${v}" ${String(pr.fs) === String(v) ? 'selected' : ''}>${v === 'auto' ? '自動（用紙にぴったり）' : v + ' pt'}</option>`).join('')}
    </select></div>
    <h3>しるし（色）</h3>
    <div class="row">${PR_MARKS.map(([m, n]) => `<button class="btn tog mk ${m}" data-mark="${m}" aria-pressed="${!!pr.marks[m]}" ${hasMark(m) ? '' : 'disabled style="opacity:.4"'}>${n}</button>`).join('')}</div>
    <h3>作業用の印</h3>
    <div class="row">${ck('dots', '地の文の両端に点（・）をつける')}</div>
    <div class="row">${ck('kuten', '句点（。）を赤にする')}</div>
    <h3>整理欄（書きこむマス）</h3>
    <div class="row">${ck('seiriOn', '整理欄を入れる')}</div>
    <div class="row" style="flex-direction:column;align-items:flex-start">${seiriWords}</div>
    <div class="row">マスの数 <input type="number" id="prBoxes" min="1" max="14" value="${pr.boxes}"></div>
    <h3>名前・日付</h3>
    <div class="row">${ck('name', '名前の欄')}${ck('date', '日付の欄')}</div>
    <p class="note">「印刷する」を押すと、ブラウザの印刷の画面がひらきます。「PDFに保存」もえらべます。</p>`;
}

function onPrintOpt(e) {
  const t = e.target;
  const b = t.closest && t.closest('button');
  if (b && b.dataset.k) { pr[b.dataset.k] = b.dataset.v === 'true'; }
  else if (b && b.dataset.mark) { pr.marks[b.dataset.mark] = !pr.marks[b.dataset.mark]; }
  else if (t.dataset && t.dataset.ck) { pr[t.dataset.ck] = t.checked; }
  else if (t.dataset && t.dataset.seiri) { pr.seiri[t.dataset.seiri] = t.checked; pr.seiriOn = true; }
  else if (t.id === 'prTitle') { pr.title = t.value; renderSheet(); return; }
  else if (t.id === 'prFs') { pr.fs = t.value === 'auto' ? 'auto' : +t.value; }
  else if (t.id === 'prBoxes') { pr.boxes = Math.max(1, Math.min(14, +t.value || 5)); }
  else return;
  buildPrintOpts();
  renderSheet();
}

function sheetScenes(s) {
  let h = '';
  s.scenes.forEach((sc) => {
    h += '<div class="scene">';
    sc.forEach((l) => {
      const kind = s.type === '詩' ? 'shi' : (l.t.startsWith('「') ? 'kaiwa' : 'ji');
      let t = lineHtml(l.t, pr.wakachi);
      if (pr.kuten) t = t.replace(/。/g, '<span class="kuten">。</span>');
      h += `<span class="ln ${kind}">${t}</span>`;
    });
    h += '</div>';
  });
  return h;
}

function renderSheet() {
  const s = app.story;
  const sheet = $('sheet');
  sheet.className = 'sheet ' + (pr.landscape ? 'landscape' : 'portrait');
  const top = (pr.name || pr.date)
    ? `<div class="s-top">${pr.name ? 'なまえ <span class="u">&nbsp;</span>' : ''}${pr.date ? 'ひづけ <span class="u" style="width:30mm">&nbsp;</span>' : ''}</div>` : '';
  const seiri = pr.seiriOn
    ? `<div class="seiri">${s.words.filter((w) => pr.seiri[w]).map((w) => `<div class="srow"><span>${esc(SEIRI_LABEL[w] || w)}</span><span>→</span><span class="boxes">${'<span class="box"></span>'.repeat(pr.boxes)}</span></div>`).join('')}</div>` : '';
  const cls = ['page', pr.vertical ? 'v' : 'h', pr.dots ? 'dots' : ''].concat(PR_MARKS.filter(([m]) => pr.marks[m]).map(([m]) => 'mk-' + m)).join(' ');
  sheet.innerHTML = `${top}<h1>${esc(pr.title)}</h1><div class="s-text"><div class="${cls}">${sheetScenes(s)}</div></div>${seiri}`;
  layoutSheet();
}

function layoutSheet() {
  const sheet = $('sheet');
  const page = sheet.querySelector('.s-text .page');
  // 文字の大きさ：自動のときは、用紙におさまる最大の大きさ
  if (pr.fs === 'auto') {
    const fits = (px) => { page.style.setProperty('--fs', px + 'px'); return page.scrollWidth <= page.clientWidth + 1 && page.scrollHeight <= page.clientHeight + 1; };
    let lo = 10, hi = 64;
    if (!fits(lo)) { page.style.setProperty('--fs', lo + 'px'); }
    else { while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(mid)) lo = mid; else hi = mid; } page.style.setProperty('--fs', lo + 'px'); }
  } else {
    page.style.setProperty('--fs', (pr.fs * 96 / 72) + 'px');
  }
  page.classList.toggle('cols', !pr.vertical && page.querySelectorAll('.ln').length >= 12);
  // 画面の大きさに合わせて、用紙を縮めて見せる
  const stage = $('prStage');
  const w = (pr.landscape ? 297 : 210) * MM, h = (pr.landscape ? 210 : 297) * MM;
  const k = Math.min((stage.clientWidth - 36) / w, (stage.clientHeight - 36) / h, 1.2);
  $('prScale').style.setProperty('--s', k);
  $('prWrap').style.width = w * k + 'px';
  $('prWrap').style.height = h * k + 'px';
  // 印刷の用紙の向き
  let st = $('prPageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'prPageStyle'; document.head.appendChild(st); }
  st.textContent = `@page { size: A4 ${pr.landscape ? 'landscape' : 'portrait'}; margin: 0; }`;
}

function doPrint() {
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// ---------- ボタンとキー ----------
function bind() {
  $('btnPrint').onclick = openPrinter;
  $('prBack').onclick = closePrinter;
  $('prGo').onclick = doPrint;
  $('prOpts').addEventListener('click', onPrintOpt);
  $('prOpts').addEventListener('change', onPrintOpt);
  $('prOpts').addEventListener('input', (e) => { if (e.target.id === 'prTitle') onPrintOpt(e); });
  window.addEventListener('resize', () => { if (pr) layoutSheet(); });
  $('btnMotion').onclick = () => { app.view.motion = !app.view.motion; savePref(); syncMotion(); };
  $('btnPlay').onclick = togglePlay;
  $('btnRewind').onclick = rewindAudio;
  $('btnBack').onclick = closeStory;
  $('btnHide').onclick = () => { app.view.ui = false; applyView(); fitText(); };
  $('btnShow').onclick = () => { app.view.ui = true; applyView(); fitText(); };
  $('btnDir').onclick = () => { app.view.vertical = !app.view.vertical; savePref(); syncButtons(); applyView(); fitText(); };
  $('btnWakachi').onclick = () => { app.view.wakachi = !app.view.wakachi; savePref(); syncButtons(); renderPage(); fitText(); };
  $('btnBigger').onclick = () => { app.view.fs = Math.round((app.view.fs || 32) * 1.1); applyView(); };
  $('btnSmaller').onclick = () => { app.view.fs = Math.max(12, Math.round((app.view.fs || 32) / 1.1)); applyView(); };
  $('btnFit').onclick = fitText;
  $('btnSlit').onclick = () => { app.view.slit = !app.view.slit; syncButtons(); setCur(app.cur); };
  document.querySelectorAll('#toolbar .mk').forEach((b) => { b.onclick = () => pressMark(b.dataset.mark); });
  $('btnMarkMode').onclick = () => { app.view.markOne = !app.view.markOne; savePref(); syncButtons(); };
  $('btnMarkClear').onclick = () => { $('page').querySelectorAll('.mk-i.on').forEach((el) => setLit(el, false)); syncButtons(); };
  $('page').addEventListener('click', onPageClick);

  document.addEventListener('keydown', (e) => {
    if (pr) { if (e.key === 'Escape' && !e.target.closest('input, textarea')) closePrinter(); return; }   // 印刷の画面のあいだは、本文のキーを使わない
    if (!app.story || e.target.closest('input, textarea')) return;
    const v = app.view;
    if (e.key === 'p' || e.key === 'P') { openPrinter(); return; }
    const next = v.vertical ? 'ArrowLeft' : 'ArrowDown';
    const prev = v.vertical ? 'ArrowRight' : 'ArrowUp';
    if (e.key === 'Escape') closeStory();
    else if (e.key === 'h' || e.key === 'H') (v.ui ? $('btnHide') : $('btnShow')).click();
    else if (e.key === 's' || e.key === 'S') $('btnSlit').click();
    else if (e.key === '+' || e.key === ';') $('btnBigger').click();
    else if (e.key === '-') $('btnSmaller').click();
    else if (e.key === '0') fitText();
    else if (e.key === ' ' && app.audio && !e.target.closest('button')) { togglePlay(); e.preventDefault(); }
    else if (v.slit && e.key === next) { setCur(app.cur + 1); e.preventDefault(); }
    else if (v.slit && e.key === prev) { setCur(app.cur - 1); e.preventDefault(); }
  });

  // 画面の大きさが変わったら（大画面につないだときなど）合わせ直す
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (app.story) { applyView(); fitText(); } }, 200); });
}

bind();
load();
