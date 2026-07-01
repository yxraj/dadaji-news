/* ==========================================================
   Dadaji News — script.js
   Static site version — CORS proxied GNews API calls
   ========================================================== */

'use strict';

/* ── Config ─────────────────────────────────────────────── */
const API_KEY   = 'c3ac7875998e4c5e599686a84e798010';
const API_BASE  = 'https://gnews.io/api/v4';
const PAGE_SIZE = 9;

/* Two public CORS proxies tried in order */
const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];

/* Category → CSS gradient class */
const CAT_GRAD = {
  general:       'grad-general',
  world:         'grad-world',
  business:      'grad-business',
  technology:    'grad-technology',
  science:       'grad-science',
  health:        'grad-health',
  sports:        'grad-sports',
  entertainment: 'grad-entertainment',
  education:     'grad-education',
};

/* ── State ───────────────────────────────────────────────── */
const S = {
  category:  'general',
  query:     '',
  page:      1,
  total:     0,
  articles:  [],
  busy:      false,     /* first-page loading */
  paging:    false,     /* loading more pages */
  done:      false,     /* no more pages */
  error:     false,
};

/* ── DOM ─────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const EL = {
  ticker:       $('ticker'),
  tickerInner:  $('ticker-inner'),
  feed:         $('feed'),
  sentinel:     $('sentinel'),
  loadMore:     $('load-more'),
  endMsg:       $('end-msg'),
  stateLoading: $('state-loading'),
  stateError:   $('state-error'),
  stateEmpty:   $('state-empty'),
  skeletons:    $('skeletons'),
  searchInput:  $('search-input'),
  searchClear:  $('search-clear'),
  searchBanner: $('search-banner'),
  searchTerm:   $('search-term'),
  catNav:       $('cat-nav'),
  retryBtn:     $('retry-btn'),
  themeBtn:     $('theme-btn'),
  iconMoon:     $('icon-moon'),
  iconSun:      $('icon-sun'),
  scrollTop:    $('scroll-top'),
};

/* ── CORS-safe fetch ─────────────────────────────────────── */
async function apiFetch(gnewsUrl) {
  let lastErr;
  for (const proxy of PROXIES) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 12000);
      const res  = await fetch(proxy(gnewsUrl), { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/* ── Build GNews URL ─────────────────────────────────────── */
function buildUrl(page) {
  const p = new URLSearchParams({
    apikey: API_KEY,
    lang:   'en',
    max:    PAGE_SIZE,
    page,
  });

  if (S.query) {
    p.set('q', S.query);
    return `${API_BASE}/search?${p}`;
  }

  p.set('country', 'in');

  if (S.category === 'education') {
    p.set('category', 'general');
    p.set('q', 'education school students');
  } else {
    p.set('category', S.category);
  }

  return `${API_BASE}/top-headlines?${p}`;
}

/* ── Theme ───────────────────────────────────────────────── */
function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
  EL.iconMoon.style.display = t === 'dark' ? 'none'  : '';
  EL.iconSun.style.display  = t === 'dark' ? ''      : 'none';
  localStorage.setItem('dj-theme', t);
}

EL.themeBtn.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
});

/* ── Category pills ──────────────────────────────────────── */
document.querySelectorAll('.cat-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    if (S.busy || S.paging) return;
    document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.category = btn.dataset.cat;
    clearSearch();       /* also triggers resetFetch */
  });
});

/* ── Search ──────────────────────────────────────────────── */
let searchTimer = null;

EL.searchInput.addEventListener('input', () => {
  const v = EL.searchInput.value.trim();
  EL.searchClear.classList.toggle('visible', !!v);
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    S.query = v;
    if (v) {
      show(EL.searchBanner);
      hide(EL.catNav);
      EL.searchTerm.textContent = `"${v}"`;
    } else {
      hide(EL.searchBanner);
      show(EL.catNav);
    }
    resetFetch();
  }, 480);
});

EL.searchClear.addEventListener('click', clearSearch);

function clearSearch() {
  EL.searchInput.value = '';
  EL.searchClear.classList.remove('visible');
  hide(EL.searchBanner);
  show(EL.catNav);
  S.query = '';
  resetFetch();
}

/* exposed to HTML onclick */
window.clearSearch = clearSearch;

function resetToHome() {
  /* Set category BEFORE clearSearch triggers resetFetch */
  S.category = 'general';
  document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-cat="general"]').classList.add('active');
  clearSearch(); /* triggers resetFetch with S.category already = 'general' */
}
window.resetToHome = resetToHome;

/* ── Retry ───────────────────────────────────────────────── */
EL.retryBtn.addEventListener('click', () => {
  S.error = false;
  resetFetch();
});

