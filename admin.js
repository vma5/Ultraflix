const $ = (s, el = document) => el.querySelector(s);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  kids.flat().forEach((k) => k != null && el.append(k));
  return el;
}

function msg(el, text, ok = false) {
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'err'}`;
}

async function call(path, { method = 'GET', body } = {}) {
  const token = $('#token').value.trim();
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
  return data;
}

/* ---------- catálogo ---------- */
async function refreshCatalog() {
  const box = $('#catalog');
  box.replaceChildren();
  const data = await fetch('/api/titles?limit=60').then((r) => r.json());
  data.items.forEach((t) => {
    box.append(h('div', {},
      h('span', {}, `${t.title} (${t.type}${t.year ? ', ' + t.year : ''})`),
      h('button', {
        class: 'btn small', type: 'button',
        onclick: async () => {
          if (!confirm(`Remover "${t.title}"?`)) return;
          try { await call(`/api/admin/titles/${t.id}`, { method: 'DELETE' }); refreshCatalog(); }
          catch (e) { alert(e.message); }
        },
      }, 'Remover')));
  });
}

/* ---------- Internet Archive ---------- */
async function importArchive(identifier, confirmRights = false, license = '') {
  return call('/api/admin/archive/import', { method: 'POST', body: { identifier, confirmRights, license } });
}

$('#aSearch').onclick = async () => {
  const out = $('#aResults');
  out.replaceChildren();
  try {
    const docs = await call(`/api/admin/archive/search?q=${encodeURIComponent($('#aq').value)}`);
    if (!docs.length) return msg($('#aMsg'), 'Nada encontrado.');
    $('#aMsg').textContent = '';
    docs.forEach((d) => {
      const title = [].concat(d.title)[0];
      out.append(h('div', {},
        h('span', {}, `${title} ${d.year ? '(' + d.year + ')' : ''} ${d.licenseurl ? '· licença declarada' : '· sem licença declarada'}`),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: async () => {
            try {
              try {
                await importArchive(d.identifier);
              } catch (e) {
                // Sem licença declarada: só importa se VOCÊ confirmar que verificou os direitos
                const lic = prompt('Este item não declara licença. Se você verificou que está em domínio público, descreva a base (ex.: "Domínio público nos EUA, publicado em 1925 sem renovação"). Cancele para não importar.');
                if (!lic) throw e;
                await importArchive(d.identifier, true, lic);
              }
              msg($('#aMsg'), `"${title}" importado.`, true);
              refreshCatalog();
            } catch (e) { msg($('#aMsg'), e.message); }
          },
        }, 'Importar')));
    });
  } catch (e) { msg($('#aMsg'), e.message); }
};

/* ---------- formulário manual ---------- */
const form = $('#addForm');
form.type.addEventListener('change', () => {
  const movie = form.type.value === 'movie';
  $('#epBox').hidden = movie;
  $('#singleSrc').hidden = !movie;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const stype = f.get('stype');
  const body = {
    type: f.get('type'),
    title: f.get('title'),
    year: f.get('year'),
    genres: f.get('genres'),
    synopsis: f.get('synopsis'),
    poster: f.get('poster'),
    license: f.get('license'),
    featured: f.get('featured') === 'on',
  };
  if (body.type === 'movie') {
    body.source = { type: stype, value: String(f.get('svalue')).trim() };
  } else {
    body.episodes = String(f.get('episodes'))
      .split('\n').map((l) => l.trim()).filter(Boolean)
      .map((line, i) => {
        const [title, value] = line.split('|').map((s) => s.trim());
        return { n: i + 1, title, source: { type: stype, value } };
      });
  }
  try {
    await call('/api/admin/titles', { method: 'POST', body });
    msg($('#addMsg'), 'Título salvo!', true);
    form.reset();
    refreshCatalog();
  } catch (err) { msg($('#addMsg'), err.message); }
});

refreshCatalog();
