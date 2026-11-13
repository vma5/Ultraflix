import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'catalog.json');
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/* ------------------------------------------------------------------ */
/* Armazenamento (arquivo JSON — troque por um banco quando crescer)   */
/* ------------------------------------------------------------------ */
let catalog = [];

async function load() {
  catalog = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
}

let saving = Promise.resolve();
function save() {
  // Serializa as gravações para evitar corrupção do arquivo
  saving = saving.then(async () => {
    const tmp = DATA_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(catalog, null, 2));
    await fs.rename(tmp, DATA_FILE);
  });
  return saving;
}

/* ------------------------------------------------------------------ */
/* Fontes de vídeo                                                     */
/* ------------------------------------------------------------------ */
const SOURCE_TYPES = {
  archive: {
    valid: (v) => /^[A-Za-z0-9._-]{1,200}$/.test(v),
    play: (v) => ({ kind: 'iframe', url: `https://archive.org/embed/${v}` }),
  },
  youtube: {
    valid: (v) => /^[A-Za-z0-9_-]{11}$/.test(v),
    play: (v) => ({ kind: 'iframe', url: `https://www.youtube-nocookie.com/embed/${v}?rel=0` }),
  },
  mp4: {
    valid: (v) => isHttps(v),
    play: (v) => ({ kind: 'video', url: v }),
  },
  hls: {
    valid: (v) => isHttps(v),
    play: (v) => ({ kind: 'hls', url: v }),
  },
};

function isHttps(v) {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveSource(src) {
  const t = SOURCE_TYPES[src?.type];
  if (!t || !t.valid(src.value)) return null;
  return t.play(src.value);
}

function posterFor(item) {
  if (item.poster) return item.poster;
  const s = item.source || item.episodes?.[0]?.source;
  if (s?.type === 'archive') return `https://archive.org/services/img/${s.value}`;
  if (s?.type === 'youtube') return `https://img.youtube.com/vi/${s.value}/hqdefault.jpg`;
  return '';
}

function summary(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    year: item.year,
    genres: item.genres,
    synopsis: item.synopsis,
    poster: posterFor(item),
    featured: !!item.featured,
    episodeCount: item.episodes?.length || 0,
  };
}

function detail(item) {
  const out = { ...summary(item), license: item.license || '' };
  if (item.type === 'movie') {
    out.play = resolveSource(item.source);
  } else {
    out.episodes = (item.episodes || []).map((e, i) => ({
      n: e.n ?? i + 1,
      title: e.title || `Episódio ${e.n ?? i + 1}`,
      play: resolveSource(e.source),
    }));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validação de entrada                                                */
/* ------------------------------------------------------------------ */
const TYPES = ['movie', 'novela', 'series'];

function clean(str, max) {
  return String(str ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function slug(s) {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'titulo'
  );
}

function buildTitle(body) {
  const type = body.type;
  if (!TYPES.includes(type)) throw new Error('type deve ser movie, novela ou series');
  const title = clean(body.title, 150);
  if (!title) throw new Error('title é obrigatório');
  if (!clean(body.license, 200)) {
    throw new Error('license é obrigatório: informe a base legal (ex.: "Domínio público", "CC BY 4.0", "Conteúdo próprio")');
  }

  const item = {
    id: `${slug(title)}-${crypto.randomBytes(3).toString('hex')}`,
    type,
    title,
    year: Number(body.year) || null,
    genres: (Array.isArray(body.genres) ? body.genres : String(body.genres || '').split(','))
      .map((g) => clean(g, 30))
      .filter(Boolean)
      .slice(0, 6),
    synopsis: clean(body.synopsis, 1500),
    poster: isHttps(body.poster) ? body.poster : '',
    license: clean(body.license, 200),
    featured: !!body.featured,
    addedAt: new Date().toISOString(),
  };

  if (type === 'movie') {
    if (!resolveSource(body.source)) throw new Error('source inválido');
    item.source = { type: body.source.type, value: String(body.source.value) };
  } else {
    const eps = Array.isArray(body.episodes) ? body.episodes : [];
    if (!eps.length) throw new Error('episodes é obrigatório para novela/série');
    item.episodes = eps.slice(0, 500).map((e, i) => {
      if (!resolveSource(e.source)) throw new Error(`episódio ${i + 1}: source inválido`);
      return {
        n: Number(e.n) || i + 1,
        title: clean(e.title, 150) || `Episódio ${i + 1}`,
        source: { type: e.source.type, value: String(e.source.value) },
      };
    });
  }
  return item;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

// Cabeçalhos de segurança + CSP (só libera os players que usamos)
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net",
      "style-src 'self'",
      "img-src 'self' https: data:",
      "media-src 'self' https: blob:",
      "connect-src 'self' https:",
      'frame-src https://archive.org https://www.youtube-nocookie.com',
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Rate limit simples em memória (por IP)
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip + req.path;
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Muitas requisições, tente mais tarde.' });
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_TOKEN não configurado no servidor.' });
  const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_TOKEN).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

/* -------------------------- API pública --------------------------- */
app.get('/api/health', (req, res) => res.json({ ok: true, titles: catalog.length }));

// Lista com filtros: ?type=movie|novela|series &q=texto &genre=Drama &page=1 &limit=24
app.get('/api/titles', (req, res) => {
  const { type, q, genre } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));

  let list = catalog;
  if (TYPES.includes(type)) list = list.filter((t) => t.type === type);
  if (genre) list = list.filter((t) => t.genres?.some((g) => g.toLowerCase() === String(genre).toLowerCase()));
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((t) => `${t.title} ${t.synopsis} ${t.genres?.join(' ')}`.toLowerCase().includes(needle));
  }

  const total = list.length;
  const items = list.slice((page - 1) * limit, page * limit).map(summary);
  res.json({ page, limit, total, items });
});

