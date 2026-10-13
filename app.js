// STRATA — four jobs: 1. Day 1/Day 2 switch  2. reveal on scroll  3. email check  4. send the application
// Security rules: textContent only (no innerHTML/eval), nothing from the URL goes onto the page,
// data goes only to our own server, and the success screen appears only after the server confirms it saved.

'use strict';

(() => {
  document.documentElement.classList.add('js');

  // 1. Programme tabs (arrow keys move between days, like native tabs) ------------------------
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const tabBar = document.querySelector('.tabs');
  const pill = tabBar && tabBar.querySelector('.tabs-pill');
  let current = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
  let stretchTimer = 0;

  // The pill is positioned with CSS variables, so the browser animates it (transitions live in styles.css).
  const rectOf = t => ({ x: t.offsetLeft, y: t.offsetTop, w: t.offsetWidth, h: t.offsetHeight });
  const place = r => {
    pill.style.setProperty('--x', `${r.x}px`);
    pill.style.setProperty('--y', `${r.y}px`);
    pill.style.setProperty('--w', `${r.w}px`);
    pill.style.setProperty('--h', `${r.h}px`);
  };
  const snap = () => {                                  // jump to the current tab, no animation
    clearTimeout(stretchTimer);
    pill.dataset.phase = 'snap';
    place(rectOf(current));
    void pill.offsetWidth;                              // flush, so the jump isn't animated
    delete pill.dataset.phase;
  };
  // Liquid move: first stretch over both tabs, then pull the far end in.
  const glide = (from, to) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return snap();
    const a = rectOf(from), b = rectOf(to);
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    clearTimeout(stretchTimer);
    pill.dataset.phase = 'stretch';
    place({ x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y });
    stretchTimer = setTimeout(() => { delete pill.dataset.phase; place(b); }, 150);
  };

  const select = tab => {
    if (tab === current) return;
    const from = current, forward = tabs.indexOf(tab) > tabs.indexOf(from);
    current = tab;
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (on) panel.dataset.from = forward ? 'right' : 'left';
      panel.hidden = !on;
    });
    if (pill) glide(from, tab);
  };

  if (pill) {
    snap();
    tabBar.classList.add('has-pill');
    requestAnimationFrame(() => requestAnimationFrame(() => tabBar.classList.add('ready')));   // animate only after the first placement
    addEventListener('resize', snap, { passive: true });
    if (document.fonts) document.fonts.ready.then(snap);   // tab widths change when the font arrives
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });

  // 2. Reveal on scroll ------------------------------------------------------------------------
  const io = new IntersectionObserver((entries, obs) => {
    entries.filter(e => e.isIntersecting).forEach(e => { e.target.classList.add('in'); obs.unobserve(e.target); });
  }, { threshold: .15 });
  document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

  // Placeholder links shouldn't jump to the top
  document.addEventListener('click', e => { if (e.target.closest('a[href="#"]')) e.preventDefault(); });

  // 3–4. Application form ----------------------------------------------------------------------
  const form = document.getElementById('apply-form');
  if (!form) return;

  const done = document.querySelector('.done');
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('[type="submit"]');
  const hint = document.getElementById('email-hint');
  const total = form.querySelector('.total b');
  const PRICE = 5000;
  const SESSIONS = ['2027-02', '2027-05', '2027-09'];
  const ROLES = [...form.elements.role.options].map(o => o.value).filter(Boolean);
  const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
  const FREE = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'mail.ru', 'yandex.ru', 'gmx.de', 'aol.com', 'proton.me'];
  const TYPOS = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'yahooo.com': 'yahoo.com', 'icloud.co': 'icloud.com' };
  const endpoint = form.dataset.endpoint;
  const endpointOk = endpoint.startsWith('/') && !endpoint.startsWith('//');   // our own server only

  const MARKUP = /[<>]/;
  const money = n => '€' + n.toLocaleString('en-GB');

  // live total
  form.elements.seats.addEventListener('input', () => {
    const n = Math.min(10, Math.max(1, parseInt(form.elements.seats.value, 10) || 1));
    total.textContent = money(n * PRICE);
  });

  // email: format, common typos, personal-address hint
  const setHint = (text, kind = '') => { hint.textContent = text; hint.className = `hint ${kind}`; };
  const checkEmail = () => {
    const input = form.elements.email;
    const value = input.value.trim().toLowerCase();
    input.removeAttribute('aria-invalid');
    setHint('');
    if (!value) return;
    if (!EMAIL.test(value)) { setHint('This doesn\'t look like a complete email address.', 'error'); input.setAttribute('aria-invalid', 'true'); return; }
    const [user, domain] = value.split('@');
    if (TYPOS[domain]) {
      const fixed = `${user}@${TYPOS[domain]}`;
      setHint('Did you mean ', 'warn');
      const fix = document.createElement('button');   // built with DOM, not innerHTML
      fix.type = 'button';
      fix.textContent = fixed;
      fix.addEventListener('click', () => { input.value = fixed; checkEmail(); input.focus(); });
      hint.append(fix, '?');
      return;
    }
    if (FREE.includes(domain)) setHint('A work email helps us confirm your seat faster.', 'warn');
  };
  form.elements.email.addEventListener('blur', checkEmail);
  form.elements.email.addEventListener('input', () => { if (hint.classList.contains('error')) checkEmail(); });

  const say = (text, kind = '') => { status.textContent = text; status.className = `form-status ${kind}`; };

  const MESSAGES = {
    session: 'Please choose a session.',
    firstName: 'Please enter your first name.',
    lastName: 'Please enter your last name.',
    email: 'Please enter a valid work email.',
    emailDomain: 'We can\'t find this email domain. Please check the address after the @.',
    company: 'Please enter your company.',
    role: 'Please choose your role.',
    seats: 'Seats must be between 1 and 10.',
    notes: 'Please keep your note under 500 characters.',
    consent: 'Please agree so we can process your application.',
  };

  const markInvalid = fields => {
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    fields.forEach(f => {
      const key = f === 'emailDomain' ? 'email' : f;
      const el = key === 'session' ? form.querySelector('.sessions') : key === 'consent' ? form.querySelector('.consent') : form.elements[key];
      el.setAttribute('aria-invalid', 'true');
    });
    if (fields.length) {
      const first = fields[0] === 'emailDomain' ? 'email' : fields[0];
      (first === 'session' ? form.querySelector('[name="session"]') : form.elements[first]).focus();
      say(MESSAGES[fields[0]], 'error');
    }
  };

  const read = () => {
    const f = form.elements;
    return {
      session: (form.querySelector('[name="session"]:checked') || {}).value || '',
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      email: f.email.value.trim().toLowerCase(),
      company: f.company.value.trim(),
      role: f.role.value,
      seats: Number(f.seats.value),
      notes: f.notes.value.trim(),
      consent: f.consent.checked,
    };
  };

  const validate = d => {
    const bad = [];
    if (!SESSIONS.includes(d.session)) bad.push('session');
    if (d.firstName.length < 1 || d.firstName.length > 60 || MARKUP.test(d.firstName)) bad.push('firstName');
    if (d.lastName.length < 1 || d.lastName.length > 60 || MARKUP.test(d.lastName)) bad.push('lastName');
    if (!EMAIL.test(d.email) || d.email.length > 120) bad.push('email');
    if (d.company.length < 2 || d.company.length > 100 || MARKUP.test(d.company)) bad.push('company');
    if (!ROLES.includes(d.role)) bad.push('role');
    if (!Number.isInteger(d.seats) || d.seats < 1 || d.seats > 10) bad.push('seats');
    if (d.notes.length > 500) bad.push('notes');
    if (!d.consent) bad.push('consent');
    return bad;
  };

  // Retry network errors and 5xx (1s, 2s, 4s) with the SAME id: the server saves it once.
  const send = async body => {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST', body, credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(12000),
        });
      } catch { res = null; }                                    // offline / timeout: retry
      if (res && res.status < 500) return res;
      if (attempt === 3) throw new Error('unreachable');
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  };

  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    if (form.elements.website.value) return;                      // honeypot: bots stop here

    const data = read();
    const bad = validate(data);
    markInvalid(bad);
    if (bad.length) return;
    if (!endpointOk) { say('The form is not configured. Please try again later.', 'error'); return; }

    busy = true;
    submit.disabled = true;
    say('Sending securely…');

    try {
      const res = await send(JSON.stringify({ ...data, id: crypto.randomUUID() }));
      const reply = await res.json().catch(() => ({}));

      if (res.ok && typeof reply.ref === 'string') {
        // shown ONLY after the server confirmed the application is encrypted and on disk
        form.hidden = true;
        done.querySelector('.ref').textContent = reply.ref;
        done.hidden = false;
        done.focus();
        return;
      }
      const known = Array.isArray(reply.fields) ? reply.fields.filter(f => f in MESSAGES) : [];
      if (res.status === 422 && known.length) {
        markInvalid(known);
        if (reply.fields.includes('emailDomain')) setHint(MESSAGES.emailDomain, 'error');
      } else if (res.status === 429) {
        say('Too many attempts. Please wait a few minutes and try again.', 'error');
      } else {
        say('Something went wrong. Your details are still in the form — please try again.', 'error');
      }
    } catch {
      say('We could not reach the server. Your details are still in the form — please try again.', 'error');
    } finally {
      busy = false;
      submit.disabled = false;
    }
  });
})();
