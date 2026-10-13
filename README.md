# STRATA

A landing page for **STRATA**, a two-day workshop that teaches C-level executives of multinational companies
to build an AI strategy for their organisation (€5,000 per seat; sessions in February, May and September).

The site is written in **plain HTML, CSS and JavaScript** (no frameworks, no libraries, no CDNs). A small
**Node.js server with no dependencies** serves the files and receives applications from the sign-up form,
encrypting every one before it is stored.

> This is a course project (Web Applications). The brief, the design decisions and the security decisions
> are explained below so the code can be read and reviewed without running it. A visual version of the
> architecture is in [`architecture.html`](architecture.html): open it in any browser.

---

## 1. Quick start

Requires **Node.js 20 or newer**. Nothing to install: the project has no dependencies.

```bash
cd STRATA
npm start
```

Open **http://localhost:8081**.

On the first start the server creates its own encryption key (`keys/secret.key`) and a `data/` folder for
applications. Neither is part of the repository.

| Command | What it does |
|---|---|
| `npm start` | Serves the site and the sign-up API on http://localhost:8081 |
| `npm run cert` then `npm run start:https` | Optional local HTTPS on https://localhost:8443 (needs `openssl`) |
| `npm run check` | Verifies every stored application: hash chain intact and every record decrypts |
| `npm run export` | Decrypts stored applications to CSV (run on the server only) |

**What to try:**

| Action | Expected result |
|---|---|
| Click **Day 1 / Day 2** in the programme | A light pill stretches and flows to the other tab; the day's content slides in from that side |
| Submit the form with a real-looking email | A reference like `ST-7ESG-2E6L` appears, only after the server has saved the application |
| Type `name@gmial.com` | The page offers to correct it to `gmail.com` |
| Open `data/signups.jsonl` after a sign-up | No names or emails are readable: every record is encrypted |

---

## 2. Project structure

```
STRATA/
├── site/                     the website: everything a visitor's browser receives
│   ├── index.html            structure and content (what is on the page)
│   ├── styles.css            appearance (colours, type, layout, animation, mobile)
│   └── app.js                behaviour (programme tabs, form checks, sending)
├── server/                   the server: runs on Node.js, never sent to the browser
│   ├── server.js             HTTP(S) server: serves files, checks and receives applications
│   ├── vault.js              encryption and storage of applications
│   └── export.js             owner's tool: verify and decrypt stored applications
├── architecture.html         diagrams of the structure and data flow
├── package.json              start / check / export scripts (no dependencies)
├── README.md                 this file
├── .gitignore                keeps data, keys and certificates out of git
│
├── data/                     (created at runtime, not in git) encrypted applications + backup
├── keys/                     (created at runtime, not in git) the encryption key
└── certs/                    (optional, not in git) local HTTPS certificate
```

Rule of separation: **HTML says what is on the page, CSS says how it looks, JS says how it behaves.**
The server can read `data/` and `keys/`; the browser can never request them, because the server serves
only the `site/` folder.

---

## 3. How the page is built (HTML)

The page follows the DOM model from the course: **page → body → sections → sub-sections → elements**,
and every element has a type, attributes and a value.

```
body
├─ header.nav                 brand · 3 links · "Reserve a seat" button
├─ main#top
│  ├─ section.hero            promise (h1, lead, 3 facts, 2 links)  |  artwork (SVG)
│  ├─ section (audience)      3 tiles: who the workshop is for
│  ├─ section#programme       Day 1 / Day 2 tabs + 2 panels with 3 agenda items each
│  ├─ section#outcomes        3 rows: what the executive takes back
│  ├─ section#apply           intro + price  |  form#apply-form  |  div.done (confirmation)
│  └─ section#faq             5 <details> questions
└─ footer                     brand · links · small print
```

Design points that are visible in the markup:

- **One goal.** Every main button (`Reserve a seat` in the header, the hero and the footer) links to
  `#apply`. The form is the destination of the whole page.
- **Semantic elements** (`header`, `nav`, `main`, `section`, `form`, `fieldset`, `details`) and ARIA attributes
  (`role="tablist"`, `aria-selected`, `aria-live`) so the page works with a keyboard and screen readers.
- **No inline scripts and no `style=""` attributes**, because the Content-Security-Policy forbids them
  (see section 6). All appearance lives in `styles.css`.
- **FAQ uses `<details>`**, so it works without JavaScript.

---

## 3.1 Appearance (CSS)