/* ── Fetch logic ─────────────────────────────────────────── */
function resetFetch() {
  S.page     = 1;
  S.total    = 0;
  S.articles = [];
  S.done     = false;
  S.error    = false;
  EL.feed.innerHTML = '';
  hideAllStates();
  show(EL.stateLoading);
  renderSkeletons();
  loadPage(true);
}

async function loadPage(isFirst) {
  if (isFirst) {
    S.busy = true;
  } else {
    if (S.paging || S.done || S.error || S.busy) return;
    S.paging = true;
    show(EL.loadMore);
  }

  try {
    const data     = await apiFetch(buildUrl(S.page));
    const incoming = (data.articles || []);
    S.total    = data.totalArticles || 0;
    S.articles = [...S.articles, ...incoming];

    if (isFirst) {
      S.busy = false;
      hideAllStates();
      EL.feed.innerHTML = '';

      if (!incoming.length) { show(EL.stateEmpty); return; }
      renderFirst(incoming);
    } else {
      S.paging = false;
      hide(EL.loadMore);
      appendCards(incoming, S.articles.length - incoming.length);
    }

    /* Check if we've exhausted results */
    if (incoming.length < PAGE_SIZE || S.articles.length >= S.total) {
      S.done = true;
      show(EL.endMsg);
    } else {
      S.page++;
    }

  } catch (err) {
    console.error(err);
    if (isFirst) {
      S.busy  = false;
      S.error = true;
      hideAllStates();
      show(EL.stateError);
    } else {
      S.paging = false;
      hide(EL.loadMore);
      /* silent fail on page 2+ — sentinel still active for retry on scroll */
    }
  }
}

/* ── Render ──────────────────────────────────────────────── */
function renderFirst(articles) {
  const heroable = !S.query && S.category === 'general';
  const hero     = heroable ? articles[0] : null;
  const rest     = heroable ? articles.slice(1) : articles;

  if (hero) EL.feed.appendChild(buildHero(hero));

  const grid = document.createElement('div');
  grid.id        = 'grid';
  grid.className = 'grid';
  rest.forEach((a, i) => grid.appendChild(buildCard(a, i)));
  EL.feed.appendChild(grid);
}

function appendCards(articles, baseIndex) {
  let grid = document.getElementById('grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id        = 'grid';
    grid.className = 'grid';
    EL.feed.appendChild(grid);
  }
  articles.forEach((a, i) => {
    const card = buildCard(a, baseIndex + i);
    card.style.animationDelay = `${Math.min(i * 0.06, 0.36)}s`;
    grid.appendChild(card);
  });
}

/* ── Hero ────────────────────────────────────────────────── */
function buildHero(a) {
  const el = document.createElement('div');
  el.className  = 'hero';
  el.tabIndex   = 0;
  el.setAttribute('role', 'article');

  const imgHtml = a.image
    ? `<img class="hero__img" src="${x(a.image)}" alt="" loading="lazy"
           onerror="this.style.display='none'">`
    : `<div class="hero__img grad-general" style="opacity:.65"></div>`;

  el.innerHTML = `
    <div class="hero__bg">${imgHtml}</div>
    <div class="hero__overlay"></div>
    <div class="hero__body">
      <div class="hero__meta">
        <span class="hero__badge">Top Story</span>
        <span class="hero__time">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
          </svg>
          ${x(ago(a.publishedAt))}
        </span>
        ${a.source?.name ? `<span class="hero__source">${x(a.source.name)}</span>` : ''}
      </div>
      <h2 class="hero__title">${x(a.title)}</h2>
      ${a.description ? `<p class="hero__desc">${x(a.description)}</p>` : ''}
      <span class="hero__cta">
        Read Full Article
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" x2="21" y1="14" y2="3"/>
        </svg>
      </span>
    </div>`;

  const open = () => window.open(a.url, '_blank', 'noopener,noreferrer');
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
  return el;
}