app.get('/api/featured', (req, res) => {
  const f = catalog.filter((t) => t.featured);
  res.json((f.length ? f : catalog.slice(0, 5)).map(summary));
});

app.get('/api/genres', (req, res) => {
  const set = new Set(catalog.flatMap((t) => t.genres || []));
  res.json([...set].sort((a, b) => a.localeCompare(b, 'pt-BR')));
});

app.get('/api/titles/:id', (req, res) => {
  const item = catalog.find((t) => t.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Título não encontrado.' });
  res.json(detail(item));
});

/* --------------------------- API admin ---------------------------- */
app.post('/api/admin/titles', requireAdmin, async (req, res) => {
  try {
    const item = buildTitle(req.body);
    catalog.unshift(item);
    await save();
    res.status(201).json(detail(item));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/titles/:id', requireAdmin, async (req, res) => {
  const i = catalog.findIndex((t) => t.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Título não encontrado.' });
  catalog.splice(i, 1);
  await save();
  res.json({ ok: true });
});

// Busca no Internet Archive (API pública, sem chave)
app.get('/api/admin/archive/search', requireAdmin, rateLimit(30, 60_000), async (req, res) => {
  const q = String(req.query.q || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().slice(0, 80);
  if (!q) return res.status(400).json({ error: 'Informe q.' });
  const query = `(${q}) AND mediatype:movies AND collection:(feature_films)`;
  const url =
    'https://archive.org/advancedsearch.php?' +
    new URLSearchParams([
      ['q', query],
      ['fl[]', 'identifier'],
      ['fl[]', 'title'],
      ['fl[]', 'year'],
      ['fl[]', 'licenseurl'],
      ['sort[]', 'downloads desc'],
      ['rows', '24'],
      ['output', 'json'],
    ]);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Internet Archive respondeu ${r.status}`);
    const data = await r.json();
    res.json(data.response?.docs || []);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Importa um item do Internet Archive pelo identificador.
// Exige licenseurl no item OU confirmação explícita de que você verificou os direitos.
app.post('/api/admin/archive/import', requireAdmin, rateLimit(20, 60_000), async (req, res) => {
  const id = String(req.body.identifier || '');
  if (!SOURCE_TYPES.archive.valid(id)) return res.status(400).json({ error: 'identifier inválido.' });
  try {
    const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Internet Archive respondeu ${r.status}`);
    const { metadata: m } = await r.json();
    if (!m || m.mediatype !== 'movies') return res.status(400).json({ error: 'Item não é um vídeo.' });

    const license = m.licenseurl || (req.body.confirmRights ? clean(req.body.license, 200) : '');
    if (!license) {
      return res.status(400).json({
        error:
          'Este item não declara licença. Verifique se está em domínio público e reenvie com confirmRights:true e license:"Domínio público (fonte/justificativa)".',
      });
    }

    const item = buildTitle({
      type: 'movie',
      title: Array.isArray(m.title) ? m.title[0] : m.title,
      year: parseInt(m.year || m.date, 10),
      genres: m.subject ? [].concat(m.subject).slice(0, 4) : [],
      synopsis: [].concat(m.description || '').join(' '),
      license,
      source: { type: 'archive', value: id },
    });
    catalog.unshift(item);
    await save();
    res.status(201).json(detail(item));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ------------------------- Arquivos estáticos --------------------- */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

await load();
app.listen(PORT, () => {
  console.log(`StreamFree rodando em http://localhost:${PORT}`);
  if (!ADMIN_TOKEN) console.log('Aviso: defina ADMIN_TOKEN para habilitar o painel /admin.');
});
