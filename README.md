# StreamFree

Plataforma de streaming gratuita para **filmes, novelas e séries**, feita com Node.js + Express (backend/API) e HTML/CSS/JS puro (frontend, sem build).

> **Conteúdo legal apenas.** A plataforma não hospeda nem aponta para fontes piratas. Os vídeos vêm de: domínio público (Internet Archive), licenças abertas (Creative Commons), canais que permitem embed (YouTube) e conteúdo seu ou autorizado por escrito pelo detentor dos direitos.

## Rodando

```bash
npm install
ADMIN_TOKEN="uma-senha-longa-e-aleatoria" npm start
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin (use o mesmo `ADMIN_TOKEN`)

Gere um token forte com: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

## Tipos de fonte de vídeo

| `source.type` | `source.value`                    | Como toca                                   |
|---------------|-----------------------------------|---------------------------------------------|
| `archive`     | identifier do Internet Archive    | embed oficial `archive.org/embed/ID`        |
| `youtube`     | ID do vídeo (11 caracteres)       | embed `youtube-nocookie.com`                |
| `mp4`         | URL `https://…` do arquivo        | `<video>` nativo                            |
| `hls`         | URL `https://…m3u8`               | hls.js (ou nativo no Safari)                |

## API

### Pública

| Método | Rota                | Descrição |
|--------|---------------------|-----------|
| GET    | `/api/health`       | Status |
| GET    | `/api/titles`       | Lista. Parâmetros: `type` (`movie`/`novela`/`series`), `q`, `genre`, `page`, `limit` (máx. 60) |
| GET    | `/api/titles/:id`   | Detalhe com `play` (filme) ou `episodes[].play` |
| GET    | `/api/featured`     | Títulos em destaque |
| GET    | `/api/genres`       | Gêneros existentes |

### Admin (header `Authorization: Bearer <ADMIN_TOKEN>`)

| Método | Rota                              | Descrição |
|--------|-----------------------------------|-----------|
| POST   | `/api/admin/titles`               | Cria título (JSON abaixo) |
| DELETE | `/api/admin/titles/:id`           | Remove título |
| GET    | `/api/admin/archive/search?q=`    | Busca filmes no Internet Archive |
| POST   | `/api/admin/archive/import`       | `{ "identifier": "..." }` — importa um item. Exige licença declarada no item **ou** `{ "confirmRights": true, "license": "base legal" }` |

Exemplo de novela/série:

```bash
curl -X POST http://localhost:3000/api/admin/titles \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "type": "novela",
    "title": "Minha Novela",
    "year": 2026,
    "genres": ["Drama", "Romance"],
    "synopsis": "Sinopse aqui.",
    "license": "Conteúdo próprio",
    "episodes": [
      { "title": "Capítulo 1", "source": { "type": "youtube", "value": "ID_DO_VIDEO" } },
      { "title": "Capítulo 2", "source": { "type": "mp4", "value": "https://meu-cdn.com/cap2.mp4" } }
    ]
  }'
```

O campo `license` é **obrigatório** em todo título — ele registra a base legal da publicação.

## Onde conseguir conteúdo legal (principalmente novelas)

- **Internet Archive** (`archive.org`): filmes clássicos em domínio público. Confira sempre a licença/ano antes de publicar.
- **Seu próprio conteúdo**: produza webnovelas/séries e hospede em Cloudflare R2, Bunny Stream, Mux ou YouTube.
- **Parcerias**: novelas brasileiras (Globo, Record, SBT, Band etc.) têm direitos protegidos. Para exibir, é preciso **licenciar** com o detentor. Muitos canais oficiais já publicam capítulos no YouTube com embed liberado; nesse caso você pode usar o ID do vídeo, mas confirme se o canal permite incorporação e se os termos de uso do YouTube e do canal cobrem seu uso.
- **Creative Commons / Blender Open Movies / Vimeo CC**: curtas e filmes com licença aberta (respeite a atribuição).

## Estrutura

```
server.js          API + servidor estático
data/catalog.json  catálogo (JSON; troque por SQLite/Postgres quando crescer)
public/            frontend (index, admin, css, js)
```

## Produção

- Rode atrás de HTTPS (Caddy, Nginx, Cloudflare). Hospedagens simples: Render, Railway, Fly.io, VPS.
- Em hospedagens com disco efêmero, o `catalog.json` é perdido a cada deploy — use um volume persistente ou migre para um banco.
- Mantenha `ADMIN_TOKEN` em variável de ambiente, nunca no código.
- Para volume alto de usuários, hospede os vídeos próprios em CDN (HLS) em vez de servir MP4 direto.
- Adicione uma página de política de direitos autorais / contato para denúncias (DMCA e equivalentes), é boa prática e muitas vezes exigida.

## Próximos passos sugeridos

1. Login de usuários (Auth.js, Supabase ou Firebase Auth) e sincronizar "Minha lista" e progresso no servidor.
2. Banco de dados (SQLite via `better-sqlite3` ou Postgres).
3. Legendas (`<track>` WebVTT) e múltiplas qualidades via HLS.
4. App mobile com PWA (manifest + service worker).