/* ── Card ────────────────────────────────────────────────── */
function buildCard(a, idx) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.animationDelay = `${Math.min(idx * 0.06, 0.54)}s`;

  const grad    = CAT_GRAD[S.category] || 'grad-general';
  const initial = (a.title || 'N').charAt(0).toUpperCase();
  const catLbl  = S.category.charAt(0).toUpperCase() + S.category.slice(1);

  const imgHtml = a.image
    ? `<img class="card__img" src="${x(a.image)}" alt="" loading="lazy"
           onerror="this.parentNode.innerHTML='<div class=\\"card__fallback ${grad}\\">${x(initial)}</div>`
    : `<div class="card__fallback ${grad}">${x(initial)}</div>`;

  card.innerHTML = `
    <div class="card__img-wrap">
      ${imgHtml}
      <div class="card__source">${x(a.source?.name || 'News')}</div>
    </div>
    <div class="card__body">
      <div class="card__meta">
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
        </svg>
        ${x(ago(a.publishedAt))}
        <span class="card__dot"></span>
        <span class="card__cat">${x(catLbl)}</span>
      </div>
      <h3 class="card__title">${x(a.title)}</h3>
      <p class="card__desc">${x(a.description || 'Read the full story for more details.')}</p>
      <a class="card__link" href="${x(a.url)}" target="_blank" rel="noopener noreferrer">
        Read Full Story
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" x2="21" y1="14" y2="3"/>
        </svg>
      </a>
    </div>`;

  return card;
}

/* ── Skeletons ───────────────────────────────────────────── */
function renderSkeletons() {
  EL.skeletons.innerHTML = `
    <div class="skel-hero skel"></div>
    <div class="grid">
      ${Array.from({length: 6}).map(() => `
        <div class="skel-card">
          <div class="skel-img skel"></div>
          <div class="skel-body">
            <div class="skel-line skel" style="width:52%"></div>
            <div class="skel-xl   skel"></div>
            <div class="skel-lg   skel" style="width:85%"></div>
            <div class="skel-sm   skel" style="width:70%"></div>
            <div class="skel-sm   skel" style="width:60%"></div>
            <div class="skel-sm   skel" style="width:38%;margin-top:8px"></div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Ticker ──────────────────────────────────────────────── */
async function loadTicker() {
  /* Fallback headlines shown if API fails (rate limit etc.) */
  const fallbacks = [
    'Welcome to Dadaji News — your morning briefing',
    'Browse top headlines by category above',
    'Use search to find specific topics or stories',
    'Click any card to read the full article',
    'Toggle dark mode with the button in the top-right',
  ];

  let titles = fallbacks;

  try {
    const url  = `${API_BASE}/top-headlines?${new URLSearchParams({
      apikey: API_KEY, lang: 'en', country: 'in',
      category: 'general', max: 7, page: 1,
    })}`;
    const data = await apiFetch(url);
    if (data.articles?.length) {
      titles = data.articles.map(a => a.title);
    }
  } catch (_) { /* use fallbacks */ }

  /* Duplicate items so the marquee loops seamlessly */
  const doubled = [...titles, ...titles];
  EL.tickerInner.innerHTML = doubled
    .map(t => `<span class="ticker__item">${x(t)}</span><span class="ticker__sep">•</span>`)
    .join('');

  /* Measure full width then set animation duration proportionally */
  requestAnimationFrame(() => {
    const w = EL.tickerInner.scrollWidth / 2; /* half = one full set */
    const spd = Math.max(w / 80, 18);         /* ~80px/s, min 18s */
    EL.tickerInner.style.animation = `ticker-move ${spd}s linear infinite`;
  });
}

/* ── Infinite scroll ─────────────────────────────────────── */
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && !S.busy && !S.paging && !S.done && !S.error && S.articles.length) {
    loadPage(false);
  }
}, { rootMargin: '300px' });

observer.observe(EL.sentinel);

/* ── Scroll-to-top ───────────────────────────────────────── */
window.addEventListener('scroll', () => {
  EL.scrollTop.classList.toggle('show', window.scrollY > 500);
}, { passive: true });

EL.scrollTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ── Helpers ─────────────────────────────────────────────── */
function show(el) { el.style.display = ''; }
function hide(el) { el.style.display = 'none'; }

function hideAllStates() {
  hide(EL.stateLoading);
  hide(EL.stateError);
  hide(EL.stateEmpty);
  hide(EL.loadMore);
  hide(EL.endMsg);
}

/* Escape HTML to prevent XSS */
function x(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* Relative time */
function ago(iso) {
  if (!iso) return 'Recently';
  const d = Math.floor((Date.now() - new Date(iso)) / 60000); /* minutes */
  if (d <  1)  return 'Just now';
  if (d < 60)  return `${d}m ago`;
  const h = Math.floor(d / 60);
  if (h < 24)  return `${h}h ago`;
  const dy = Math.floor(h / 24);
  if (dy < 7)  return `${dy}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

/* ── Boot ────────────────────────────────────────────────── */
(function init() {
  /* Restore theme */
  applyTheme(localStorage.getItem('dj-theme') || 'light');

  /* Load ticker (independent, non-blocking) */
  loadTicker();

  /* Load first page of news */
  resetFetch();
})();
