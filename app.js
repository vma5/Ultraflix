const $ = (s, el = document) => el.querySelector(s);

/* ---------- helpers ---------- */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
  },
};

const TYPE_LABEL = { movie: 'Filme', novela: 'Novela', series: 'Série' };

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Erro ${r.status}`);
  return r.json();
}

/* ---------- estado ---------- */
const state = { type: 'all', q: '', genre: '', page: 1, total: 0 };
let favorites = store.get('favorites', []);   // ids
let progress = store.get('progress', {});     // id -> { ep, at }
let current = null;                           // título aberto no player
let hls = null;

/* ---------- cards ---------- */
function card(item) {
  const img = item.poster
    ? h('img', { src: item.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
    : h('div', { class: 'ph' }, '🎬');
  img.addEventListener?.('error', () => img.replaceWith(h('div', { class: 'ph' }, '🎬')));
  const sub = [TYPE_LABEL[item.type], item.year, item.episodeCount ? `${item.episodeCount} ep.` : '']
    .filter(Boolean).join(' · ');
  return h('button', { class: 'card', type: 'button', onclick: () => openTitle(item.id) },
    img,
    h('div', { class: 'info' }, h('div', { class: 't' }, item.title), h('div', { class: 's' }, sub)));
}

function fillGrid(el, items, append = false) {
  if (!append) el.replaceChildren();
  items.forEach((i) => el.append(card(i)));
}

/* ---------- catálogo ---------- */
async function loadCatalog(append = false) {
  const grid = $('#grid');
  if (state.type === 'list') {
    const items = (await Promise.all(favorites.map((id) => api(`/api/titles/${id}`).catch(() => null)))).filter(Boolean);
    fillGrid(grid, items);
    $('#empty').hidden = items.length > 0;
    $('#more').hidden = true;
    $('#gridTitle').textContent = 'Minha lista';
    return;
  }
  const params = new URLSearchParams({ page: state.page, limit: 24 });
  if (state.type !== 'all') params.set('type', state.type);
  if (state.q) params.set('q', state.q);
  if (state.genre) params.set('genre', state.genre);
  const data = await api(`/api/titles?${params}`);
  state.total = data.total;
  fillGrid(grid, data.items, append);
  $('#empty').hidden = data.total > 0;
  $('#more').hidden = state.page * data.limit >= data.total;
  $('#gridTitle').textContent = state.q ? `Resultados para “${state.q}”` : 'Catálogo';
}

async function loadHero() {
  const list = await api('/api/featured');
  if (!list.length) return;
  const pick = list[Math.floor(Math.random() * list.length)];
  $('#hero').hidden = false;
  $('#heroTitle').textContent = pick.title;
  $('#heroSyn').textContent = pick.synopsis;
  if (pick.poster) $('#heroBg').style.backgroundImage = `url("${pick.poster.replace(/"/g, '%22')}")`;
  $('#heroPlay').onclick = () => openTitle(pick.id);
}

async function loadGenres() {
  const genres = await api('/api/genres');
  const sel = $('#genre');
  genres.forEach((g) => sel.append(h('option', { value: g }, g)));
}

async function loadContinue() {
  const ids = Object.keys(progress).sort((a, b) => progress[b].at - progress[a].at).slice(0, 6);
  const items = (await Promise.all(ids.map((id) => api(`/api/titles/${id}`).catch(() => null)))).filter(Boolean);
  $('#continue').hidden = items.length === 0;
  fillGrid($('#continueGrid'), items);
}

/* ---------- player ---------- */
function stopPlayback() {
  if (hls) { hls.destroy(); hls = null; }
  $('#stage').replaceChildren();
}

async function loadHlsLib() {
  if (window.Hls) return window.Hls;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  return window.Hls;
}

async function playSource(play) {
  const stage = $('#stage');
  stopPlayback();
  if (!play) {
    stage.append(h('div', { class: 'err' }, 'Fonte de vídeo indisponível.'));
    return;
  }
  if (play.kind === 'iframe') {
    stage.append(h('iframe', {
      src: play.url,
      allow: 'autoplay; fullscreen; picture-in-picture',
      allowfullscreen: '',
      referrerpolicy: 'strict-origin-when-cross-origin',
      title: current?.title || 'Player',
    }));
    return;
  }
  const video = h('video', { controls: '', playsinline: '', preload: 'metadata' });
  stage.append(video);
  if (play.kind === 'video') {
    video.src = play.url;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = play.url; // Safari/iOS tocam HLS nativamente
  } else {
    try {
      const Hls = await loadHlsLib();
      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(play.url);
        hls.attachMedia(video);
      } else {
        throw new Error('HLS não suportado');
      }
    } catch {
      stage.replaceChildren(h('div', { class: 'err' }, 'Não foi possível carregar este vídeo neste navegador.'));
    }
  }
}

function renderFav() {
  const on = favorites.includes(current.id);
  $('#pFav').textContent = on ? '★ Na minha lista' : '☆ Minha lista';
}

function selectEpisode(i) {
  const ep = current.episodes[i];
  [...$('#episodes').children].forEach((li, idx) => li.firstChild.classList.toggle('current', idx === i));
  $('#pTitle').textContent = `${current.title} — ${ep.title}`;
  progress[current.id] = { ep: i, at: Date.now() };
  store.set('progress', progress);
  playSource(ep.play);
}

async function openTitle(id) {
  try {
    current = await api(`/api/titles/${id}`);
  } catch (e) {
    alert(e.message);
    return;
  }
  const dlg = $('#player');
  $('#pTitle').textContent = current.title;
  $('#pMeta').textContent = [TYPE_LABEL[current.type], current.year, current.genres.join(', '), current.license && `Licença: ${current.license}`]
    .filter(Boolean).join(' · ');
  $('#pSyn').textContent = current.synopsis;
  renderFav();

  const list = $('#episodes');
  list.replaceChildren();
  if (current.type === 'movie') {
    list.hidden = true;
    progress[current.id] = { ep: 0, at: Date.now() };
    store.set('progress', progress);
    playSource(current.play);
  } else {
    list.hidden = false;
    current.episodes.forEach((ep, i) =>
      list.append(h('li', {}, h('button', { type: 'button', onclick: () => selectEpisode(i) }, `${ep.n}. ${ep.title}`))));
    selectEpisode(Math.min(progress[current.id]?.ep ?? 0, current.episodes.length - 1));
  }
  if (!dlg.open) dlg.showModal();
}

$('#pClose').onclick = () => $('#player').close();
$('#player').addEventListener('close', () => { stopPlayback(); loadContinue(); });
$('#player').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#pFav').onclick = () => {
  favorites = favorites.includes(current.id) ? favorites.filter((x) => x !== current.id) : [...favorites, current.id];
  store.set('favorites', favorites);
  renderFav();
  if (state.type === 'list') loadCatalog();
};

/* ---------- eventos ---------- */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  $('#tabs .active')?.classList.remove('active');
  btn.classList.add('active');
  state.type = btn.dataset.type;
  state.page = 1;
  loadCatalog();
});
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  state.q = $('#q').value.trim();
  state.page = 1;
  loadCatalog();
});
$('#genre').addEventListener('change', (e) => {
  state.genre = e.target.value;
  state.page = 1;
  loadCatalog();
});
$('#more').addEventListener('click', () => {
  state.page += 1;
  loadCatalog(true);
});

/* ---------- init ---------- */
Promise.all([loadHero(), loadGenres(), loadCatalog(), loadContinue()]).catch((e) => console.error(e));