`styles.css` starts with a set of **design tokens** (`:root` custom properties) for the colours, the radius and
the easing curve, then builds the page from them.

- **Palette:** warm paper background, graphite text, one terracotta accent used only for actions. The
  programme section is dark graphite for contrast.
- **Type:** the system font stack (SF Pro, Segoe UI, Helvetica Neue…). No web fonts are downloaded, so nothing
  is loaded from a third party and the page renders instantly.
- **Layout:** CSS Grid for the page sections, Flexbox for rows. The page adapts at 900px and 640px
  (columns stack, the programme tabs become a vertical list, form rows become single-column on phones).
- **Motion:** the hero artwork draws itself, content rises into view, cards reveal on scroll, and the programme
  tabs have a liquid pill. All motion sits inside `@media (prefers-reduced-motion: no-preference)`, so visitors
  who ask for less motion get none.
- **The liquid tab pill:** one light shape (`.tabs-pill`) sits behind the tab buttons. JavaScript only
  writes its position into CSS variables (`--x --y --w --h`); the browser animates it with CSS transitions.
  Phase 1 stretches the pill over both tabs (0.17 s), phase 2 pulls it into the new tab with a slight
  overshoot (0.55 s).

---

## 3.2 Behaviour (JavaScript, `site/app.js`)

`app.js` does four jobs and nothing else.

1. **Programme tabs.** Clicking a tab (or pressing ← → on the keyboard) sets `aria-selected`, shows the matching
   panel (`hidden`) and moves the pill. It tells the panel which side it comes from so it slides in from there.
2. **Reveal on scroll.** An `IntersectionObserver` adds the class `in` to elements with `data-reveal` when they
   scroll into view; the CSS plays the animation.
3. **Live form help.**
   - The total updates with the number of seats (`€5,000 × seats`).
   - The email field checks its format, suggests a fix for common typos (`gmial.com` → `gmail.com`) and hints
     that a work address confirms faster than a personal one.
4. **Sending the application.**
   - Validates every field again, highlights the wrong ones and focuses the first.
   - Generates one `crypto.randomUUID()` per application and sends JSON with `fetch` to `/api/apply`.
   - If the network fails or the server answers 5xx it **retries up to 3 times** (1 s, 2 s, 4 s) with the
     *same* UUID, so the server never saves it twice.
   - Shows the confirmation screen **only after the server returns a reference**, i.e. after the application
     is encrypted and on disk.

JavaScript changes the page by finding one node and changing one **attribute** or one **value**
(`hidden`, `aria-selected`, `textContent`, a class). It uses `textContent` and `createElement`, never
`innerHTML`, so text typed by a visitor can never become markup.

---

## 4. The server (`server/server.js`)

Built-in Node modules only (`http`, `https`, `fs`, `path`, `dns`, `crypto`).

**Routes**

| Request | Handler |
|---|---|
| `GET` anything | Static file from `site/` (known file types only; no hidden files; no `../`) |
| `POST /api/apply` | Receives an application |
| anything else | `405` / `404` |

**What happens to an application** (cheap checks first, so junk never reaches the disk):

| # | Check | Failure answer |
|---|---|---|
| 1 | `Origin` header is our own site (blocks forged cross-site requests) | `403` |
| 2 | `Content-Type` is JSON | `415` |
| 3 | Body is at most 4 KB | `413` |
| 4 | At most 10 requests per 10 minutes per IP | `429` |
| 5 | Valid JSON; honeypot field empty | `400` / `422` |
| 6 | Every field checked against allow-lists, lengths and types; unknown fields dropped; `<` `>` refused in names | `422` with the list of bad fields |
| 7 | The email's domain accepts mail (DNS MX lookup) | `422` (`emailDomain`) |
| 8 | Saved by `vault.js` | `200` with a reference, or `503` so the browser retries |

The browser applies the same rules as check 6 to give instant feedback, but **the server never trusts the
browser**: browser checks can be skipped by anyone sending requests by hand.

Responses never contain the applicant's data, only a reference. Logs contain counts and outcomes, never names,
emails or companies.

---

## 5. Storing applications (`server/vault.js`)

Each application is one line of JSON in an **append-only** file:

```json
{ "v":1, "id":"<uuid>", "at":"<time>", "fp":"<hmac>", "prev":"<hash of previous line>",
  "box": { "iv":"…", "tag":"…", "ct":"<encrypted application>" } }
```

