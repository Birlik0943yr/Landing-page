# STRATA

A landing page for **STRATA**, a two-day workshop that teaches C-level executives of multinational companies
to build an AI strategy (€5,000 per seat; sessions in February, May and September).

The website is **plain HTML, CSS and JavaScript** (no frameworks, no libraries, no CDNs). A small
**Node.js server with no dependencies** receives the sign-up form and stores every application encrypted.
A visual version of the structure is in [`architecture.html`](architecture.html): open it in any browser.

## 1. Where the code is

```
index.html            the website: structure and content (what is on the page)
styles.css            the website: appearance (colours, type, layout, animation, mobile)
app.js                the website: behaviour (programme tabs, form checks, sending)

server/server.js      the server: serves the three files above and receives applications
server/vault.js       the server: encrypts and stores applications
server/export.js      owner's tool: verify and decrypt stored applications

architecture.html     diagrams        package.json   start/check/export scripts (no dependencies)
```

HTML says **what** is on the page, CSS says **how it looks**, JS says **how it behaves**.
The server serves only `index.html`, `styles.css` and `app.js`; every other path, including `server/`,
`data/` and `keys/`, answers 404.

## 2. Run it

Needs **Node.js 20 or newer**. Nothing to install.

```bash
npm start
```

Open **http://localhost:8081**. On first start the server creates its own encryption key (`keys/secret.key`)
and a `data/` folder; neither is in the repository.

| Command | What it does |
|---|---|
| `npm run check` | Verifies every stored application (hash chain intact, every record decrypts) |
| `npm run export` | Decrypts stored applications to CSV |
| `npm run cert`, then `npm run start:https` | Optional local HTTPS on https://localhost:8443 (needs `openssl`) |

**What to try:** click *Day 1 / Day 2* (a light pill flows between the tabs and the content slides in);
submit the form (a reference like `ST-7ESG-2E6L` appears only after the server saved it); type
`name@gmial.com` (the page offers `gmail.com`); open `data/signups.jsonl` (nothing is readable: it is encrypted).

## 3. How the page is built (`index.html`)

The DOM model from the course: **page → body → sections → sub-sections → elements**, and every element has
a type, attributes and a value.

```
body
├─ header.nav               brand · 3 links · "Reserve a seat" button
├─ main#top
│  ├─ section.hero          promise (h1, lead, 3 facts, 2 links)  |  artwork (SVG)
│  ├─ section (audience)    3 tiles: who it is for
│  ├─ section#programme     Day 1 / Day 2 tabs + 2 panels
│  ├─ section#outcomes      3 rows: what the executive takes back
│  ├─ section#apply         intro and price  |  form#apply-form  |  div.done (confirmation)
│  └─ section#faq           5 <details> questions
└─ footer
```

- **One goal:** every main button links to `#apply`; the form is the destination of the page.
- **Semantic elements and ARIA** (`nav`, `main`, `section`, `form`, `fieldset`, `role="tablist"`,
  `aria-selected`, `aria-live`) so it works with a keyboard and a screen reader. The FAQ uses `<details>`
  and works without JavaScript.
- **No inline scripts and no `style=""`**: the Content-Security-Policy forbids them, so all appearance is in `styles.css`.

## 4. How it looks (`styles.css`)

- **Tokens first:** colours, radius and easing are CSS custom properties in `:root`; everything is built from them.
- **Palette:** warm paper, graphite text, one terracotta accent used only for actions. The programme section is dark.
- **Type:** the system font stack. No web fonts, so nothing loads from a third party.
- **Layout:** CSS Grid for sections, Flexbox for rows; adapts at 900px and 640px.
- **Motion** sits inside `prefers-reduced-motion: no-preference`, so visitors who ask for less motion get none.
- **The liquid tab pill:** one light shape (`.tabs-pill`) behind the tabs. JavaScript only writes its position
  into CSS variables (`--x --y --w --h`) and the browser animates it with CSS transitions: first it stretches over
  both tabs (0.17 s), then it pulls into the new tab with a slight overshoot (0.55 s).

## 5. How it behaves (`app.js`)

Four jobs, nothing else:

1. **Programme tabs:** click or ← → sets `aria-selected`, shows the matching panel and moves the pill.
2. **Reveal on scroll:** an `IntersectionObserver` adds the class `in`; the CSS plays the animation.
3. **Live form help:** the total updates with the seats; the email field checks its format and suggests fixes
   for common typos.
4. **Sending:** validates every field, creates one `crypto.randomUUID()` per application, and sends JSON to
   `/api/apply`. On a network error or a 5xx it retries up to 3 times (1 s, 2 s, 4 s) with the **same** id, so the
   server never saves it twice. The confirmation appears **only after the server returns a reference**, i.e. after
   the application is encrypted and on disk.

JavaScript changes the page by finding one node and changing one attribute or value. It uses `textContent`
and `createElement`, never `innerHTML`, so text typed by a visitor can never become markup.

## 6. The server and the stored data (`server/`)

Built-in Node modules only. `POST /api/apply` runs these checks, cheapest first:

| # | Check | Failure |
|---|---|---|
| 1 | `Origin` is our own site (blocks forged cross-site requests) | 403 |
| 2 | Content type is JSON · body at most 4 KB | 415 · 413 |
| 3 | At most 10 requests per 10 minutes per IP | 429 |
| 4 | Every field checked against allow-lists, lengths and types; unknown fields dropped; `<` `>` refused; honeypot empty | 422 |
| 5 | The email's domain accepts mail (DNS MX lookup) | 422 |
| 6 | Saved by `vault.js` | 200 with a reference, or 503 (the browser retries) |

The browser applies the same field rules for instant feedback, but **the server never trusts the browser**.
Responses never contain applicant data, only a reference; logs hold counts, never names or emails.

Each application is one line in an **append-only** file (`data/signups.jsonl`):

| Goal | How |
|---|---|
| Unreadable without the key | Personal data encrypted with **AES-256-GCM**; the key lives in `keys/`, apart from `data/` |
| Tampering is detected | GCM authentication tag per record, plus a **hash chain** (each line stores the SHA-256 of the previous one) |
| Duplicates without decrypting | An HMAC fingerprint of `email + session`; a repeat returns the original reference |
| No lost applications | Written with `fsync` **before** the server answers; a second copy goes to `data/backup/`; writes are queued |
| Crash recovery | At start-up a half-written last line is cut off and a missing main file is restored from the backup |

`npm run check` re-verifies the whole chain and decrypts every record.

**Other protections:** strict Content-Security-Policy (own scripts only, no inline code, no iframes); only the
three website files are served; zero dependencies, so nothing can be poisoned through a package.

**Honest limits:** the DNS check proves a domain receives mail, not that the mailbox exists. The backup sits on the
same disk as the log. If the key is lost the data cannot be read: keep a copy of `keys/secret.key`.

## 7. Design decisions

| Client question | Answer | How the site delivers it |
|---|---|---|
| What does "premium" mean? | A real, designed product, colours chosen for the audience | Warm paper + graphite + one terracotta accent; large type; generous space |
| What is "simple"? | Obvious what to click | One goal, one button style, six sections in a logical order |
| What does "make it pop" mean? | Priority: the most important action stands out | The accent colour appears only on actions, all leading to the form |
| Brand guide? | None. Direction: Apple-like expressiveness | A "strata lines" mark used in the nav, artwork, favicon and footer |

The section order (navbar, masthead, icons grid, showcases, call to action, footer) is adapted from the
Start Bootstrap "Landing Page" template (MIT) and rewritten in plain code: the original loads three CDNs and
posts its form to a third-party service, which this project does not allow.

## 8. Settings (all optional, safe defaults)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8081` / `127.0.0.1` | Where the server listens (local only by default) |
| `HTTPS`, `HTTPS_PORT` | off, `8443` | `HTTPS=1` serves HTTPS from `certs/`; HTTP then only redirects |
| `DATA_DIR` | `./data` | Where encrypted applications are stored |
| `SIGNUP_KEY` | file `keys/secret.key` | 32-byte base64 key. **Required** when `NODE_ENV=production` |
| `TRUST_PROXY` | off | `1` behind a hosting proxy, so rate limiting sees real visitor addresses |

*STRATA is a fictional workshop built as a course exercise.*