| Goal | How |
|---|---|
| **Unreadable without the key** | Name, email, company, role, seats and notes are encrypted with **AES-256-GCM** (`box.ct`) |
| **Tampering is detected** | GCM adds an authentication tag: changing one bit makes decryption fail. The record id is bound into the ciphertext |
| **No line can be removed or inserted** | Each line stores the SHA-256 of the line before it (a hash chain) |
| **Duplicates found without decrypting** | `fp` is an HMAC fingerprint of `email + session`; a repeat returns the original reference |
| **No lost applications** | Written with `fsync` (really on disk) **before** the server answers; a second copy goes to `data/backup/`; writes are queued so two requests cannot interleave |
| **Recovery after a crash** | At start-up a half-written last line is cut off (a copy is kept), and a missing main file is restored from the backup |
| **Keys** | One master key makes two independent keys (HKDF): one encrypts, one makes fingerprints. The key lives in `keys/`, separate from `data/` |

`npm run check` re-verifies the whole chain and decrypts every record. `npm run export` writes the decrypted
applications to CSV for the team (cells that start with `= + - @` are escaped so a sign-up cannot become a
spreadsheet formula).

---

## 6. Security summary

The earlier version (HTML/CSS/JS only) had no server and no data, so there was nothing to attack. Adding a
form created personal data, and with it a server and these protections:

| Risk | Protection |
|---|---|
| Injected or third-party scripts | **Content-Security-Policy**: only our own scripts and styles load; no inline code; data may be sent only to our own origin; no iframes |
| Cross-site forged sign-ups (CSRF) | `Origin` check |
| Data stolen from disk or backup | AES-256-GCM encryption; key stored apart from data |
| Edited or deleted records | Authentication tags + hash chain, verified by `npm run check` |
| Data lost on crash or power cut | `fsync`, backup copy, start-up recovery |
| Data lost on a bad connection | 3 retries with the same id; server saves once |
| Wrong email addresses | Format check, typo suggestions, DNS check of the domain |
| Spam and flooding | Honeypot, rate limit, 4 KB body limit, request timeouts |
| XSS | `textContent` only, no `innerHTML`, `<` `>` refused, strict CSP |
| Reading server files through the URL | Only `site/` is served; `../`, encoded paths and hidden files return 404 |
| Malicious packages | **Zero dependencies**: nothing to install means nothing to poison |
| Leaks through logs | Logs hold no personal data |
| Interception in transit | Optional local TLS (`npm run start:https`, TLS 1.3 tested); a real host provides HTTPS |

**Honest limits:** the DNS check proves a domain can receive mail, not that the mailbox exists (only a
confirmation email can). The backup is on the same disk as the log, so it protects against a damaged file, not a
lost disk. If the key is lost, the data cannot be read again: keep a copy of `keys/secret.key` elsewhere.

---

## 7. Design decisions (answers to the client's questions)

| Question | Answer | How the site delivers it |
|---|---|---|
| What does "premium" mean? | A real, designed product, not a generic page; colours chosen for the audience | Warm paper + graphite + one terracotta accent; large tight type; generous space |
| What is "simple"? | Clear and intuitive: obvious what to click | One goal, one button style, six sections in a logical order, three facts in the hero |
| What does "make it pop" mean? | Priority: the most important action stands out | The accent colour appears only on actions; every action leads to the form |
| Is there a brand guide? | No. Direction: Apple-like expressiveness, recognisable even without a logo | A "strata lines" mark used in the nav, hero artwork, favicon and footer |

The section structure (navbar → masthead → icons grid → showcases → call to action → footer) is adapted from the
**Start Bootstrap "Landing Page"** template (MIT licence). It was rewritten in plain HTML/CSS/JS rather than
copied, because the original loads three CDNs and posts its form to a third-party service, which this project's
security rules do not allow.

---

## 8. Configuration (optional)

All settings have safe defaults for local use.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8081` | HTTP port |
| `HOST` | `127.0.0.1` | Address to listen on (local only by default) |
| `HTTPS` | off | Set to `1` to serve HTTPS from `certs/` (HTTP then only redirects) |
| `HTTPS_PORT` | `8443` | HTTPS port |
| `DATA_DIR` | `./data` | Where encrypted applications are stored |
| `SIGNUP_KEY` | file `keys/secret.key` | 32-byte key, base64. **Required** when `NODE_ENV=production`, so a key can never be silently lost |
| `TRUST_PROXY` | off | Set to `1` behind a hosting provider's proxy so rate limiting sees real visitor addresses |

---

*STRATA is a fictional workshop built as a course exercise.*
