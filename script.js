/* ============================================================
   令你入画 · 个人主页脚本
   - 仓库列表 / 描述 / Star 数 / Fork 数 / 许可证 / 语言构成：全部由 JS 从 GitHub REST API 获取
   - 每张卡片右上角的折叠符号可展开该仓库的 Star 历史（SVG 面积图）
   - 纯前端，无后端；localStorage 缓存降低 API 限额消耗
   ============================================================ */

'use strict';

(function () {

  /* ── 配置 ────────────────────────────────────────────── */
  const USER = 'lnrh1';                 // 改这里即可换成别的账号
  const API  = 'https://api.github.com';

  const TTL_USER  = 30 * 60 * 1000;      // 账号信息缓存 30 分钟
  const TTL_REPOS = 10 * 60 * 1000;      // 仓库列表缓存 10 分钟
  const TTL_STARS = 30 * 60 * 1000;      // Star 数据缓存 30 分钟
  const TTL_LANGS = 24 * 60 * 60 * 1000; // 语言字节数基本不变，缓存 24 小时

  const CACHE = 'hua:v1:';
  const MAX_EVENT_PAGES = 3;             // Star 时间线：最多 3×100 条仓库公共事件
  const MAX_LANG_REPOS  = 12;            // 语言统计最多取这么多个仓库（按体积优先），控制限额
  const LANG_SEGMENTS   = 4;             // 单仓库语言条最多几段，其余合并为“其他”

  const LOADER_MIN   = 900;              // 加载动画最短显示时长，避免一闪而过
  const LOADER_MAX   = 9000;             // 兜底：无论成功失败都不会一直卡住

  /* ── 小工具 ──────────────────────────────────────────── */
  const ICON = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>',
    fork: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2.4"/><circle cx="18" cy="5" r="2.4"/><circle cx="12" cy="19" r="2.4"/><path d="M6 7.4v3.1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.4M12 12.5v4.1"/></svg>',
    license: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5v17M8.5 20.5h7M5.5 7.5h13"/><path d="m5.5 7.5-2.6 5.6a3.1 3.1 0 0 0 5.2 0z"/><path d="m18.5 7.5-2.6 5.6a3.1 3.1 0 0 0 5.2 0z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  };

  const LANG_COLORS = {
    JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', HTML: '#e34c26',
    CSS: '#563d7c', SCSS: '#c6538c', Vue: '#41b883', Svelte: '#ff3e00', Java: '#b07219',
    Kotlin: '#A97BFF', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600', Go: '#00ADD8',
    Rust: '#dea584', Ruby: '#701516', PHP: '#4F5D95', Swift: '#F05138', Shell: '#89e051',
    PowerShell: '#012456', Lua: '#000080', Dart: '#00B4AB', Elixir: '#6e4a7e',
    Clojure: '#db5855', Haskell: '#5e5086', Zig: '#ec915c', Nix: '#7e7eff',
    Dockerfile: '#384d54', Makefile: '#427819', 'Jupyter Notebook': '#DA5B0B', R: '#198CE7',
    MATLAB: '#e16737', Perl: '#0298c3', Scala: '#c22d40', 'Objective-C': '#438eff',
    Assembly: '#6E4C13', Batchfile: '#C1F12E', Astro: '#ff5a03', MDX: '#fcb32c',
    TeX: '#3D6117', 'Vim Script': '#199f4b', GDScript: '#355570', Solidity: '#AA6746',
    HCL: '#844FBA', CMake: '#DA3434', Less: '#1d365d', Stylus: '#ff6347',
    Blade: '#f7523f', EJS: '#a91e50', Handlebars: '#f7931e'
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 已知语言用 GitHub 官方色；未知语言用名称哈希出稳定颜色 */
  function langColorFor(name) {
    if (LANG_COLORS[name]) return LANG_COLORS[name];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 42%, 62%)';
  }

  const fmtPct = (p) => (p >= 9.95 ? Math.round(p) : p.toFixed(1)) + '%';

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function ago(iso) {
    const t = Date.parse(iso);
    if (!t) return '—';
    const d = (Date.now() - t) / 1000;
    if (d < 90) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    if (d < 2592000) return Math.floor(d / 86400) + ' 天前';
    if (d < 31536000) return Math.floor(d / 2592000) + ' 个月前';
    return Math.floor(d / 31536000) + ' 年前';
  }

  const dstr = (ts) => new Date(ts).toLocaleDateString('zh-CN',
    { year: 'numeric', month: '2-digit', day: '2-digit' });

  /** 时间跨度较短时（公共事件窗口可能只有几十分钟）带上时分，避免两个轴标签长得一样 */
  function dlabel(a, b) {
    if (Math.abs(b - a) < 36 * 3600 * 1000) {
      return new Date(a).toLocaleString('zh-CN',
        { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    return dstr(a);
  }

  /** 把 {语言: 字节数} 转成带占比的降序列表，超出 limit 的合并为“其他” */
  function topLanguages(bytes, limit) {
    const entries = Object.keys(bytes || {})
      .map((k) => ({ name: k, bytes: Number(bytes[k]) || 0 }))
      .filter((e) => e.bytes > 0)
      .sort((a, b) => b.bytes - a.bytes);

    const total = entries.reduce((s, e) => s + e.bytes, 0);
    if (!total) return [];

    const n = limit || LANG_SEGMENTS;
    let list = entries;
    if (entries.length > n) {
      const rest = entries.slice(n - 1);
      list = entries.slice(0, n - 1).concat([{
        name: '其他',
        bytes: rest.reduce((s, e) => s + e.bytes, 0)
      }]);
    }
    return list.map((e) => ({ name: e.name, bytes: e.bytes, pct: e.bytes / total * 100 }));
  }

  /* ── 缓存 ────────────────────────────────────────────── */
  function store(key, v) {
    try { localStorage.setItem(CACHE + key, JSON.stringify({ t: Date.now(), v: v })); }
    catch (e) { /* 配额满，忽略 */ }
  }

  function load(key, ttl) {
    try {
      const raw = localStorage.getItem(CACHE + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || Date.now() - o.t > ttl) return null;
      return o.v;
    } catch (e) { return null; }
  }

  function clearCache(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(CACHE + (prefix || '')) === 0) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch (e) { /* 忽略 */ }
  }

  /* ── API ─────────────────────────────────────────────── */
  const rate = { limit: 0, remaining: 0, reset: 0 };

  function noteRate(res) {
    const lim = res.headers.get('x-ratelimit-limit');
    if (!lim) return;
    rate.limit = +lim;
    rate.remaining = +res.headers.get('x-ratelimit-remaining');
    rate.reset = +res.headers.get('x-ratelimit-reset') * 1000;
  }

  async function gh(path) {
    let res;
    try {
      res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } });
    } catch (e) {
      const err = new Error('无法连接 api.github.com（网络不可用或被拦截）');
      err.network = true;
      throw err;
    }

    noteRate(res);
    if (res.ok) return res.json();

    let message = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      if (j && j.message) message = j.message;
    } catch (e) { /* 非 JSON 响应 */ }

    const err = new Error(message);
    err.status = res.status;
    err.rateLimited = (res.status === 403 || res.status === 429) && rate.remaining === 0;
    throw err;
  }

  const getRepos = async (force) => {
    if (!force) {
      const cached = load('repos', TTL_REPOS);
      if (cached) return cached;
    }
    const arr = await gh('/users/' + USER + '/repos?per_page=100&sort=pushed');
    const list = Array.isArray(arr) ? arr : [];
    store('repos', list);
    return list;
  };

  const getUser = async (force) => {
    if (!force) {
      const cached = load('user', TTL_USER);
      if (cached) return cached;
    }
    const u = await gh('/users/' + USER);
    store('user', u);
    return u;
  };

  /* ── Star 历史 ───────────────────────────────────────── */
  /**
   * GitHub 从 2025 年起要求认证才能读取 Star 时间线（/stargazers 未认证返回 401），
   * 所以这里免认证地从仓库公共事件里挑出 WatchEvent（Star）时间戳。
   * 代价是只覆盖 GitHub 公共事件窗口内（最多 3×100 条事件）的 Star，不是完整历史。
   */
  async function getStars(full) {
    const cached = load('stars:' + full, TTL_STARS);
    if (cached) return cached;

    const pts = [];
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      const arr = await gh('/repos/' + full + '/events?per_page=100&page=' + page);
      if (!Array.isArray(arr) || !arr.length) break;
      for (const ev of arr) {
        if (ev && ev.type === 'WatchEvent' && ev.created_at) pts.push(Date.parse(ev.created_at));
      }
      if (arr.length < 100) break;
    }

    pts.sort((a, b) => a - b);
    const out = { pts: pts };
    store('stars:' + full, out);
    return out;
  }

  /* ── 语言构成 ────────────────────────────────────────── */
  const langBytes = new Map();     // full_name -> { 语言: 字节数 }

  /** /repos/{o}/{r}/languages 返回 {语言: 字节数}，用它算占比 */
  async function getLanguages(full) {
    const cached = load('langs:' + full, TTL_LANGS);
    if (cached) return cached;
    const obj = await gh('/repos/' + full + '/languages');
    const out = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
    store('langs:' + full, out);
    return out;
  }

  function langTargets() {
    return state.repos
      .filter((r) => r && r.full_name && !r.fork)
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, MAX_LANG_REPOS);
  }

  async function loadLanguages() {
    const targets = langTargets();
    if (!targets.length) return;

    const need = [];
    for (const r of targets) {
      const c = load('langs:' + r.full_name, TTL_LANGS);
      if (c) langBytes.set(r.full_name, c);
      else need.push(r);
    }
    renderCardLangs();

    // 最多 3 个并发，避免瞬间打满限额
    const queue = need.slice();
    const workers = [];
    for (let i = 0; i < 3; i++) {
      workers.push((async () => {
        while (queue.length) {
          const r = queue.shift();
          try {
            langBytes.set(r.full_name, await getLanguages(r.full_name));
            renderCardLangs();
          } catch (e) {
            // 单个仓库失败不影响其它卡片，只留一条可排查的痕迹
            console.warn('[hua] 语言统计失败：' + r.full_name + ' — ' + (e.status || e.message));
          }
        }
      })());
    }
    await Promise.all(workers);
    renderCardLangs();
  }

  function renderCardLangs() {
    for (const [full, el] of cards) {
      const host = el.querySelector('[data-role=lang]');
      if (!host) continue;

      const list = topLanguages(langBytes.get(full), LANG_SEGMENTS);
      if (!list.length) {
        host.innerHTML = '';
        host.removeAttribute('title');
        continue;
      }

      const bar = list.map((e) =>
        '<span class="lang-seg" style="width:' + e.pct.toFixed(3) + '%;background:' +
        langColorFor(e.name) + '" title="' + esc(e.name) + ' ' + fmtPct(e.pct) + '"></span>').join('');

      // 只有一种语言时，色条已足够说明问题，不再重复列图例
      const legend = list.length > 1
        ? '<div class="lang-legend">' + list.map((e) =>
            '<span class="li"><i class="dot" style="--lang:' + langColorFor(e.name) + '"></i>' +
            esc(e.name) + ' <b>' + fmtPct(e.pct) + '</b></span>').join('') + '</div>'
        : '';

      host.innerHTML = '<div class="lang-mini">' + bar + '</div>' + legend;
      host.title = list.map((e) => e.name + ' ' + fmtPct(e.pct) + '（' + fmtBytes(e.bytes) + '）').join('\n');
    }
  }

  /* ── 点阵背景：粒子呼吸 + 鼠标斥力 ───────────────────── */
  function initDots() {
    const canvas = document.getElementById('bgDots');
    const bg = document.querySelector('.bg');
    if (!canvas || !bg) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const GAP    = 27;     // 点阵间距（调大以减少粒子数）
    const IS_MOBILE = matchMedia('(max-width: 720px)').matches;
    const MOBILE_GAP = 40;   // 移动端间距更大，粒子更少
    const R      = 1.5;    // 点的基准半径
    const RADIUS = 132;    // 斥力影响半径
    const PUSH   = 26;     // 最大排开距离
    const BASE   = { r: 37, g: 99, b: 235 };

    // 移动端 DPR 上限更低，减少 canvas 像素数
    const dpr = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.5 : 2);
    let W = 0, H = 0, cols = 0, rows = 0;
    let parts = [];
    let mx = -9999, my = -9999, mIn = false;

    function build() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const gap = IS_MOBILE ? MOBILE_GAP : GAP;
      cols = Math.floor(W / gap) + 2;
      rows = Math.floor(H / gap) + 2;
      const ox = (W - (cols - 1) * gap) / 2;
      const oy = (H - (rows - 1) * gap) / 2;

      parts = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          parts.push({
            x: ox + c * gap,
            y: oy + r * gap,
            // 每个粒子独立的呼吸频率与相位 → 状态各不相同（频率已调快）
            ph: Math.random() * Math.PI * 2,
            sp: 1.05 + Math.random() * 1.9,
            // 基础透明度也各不相同，避免整片点阵太“齐”
            ba: 0.34 + Math.random() * 0.5,
            // 个体缩放差异
            s0: 0.72 + Math.random() * 0.6,
            // 带一点随机偏移，破掉机械的方格感
            jx: (Math.random() - 0.5) * 4.5,
            jy: (Math.random() - 0.5) * 4.5,
            dx: 0, dy: 0,
            // 离视口中心的距离，用于整体的上下渐隐
            d: 0
          });
        }
      }
      for (const p of parts) {
        p.d = 1 - Math.min(1, (p.y + p.jy) / (H * 1.15));
      }
      // 半径按行/列先算一次，后面只更新动态部分
      if (reduce) drawOnce();
    }

    // 平滑跟随鼠标，避免抖动
    let tx = -9999, ty = -9999;
    function onMove(e) {
      tx = e.clientX; ty = e.clientY; mIn = true;
      lastMoveAt = performance.now();   // 标记“活跃”，帧率随之升到 60fps
    }
    function onLeave() { mIn = false; tx = -9999; ty = -9999; }

    function drawOnce() {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        const a = p.ba * p.d;
        if (a <= 0.01) continue;
        ctx.beginPath();
        ctx.arc(p.x + p.jx, p.y + p.jy, R * p.s0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + BASE.r + ',' + BASE.g + ',' + BASE.b + ',' + a + ')';
        ctx.fill();
      }
    }

    let raf = 0;
    let last = performance.now();
    // 自适应帧率：鼠标活跃时 60fps 保证“跟手”，静止时降到 30fps 省 CPU。
    // 之前固定 30fps + 鼠标缓动 0.18，导致斥力明显滞后。
    const FRAME_IDLE   = 1000 / 30;
    const FRAME_ACTIVE = 1000 / 60;
    const ACTIVE_MS    = 180;   // 最后一次移动后多久内算“活跃”
    let acc = 0;
    let lastMoveAt = 0;

    function frame(now) {
      // 保持 rAF 链连续：时间不够就直接跳过这一帧的重绘，
      // 不做 setTimeout 往返（那会造成每秒几十次多余的唤醒）
      raf = requestAnimationFrame(frame);

      const frameMs = (now - lastMoveAt < ACTIVE_MS) ? FRAME_ACTIVE : FRAME_IDLE;

      const dt = Math.min(64, now - last);
      last = now;
      acc += dt;
      if (acc < frameMs) return;
      acc = 0;

      const t = now / 1000;

      // 鼠标位置跟随：系数越大越跟手（0.18 在 30fps 下要 167ms 才跟上 63%，
      // 是之前“不跟手”的主因；配合 60fps 现在约 4 帧即到位）
      mx += (tx - mx) * 0.62;
      my += (ty - my) * 0.62;
      if (!mIn && Math.abs(tx - mx) < 0.5) { mx = tx; my = ty; }

      ctx.clearRect(0, 0, W, H);

      for (const p of parts) {
        // 呼吸：半径、透明度、色深都在变，每个粒子节奏不同
        const b = 0.5 + 0.5 * Math.sin(t * p.sp + p.ph);
        const wave = 0.35 + 0.65 * b;
        const s = p.s0 * (0.62 + 0.72 * b);

        // 斥力：鼠标把附近的点向外推开
        let px = p.x + p.jx;
        let py = p.y + p.jy;
        let boost = 0;
        if (mIn) {
          const ddx = px - mx, ddy = py - my;
          const dist = Math.hypot(ddx, ddy);
          if (dist < RADIUS && dist > 0.001) {
            const force = 1 - dist / RADIUS;          // 0..1，越近越强
            const e = force * force;                  // 平方衰减，边缘更柔和
            const len = PUSH * e;
            // 目标位移量，用缓动跟随，产生“被推开又回弹”的手感
            // 系数从 0.22 提到 0.5，让粒子更快被推到目标位置（更跟手）
            p.dx += ((ddx / dist) * len - p.dx) * 0.5;
            p.dy += ((ddy / dist) * len - p.dy) * 0.5;
            boost = e;
          }
        }
        // 缓动回到原位
        p.dx += (0 - p.dx) * 0.14;
        p.dy += (0 - p.dy) * 0.14;

        const a = (p.ba * p.d) * (0.45 + 0.55 * wave) * (1 + boost * 0.9);
        if (a <= 0.012) continue;

        // 被推开的点同时变亮变大，强化“受挤压”的感觉
        const rr = R * s * (1 + boost * 0.85);
        const g = Math.round(BASE.g + (150 - BASE.g) * boost);
        const bl = Math.round(BASE.b + (255 - BASE.b) * boost);

        // 小圆点用 fillRect 画方块即可：半径不到 2px 时肉眼分辨不出，
        // 但省掉了每个点一次 beginPath/arc/fill 的路径开销
        const d2 = rr * 2;
        ctx.fillStyle = 'rgba(' + BASE.r + ',' + g + ',' + bl + ',' + Math.min(1, a) + ')';
        ctx.fillRect(px + p.dx - rr, py + p.dy - rr, d2, d2);
      }

    }

    let rt = 0;
    function onResize() {
      clearTimeout(rt);
      rt = setTimeout(() => {
        const wasCss = !bg.classList.contains('no-css-dots');
        build();
        if (wasCss) bg.classList.add('no-css-dots');
      }, 180);
    }

    build();
    bg.classList.add('no-css-dots');   // canvas 已接管，去掉 CSS 兜底点阵

    if (reduce) { drawOnce(); return; }

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    window.addEventListener('blur', onLeave);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    });
    window.addEventListener('resize', onResize);
    raf = requestAnimationFrame(frame);
  }

  /* ── 状态 ────────────────────────────────────────────── */
  const state = { repos: [], user: null, sort: 'stars', hideForks: true };
  const cards  = new Map();   // full_name -> 卡片 DOM（复用节点，展开状态与图表不丢）
  const charts = new Map();   // full_name -> { series }

  const grid = document.getElementById('repoGrid');

  /* ── 仓库列表 ────────────────────────────────────────── */
  function visibleRepos() {
    let list = state.repos.filter((r) => r && r.full_name);
    if (state.hideForks) list = list.filter((r) => !r.fork);
    const byPushed = (a, b) => (Date.parse(b.pushed_at) || 0) - (Date.parse(a.pushed_at) || 0);
    return list.sort(state.sort === 'stars'
      ? (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0) || byPushed(a, b)
      : byPushed);
  }

  function metaHTML(r) {
    const parts = [];

    if (r.language) {
      parts.push('<span class="lang"><i class="dot" style="--lang:' + langColorFor(r.language) + '"></i>' +
        esc(r.language) + '</span>');
    }

    parts.push('<span class="m" title="Star 数">' + ICON.star + fmt(r.stargazers_count) + '</span>');
    parts.push('<span class="m" title="Fork 数">' + ICON.fork + fmt(r.forks_count) + '</span>');

    // 许可证
    const lic = r.license;
    if (lic && (lic.spdx_id || lic.name)) {
      const label = lic.spdx_id && lic.spdx_id !== 'NOASSERTION' ? lic.spdx_id : lic.name;
      parts.push('<span class="m" title="' + esc(lic.name || label) + '">' +
        ICON.license + esc(label) + '</span>');
    } else {
      parts.push('<span class="m dim" title="仓库未声明许可证">' + ICON.license + '无 License</span>');
    }

    parts.push('<span class="m" title="最后推送">更新于 ' + ago(r.pushed_at) + '</span>');
    return parts.join('');
  }

  function buildCard(r) {
    const el = document.createElement('article');
    el.className = 'repo';
    el.dataset.full = r.full_name;

    el.innerHTML =
      '<div class="repo-top">' +
        '<a class="repo-name" href="' + esc(r.html_url) + '" target="_blank" rel="noopener">' +
          esc(r.name) + '</a>' +
        (r.archived ? '<span class="repo-flag">已归档</span>' : '') +
        '<button class="chev" type="button" aria-expanded="false" title="展开 Star 历史" ' +
          'aria-label="展开 ' + esc(r.name) + ' 的 Star 历史">' + ICON.chev + '</button>' +
      '</div>' +
      (r.description
        ? '<p class="repo-desc">' + esc(r.description) + '</p>'
        : '<p class="repo-desc none">暂无描述</p>') +
      '<div class="repo-meta">' + metaHTML(r) + '</div>' +
      '<div class="lang-block" data-role="lang"></div>' +
      '<div class="repo-panel"><div class="inner"><div class="panel-body" data-role="body"></div></div></div>';

    const chev = el.querySelector('.chev');
    chev.addEventListener('click', () => toggleCard(el, r, chev));
    return el;
  }

  function layout() {
    const want = visibleRepos();

    if (!want.length) {
      for (const el of cards.values()) el.remove();
      grid.innerHTML = '<p class="empty">没有可显示的仓库' +
        (state.repos.length ? '（试试取消勾选“隐藏 fork”）。' : '。') + '</p>';
      return;
    }

    const placeholder = grid.querySelector('.empty, .err-box');
    if (placeholder) placeholder.remove();

    for (const r of want) {
      let el = cards.get(r.full_name);
      if (!el) { el = buildCard(r); cards.set(r.full_name, el); }
      grid.appendChild(el);          // appendChild 移动已有节点：展开状态与图表得以保留
    }
    for (const [full, el] of cards) {
      if (!want.some((r) => r.full_name === full)) el.remove();
    }
    renderCardLangs();     // 新建的卡片补上语言条
  }

  /* ── 展开 / 收起 ─────────────────────────────────────── */
  function toggleCard(el, r, chev) {
    const open = el.classList.toggle('open');
    chev.setAttribute('aria-expanded', open ? 'true' : 'false');
    chev.title = open ? '收起 Star 历史' : '展开 Star 历史';

    if (!open) return;
    if (el.dataset.loaded !== '1') loadStars(el, r);
    else redraw(el);
  }

  async function loadStars(el, r) {
    const body = el.querySelector('[data-role=body]');
    el.dataset.loaded = '1';
    body.innerHTML = '<div class="panel-head"><span class="t">Star 历史</span></div>' +
      '<p class="panel-note"><span class="spin"></span>正在获取 Star 时间线…</p>';

    try {
      const data = await getStars(r.full_name);
      if (!el.classList.contains('open')) return;    // 加载途中被收起
      renderPanel(el, r, data);
    } catch (e) {
      el.dataset.loaded = '';
      body.innerHTML = errBox(e, '获取 Star 历史失败');
      const btn = body.querySelector('[data-retry]');
      if (btn) btn.addEventListener('click', () => loadStars(el, r));
    }
  }

  function renderPanel(el, r, data) {
    const body = el.querySelector('[data-role=body]');
    const pts = data.pts || [];
    const total = r.stargazers_count || 0;

    const ext = '<a class="ext" href="https://star-history.com/#' + esc(r.full_name) +
      '&Date" target="_blank" rel="noopener">star-history ↗</a>';

    const head = (sub) => '<div class="panel-head"><span class="t">Star 历史</span>' +
      '<span>' + sub + '</span>' + ext + '</div>';

    if (!pts.length) {
      const note = total === 0
        ? '这个仓库还没有收到 Star。'
        : 'GitHub 公共事件窗口内没有 Star 记录。';
      body.innerHTML = head('共 ' + fmt(total) + ' 个') + '<p class="panel-note">' + note + '</p>';
      charts.delete(r.full_name);
      return;
    }

    // 从窗口内首个 Star 起步累计
    const series = [[pts[0], 0]];
    pts.forEach((t, i) => series.push([t, i + 1]));

    const recent30 = pts.filter((t) => t >= Date.now() - 30 * 864e5).length;
    const sub = '窗口内 ' + pts.length + ' 个 · 总计 ' + fmt(total) + ' 个';

    body.innerHTML = head(sub) +
      '<div class="chart" data-role="chart"></div>' +
      '<div class="chart-sum">' +
        '<span>窗口起点 ' + dstr(pts[0]) + '</span>' +
        '<span>最近 ' + dstr(pts[pts.length - 1]) + '</span>' +
        '<span>近 30 天 +' + recent30 + '</span>' +
      '</div>' +
      '<p class="chart-note">只统计 GitHub 公共事件可见范围内的 Star（最多 ' +
        (MAX_EVENT_PAGES * 100) + ' 条仓库事件），因此曲线反映的是近期增长，不是完整历史。</p>';

    charts.set(r.full_name, { series: series });
    drawChart(body.querySelector('[data-role=chart]'), series);
  }

  function redraw(el) {
    const c = charts.get(el.dataset.full);
    if (!c) return;
    const host = el.querySelector('[data-role=chart]');
    if (host) drawChart(host, c.series);
  }

  /* ── SVG 面积图 ──────────────────────────────────────── */
  function niceTop(n) {
    if (n <= 5) return Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(n)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      if (m * mag >= n) return m * mag;
    }
    return 10 * mag;
  }

  function drawChart(host, series) {
    if (!host || !series || series.length < 2) return;

    const W = Math.max(260, Math.round(host.clientWidth || 340));
    const H = 148;
    const P = { t: 12, r: 12, b: 22, l: 40 };
    const iw = W - P.l - P.r;
    const ih = H - P.t - P.b;

    const t0 = series[0][0];
    const t1 = Math.max(series[series.length - 1][0], Date.now());
    const total = series[series.length - 1][1];
    const top = niceTop(total);

    const X = (t) => P.l + (t1 === t0 ? iw : (t - t0) / (t1 - t0) * iw);
    const Y = (v) => P.t + ih - (v / top) * ih;
    const y0 = P.t + ih;

    const line = series.map((p, i) =>
      (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
    const area = line + ' L ' + X(t1).toFixed(1) + ' ' + y0.toFixed(1) +
                       ' L ' + X(t0).toFixed(1) + ' ' + y0.toFixed(1) + ' Z';

    const tickVals = top <= 4 ? [0, top] : [0, top / 2, top];
    // 大数值用 126k 这种写法，避免 y 轴出现 126000
    const tickFmt = (v) => fmt(Number.isInteger(v) ? v : Number(v.toFixed(1)));
    const grid = tickVals.map((v) =>
      '<line class="gridline" x1="' + P.l + '" y1="' + Y(v).toFixed(1) +
        '" x2="' + (W - P.r) + '" y2="' + Y(v).toFixed(1) + '"/>' +
      '<text class="ylab" x="' + (P.l - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) +
        '" text-anchor="end">' + tickFmt(v) + '</text>').join('');

    const dots = series.length <= 40
      ? series.slice(1).map((p) =>
          '<circle class="pt" cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) +
          '" r="2.8"/>').join('')
      : '';

    host.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H +
        '" preserveAspectRatio="none" role="img" aria-label="近期 Star 增长曲线，' +
        dlabel(t0, t1) + ' 起累计 ' + total + ' 个">' +
        grid +
        '<path class="area" d="' + area + '"/>' +
        '<path class="line" d="' + line + '"/>' +
        dots +
        '<text class="xlab" x="' + P.l + '" y="' + (H - 6) + '">' + dlabel(t0, t1) + '</text>' +
        '<text class="xlab" x="' + (W - P.r) + '" y="' + (H - 6) + '" text-anchor="end">' +
          dlabel(t1, t0) + '</text>' +
        '<line class="cross" x1="0" y1="' + P.t + '" x2="0" y2="' + y0 + '" style="opacity:0"/>' +
        '<circle class="cursor" cx="0" cy="0" r="3.6" style="opacity:0"/>' +
        '<rect class="hit" x="' + P.l + '" y="' + P.t + '" width="' + iw + '" height="' + ih + '"/>' +
      '</svg><div class="tip"></div>';

    const svg    = host.querySelector('svg');
    const cross  = host.querySelector('.cross');
    const cursor = host.querySelector('.cursor');
    const tip    = host.querySelector('.tip');
    const hit    = host.querySelector('.hit');

    function onMove(ev) {
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const scale = W / box.width;
      const x = (ev.clientX - box.left) * scale;

      let best = 0, bestD = Infinity;
      for (let i = 0; i < series.length; i++) {
        const d = Math.abs(X(series[i][0]) - x);
        if (d < bestD) { bestD = d; best = i; }
      }

      const px = X(series[best][0]);
      const py = Y(series[best][1]);

      cross.setAttribute('x1', px); cross.setAttribute('x2', px);
      cursor.setAttribute('cx', px); cursor.setAttribute('cy', py);
      cross.style.opacity = 1; cursor.style.opacity = 1;

      tip.textContent = dstr(series[best][0]) + ' · ' + series[best][1] + ' star';

      // 按提示框实际宽度夹住左右，别被卡片边缘裁掉
      const tw = tip.offsetWidth || 120;
      const half = tw / 2 + 3;
      const px2 = px / scale;
      tip.style.left = Math.min(Math.max(px2, half), Math.max(half, box.width - half)) + 'px';

      // 点太靠上时把提示框翻到下方，否则会被面板的 overflow:hidden 切掉
      const py2 = py / scale;
      const above = py2 > (tip.offsetHeight || 22) + 8;
      tip.style.top = (above ? py2 : py2 + 14) + 'px';
      tip.classList.toggle('below', !above);
      tip.classList.add('on');
    }

    function onLeave() {
      cross.style.opacity = 0;
      cursor.style.opacity = 0;
      tip.classList.remove('on');
    }

    hit.addEventListener('mousemove', onMove);
    hit.addEventListener('mouseleave', onLeave);
  }

  /* ── 总览数字 ────────────────────────────────────────── */
  function setStat(key, value) {
    const el = document.querySelector('#stats [data-k="' + key + '"]');
    if (el) el.textContent = value;
  }

  function renderStats() {
    const repos = state.repos || [];
    if (repos.length) {
      setStat('repos', fmt(state.user ? state.user.public_repos : repos.length));
      setStat('stars', fmt(repos.reduce((s, r) => s + (r.stargazers_count || 0), 0)));
      const newest = repos.reduce((a, r) => Math.max(a, Date.parse(r.pushed_at) || 0), 0);
      setStat('updated', newest ? ago(new Date(newest).toISOString()) : '—');
    }
    if (state.user) setStat('followers', fmt(state.user.followers));
  }

  function errBox(e, title) {
    let detail, hint = '';

    if (e.rateLimited) {
      detail = 'GitHub API 的未认证限额（60 次/小时/IP）已经用尽。';
      hint = rate.reset
        ? '限额将在 <b>' + new Date(rate.reset).toLocaleTimeString('zh-CN') + '</b> 重置，稍后再试即可。'
        : '稍后再试即可。';
    } else if (e.status === 404) {
      detail = '请求的资源不存在（用户或仓库可能已改名 / 设为私有）。';
    } else if (e.network) {
      detail = '网络请求失败：可能离线、被浏览器扩展拦截，或 api.github.com 不可达。';
    } else {
      detail = esc(e.message || String(e));
    }

    return '<div class="err-box"><b>' + esc(title) + '</b><br>' + detail +
      (hint ? '<br>' + hint : '') +
      '<br><button class="btn mini" type="button" data-retry>重试</button></div>';
  }

  /* ── 加载动画 ────────────────────────────────────────── */
  const loader = document.getElementById('loader');
  const loaderBar = document.getElementById('loaderBar');
  const loaderStart = Date.now();
  let loaderHidden = false;

  function loadProgress(pct) {
    if (!loaderBar) return;
    loaderBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function hideLoader() {
    if (loaderHidden || !loader) return;
    loaderHidden = true;

    // 保证动画至少完整露一次脸
    const wait = Math.max(0, LOADER_MIN - (Date.now() - loaderStart));
    setTimeout(() => {
      loadProgress(100);
      setTimeout(() => {
        // 先停止拦截点击，再淡出；否则淡出这段时间里页面点不动
        loader.style.pointerEvents = 'none';
        loader.classList.add('done');
        document.body.classList.remove('loading');
        setTimeout(() => loader.remove(), 700);
      }, 260);
    }, wait);
  }

  /** 等头像图片有结果（成功或失败），最多等 cap 毫秒 */
  function waitAvatar(cap) {
    const img = document.getElementById('avatar');
    if (!img || (img.complete && (img.naturalWidth > 0 || img.dataset.failed === '1'))) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      img.addEventListener('load', finish, { once: true });
      img.addEventListener('error', finish, { once: true });
      setTimeout(finish, cap || 4000);
    });
  }

  /* ── 头像：优先用页面写死的图，失败时退到 GitHub 头像，再失败则露出占位 ── */
  let avatarUrl = '';

  function applyAvatarFallback() {
    const img = document.getElementById('avatar');
    if (!img) return;
    img.dataset.failed = '1';
    if (avatarUrl && img.dataset.fallback !== '1') {
      img.dataset.fallback = '1';      // 只换一次，避免两个地址都挂时来回切
      img.style.display = '';
      img.src = avatarUrl;
    } else {
      img.style.display = 'none';      // 都不可用：露出背后的 “画” 占位
    }
  }

  function hookAvatar() {
    const img = document.getElementById('avatar');
    if (!img || img.dataset.hooked === '1') return;
    img.dataset.hooked = '1';
    img.addEventListener('error', applyAvatarFallback);
    // 图片可能在脚本执行前就已经失败了，这里补一次判断
    if (img.complete && img.naturalWidth === 0) applyAvatarFallback();
  }

  function applyAvatar(u) {
    if (!u || !u.avatar_url) return;
    avatarUrl = u.avatar_url;
    const img = document.getElementById('avatar');
    // 之前因为拿不到备用地址而隐藏了，现在补上
    if (img && img.dataset.failed === '1' && img.dataset.fallback !== '1') applyAvatarFallback();
  }

  /* ── 弹窗 ────────────────────────────────────────────── */
  function setupModal(triggerId, overlayId) {
    const trigger = document.getElementById(triggerId);
    const overlay = document.getElementById(overlayId);
    if (!trigger || !overlay) return;

    const closeBtn = overlay.querySelector('.modal-close');
    let lastFocus = null;

    function open() {
      lastFocus = document.activeElement;
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      // 遮罩刚从 visibility:hidden 变可见，先强制一次样式重算，
      // 否则同一帧内 focus() 会因为元素仍“不可聚焦”而失效
      void overlay.offsetHeight;
      if (closeBtn) {
        closeBtn.focus();
        if (document.activeElement !== closeBtn) {
          requestAnimationFrame(() => closeBtn.focus());
        }
      }
    }

    function close() {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    trigger.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  function setupCopyEmail() {
    const btn = document.getElementById('copyBtn');
    if (!btn) return;

    const label = btn.querySelector('.copy-label');
    const email = document.getElementById('emailText').textContent.trim();
    let timer = null;

    function done() {
      btn.classList.add('copied');
      label.textContent = '已复制 ✓';
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove('copied');
        label.textContent = label.dataset.default;
      }, 1600);
    }

    function fail() {
      btn.classList.remove('copied');
      label.textContent = '复制失败，请手动选中';
      clearTimeout(timer);
      timer = setTimeout(() => { label.textContent = label.dataset.default; }, 2200);
    }

    function legacyCopy() {
      const ta = document.createElement('textarea');
      ta.value = email;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    }

    btn.addEventListener('click', () => {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(email).then(done, legacyCopy);
      } else {
        legacyCopy();
      }
    });
  }

  /* ── 交互绑定 ────────────────────────────────────────── */
  function setupControls() {
    const seg = document.getElementById('sortSeg');
    if (seg) {
      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-sort]');
        if (!btn) return;
        state.sort = btn.dataset.sort;
        for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b === btn);
        layout();
      });
    }

    const hide = document.getElementById('hideForks');
    if (hide) {
      hide.checked = state.hideForks;
      hide.addEventListener('change', () => { state.hideForks = hide.checked; layout(); });
    }

    const refresh = document.getElementById('refreshBtn');
    if (refresh) {
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        clearCache('repos');
        clearCache('user');
        clearCache('stars:');
        clearCache('langs:');
        langBytes.clear();
        for (const el of cards.values()) el.remove();
        cards.clear();
        charts.clear();
        state.repos = [];
        await loadRepos(true);
        refresh.disabled = false;
      });
    }
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      for (const el of cards.values()) {
        if (el.classList.contains('open')) redraw(el);
      }
    }, 160);
  });

  /* ── 加载流程 ────────────────────────────────────────── */
  async function loadRepos(force) {
    grid.innerHTML = '<p class="empty"><span class="spin"></span>正在从 GitHub 获取仓库列表…</p>';
    try {
      const repos = await getRepos(force);
      state.repos = repos;
      layout();
      renderStats();
      loadLanguages();          // 语言构成不阻塞仓库列表渲染
    } catch (e) {
      grid.innerHTML = errBox(e, '获取仓库列表失败');
      const btn = grid.querySelector('[data-retry]');
      if (btn) btn.addEventListener('click', () => loadRepos(true));
    }
  }

  /* ── 音乐播放器 ──────────────────────────────────────── */
  const fmtTime = (s) => {
    if (s == null) return '--:--';          // 时长还没测出来
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  };

  function initPlayer() {
    const dock = document.getElementById('dock');
    const listEl = document.getElementById('pList');
    if (!dock || !listEl) return;

    const el = {
      play: document.getElementById('pPlay'),
      prev: document.getElementById('pPrev'),
      next: document.getElementById('pNext'),
      title: document.getElementById('pTitle'),
      cur: document.getElementById('pCur'),
      dur: document.getElementById('pDur'),
      wave: document.getElementById('pWave'),
      canvas: document.getElementById('pCanvas'),
      buf: document.getElementById('pBuf'),
      bufTxt: document.getElementById('pBufTxt'),
      count: document.getElementById('pCount'),
      hint: document.getElementById('pHint')
    };

    const audio = new Audio();
    audio.preload = 'none';            // 永不主动下载音频

    let tracks = [];
    let idx = -1;
    let peaks = [];
    let raf = 0;

    const blobCache = new Map();       // file -> { url, blob }
    let inflight = null;

    /* ── 底部波形 ── */
    const cv = el.canvas;
    const ctx = cv.getContext('2d');
    let hoverX = -1;

    // 缓存画布尺寸：每帧都读 getBoundingClientRect 会强制同步布局，是滚动卡顿的主因之一
    let cvW = 0, cvH = 0;

    function sizeCanvas() {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvW = r.width;
      cvH = r.height;
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawWave() {
      const w = cvW, h = cvH;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);

      // 还没有波形数据（新加的歌）：画一条淡淡的待生成提示条
      if (!peaks.length) {
        ctx.fillStyle = '#e6e8ee';
        const bh = Math.max(3, h * 0.16);
        ctx.fillRect(0, (h - bh) / 2, w, bh);
        if (total() > 0) {
          const px = Math.min(w - 1, audio.currentTime / audio.duration * w);
          ctx.fillStyle = '#2563eb';
          ctx.fillRect(0, (h - bh) / 2, px, bh);
        }
        return;
      }

      // 采样点可能多于或少于可用列宽，统一按“逐个采样点均分”绘制，
      // 但保证每段至少 1px，避免窄屏时出现空隙
      const n = peaks.length;
      const slot = w / n;
      const gap = slot > 4 ? 2 : (slot > 2 ? 1 : 0);
      const bw = Math.max(1, slot - gap);
      const mid = h / 2;
      const dur = audio.duration || 0;
      const prog = dur ? audio.currentTime / dur : 0;

      for (let i = 0; i < n; i++) {
        const v = Math.max(0.04, peaks[i] || 0);
        const bh = Math.max(2, v * (h - 8));
        const x = i * slot;
        const played = (i + 0.5) / n <= prog;

        let color = '#dfe3ea';
        if (played) color = '#2563eb';
        else if (hoverX >= 0 && hoverX < x + bw) color = '#bfd3ff';

        ctx.fillStyle = color;
        const y = mid - bh / 2;
        const rad = Math.min(bw / 2, 1.5);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, rad);
        else ctx.rect(x, y, bw, bh);
        ctx.fill();
      }

      if (total() > 0) {
        const px = Math.min(w - 1, prog * w);
        ctx.fillStyle = '#1d4fd7';
        ctx.fillRect(Math.max(0, px - 1), 2, 2, h - 4);
      }
    }

    const total = () => (audio.duration || 0);

    function syncTime() {
      if (total()) {
        el.cur.textContent = fmtTime(audio.currentTime);
        el.wave.setAttribute('aria-valuenow', Math.round(audio.currentTime / audio.duration * 100));
      }
    }

    /**
     * 动画帧：只在“播放中”才持续运行。
     * 之前无论是否在播放都每帧重绘三条 canvas，是页面卡顿的主要原因。
     */
    function tick() {
      drawWave();
      syncTrackWave();
      syncPlaybackUI();
      raf = requestAnimationFrame(tick);
    }

    function startTick() {
      if (raf) return;
      raf = requestAnimationFrame(tick);
    }

    function stopTick() {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      // 停下后再补画一帧，确保静止状态显示正确
      drawWave();
      syncTrackWave();
    }

    /* ── 当前曲目的迷你波形 ──
       canvas 引用与尺寸都缓存：尺寸只在「重渲染列表」和「窗口缩放」时才重新测量，
       播放期间每帧直接复用，避免 querySelector / getBoundingClientRect 强制布局 */
    let trackCv = null, trackCvW = 0, trackCvH = 0, trackCvDpr = 0;

    function invalidateTrackWave() {
      trackCv = null;
      trackCvW = 0;
      trackCvH = 0;
    }

    function syncTrackWave() {
      if (!trackCv || !trackCv.isConnected) {
        trackCv = listEl.querySelector('.track.active .track-wave canvas');
        trackCvW = 0;
        if (!trackCv) return;
      }
      if (!trackCvW) {
        const r = trackCv.getBoundingClientRect();
        if (!r.width) return;
        trackCvW = r.width;
        trackCvH = r.height;
        trackCvDpr = Math.min(window.devicePixelRatio || 1, 2);
        trackCv.width = Math.max(1, Math.round(r.width * trackCvDpr));
        trackCv.height = Math.max(1, Math.round(r.height * trackCvDpr));
      }
      const r = { width: trackCvW, height: trackCvH };
      const c = trackCv.getContext('2d');
      c.setTransform(trackCvDpr, 0, 0, trackCvDpr, 0, 0);
      c.clearRect(0, 0, r.width, r.height);

      // 波形待生成时画一条淡条
      if (!peaks.length) {
        c.fillStyle = '#c7d9ff';
        const bh = Math.max(2, r.height * 0.2);
        c.fillRect(0, (r.height - bh) / 2, r.width, bh);
        return;
      }

      // 采样点比像素列多时，按列取最大值，保证每一列都有内容
      const n = peaks.length;
      const cols = Math.max(8, Math.floor(r.width / 2));   // 2px 一列
      const bw = r.width / cols;
      const mid = r.height / 2;
      const prog = total() ? audio.currentTime / audio.duration : 0;

      for (let i = 0; i < cols; i++) {
        const s = Math.floor(i / cols * n);
        const e = Math.max(s + 1, Math.floor((i + 1) / cols * n));
        let v = 0;
        for (let j = s; j < e && j < n; j++) if (peaks[j] > v) v = peaks[j];
        v = Math.max(0.05, v);
        const bh = Math.max(1.5, v * (r.height - 4));
        c.fillStyle = (i + 0.5) / cols <= prog ? '#2563eb' : '#c7d9ff';
        c.fillRect(i * bw, mid - bh / 2, Math.max(1, bw - 0.6), bh);
      }
    }

    /* ── 下载进度 ── */
    function setBufUI(pct) {
      el.buf.firstElementChild.style.width = (pct * 100).toFixed(1) + '%';
      el.bufTxt.textContent = Math.round(pct * 100) + '%';
    }

    /** 加载态：底部条与当前列表行一起转圈，保证两边同步 */
    function showLoading(on) {
      const on2 = !!on;
      el.wave.classList.toggle('loading', on2);
      dock.classList.toggle('loading', on2);
      const li = listEl.querySelector('.track.active');
      if (li) li.classList.toggle('loading', on2);
      if (!on2) el.bufTxt.textContent = '';
      syncPlaybackUI();
    }

    /** 点播放才下载；带真实进度；完成后缓存成 blob，不再重复下载
     *  返回 { url, blob } —— blob 留着给 computePeaks 解码用 */
    async function ensureAudio(t) {
      if (blobCache.has(t.file)) return blobCache.get(t.file);
      if (inflight && inflight.file === t.file) return inflight.promise;

      const controller = new AbortController();

      const promise = (async () => {
        const resp = await fetch(t.file, { signal: controller.signal });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        const size = +(resp.headers.get('content-length') || 0);
        const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;

        let blob;
        if (reader && size > 0) {
          const chunks = [];
          let got = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            got += value.length;
            const pct = Math.min(1, got / size);
            if (tracks[idx] && tracks[idx].file === t.file) setBufUI(pct);
          }
          blob = new Blob(chunks, { type: 'audio/mpeg' });
        } else {
          blob = await resp.blob();
        }

        const entry = { url: URL.createObjectURL(blob), blob };
        blobCache.set(t.file, entry);
        return entry;
      })();

      inflight = { file: t.file, promise, controller };
      try {
        return await promise;
      } finally {
        if (inflight && inflight.file === t.file) inflight = null;
      }
    }

    /** 新加的歌没有预生成波形时，第一次播放就地解码算出来 */
    async function computePeaks(t, blob) {
      try {
        const buf = await blob.arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const actx = new AC();
        const decoded = await actx.decodeAudioData(buf);
        const ch = decoded.getChannelData(0);
        const N = 140;
        const block = Math.floor(ch.length / N) || 1;
        const rms = [];
        for (let i = 0; i < N; i++) {
          const s = i * block;
          const e = Math.min(s + block, ch.length);
          const step = Math.max(1, Math.floor((e - s) / 4000));
          let sum = 0, cnt = 0;
          for (let j = s; j < e; j += step) { const v = ch[j]; sum += v * v; cnt++; }
          rms.push(Math.sqrt(sum / Math.max(1, cnt)));
        }
        const mx = Math.max.apply(null, rms) || 1;
        t.peaks = rms.map((v) => Math.round(v / mx * 1000) / 1000);
        t.duration = Math.round(decoded.duration * 100) / 100;
        if (actx.close) actx.close();

        if (tracks[idx] && tracks[idx].file === t.file) {
          peaks = t.peaks;
          el.dur.textContent = fmtTime(t.duration);
          drawWave();
        }
        renderList();
      } catch (e) {
        // 解码失败不影响播放，保留占位波形
      }
    }

    /* ── 列表渲染 ── */
    /** 环形按钮的 HTML（列表与底部条共用同一套结构，保证外观一致） */
    function ringBtnHTML(small) {
      return '<button class="ringbtn" type="button"' +
          (small ? ' tabindex="-1" aria-hidden="true"' : '') + '>' +
        '<svg class="rb-ic rb-play" viewBox="0 0 24 24" fill="currentColor">' +
          '<path d="M9 5.5v13c0 .7.8 1.1 1.4.7l9.2-6.5c.5-.4.5-1.1 0-1.5L10.4 4.8C9.8 4.4 9 4.8 9 5.5z"/></svg>' +
        '<svg class="rb-ic rb-pause" viewBox="0 0 24 24" fill="currentColor">' +
          '<rect x="7" y="5" width="3.6" height="14" rx="1.3"/>' +
          '<rect x="13.4" y="5" width="3.6" height="14" rx="1.3"/></svg>' +
        '<svg class="rb-ring" viewBox="0 0 36 36">' +
          '<circle class="rb-tr" cx="18" cy="18" r="16.4"/>' +
          '<circle class="rb-fg" cx="18" cy="18" r="16.4"/></svg>' +
      '</button>';
    }

    function renderList() {
      listEl.innerHTML = tracks.map((t, i) => {
        const on = i === idx;
        return '<li class="track' + (on ? ' active' : '') + '" data-i="' + i + '">' +
          '<span class="track-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
          ringBtnHTML(true) +
          '<span class="track-main">' +
            '<span class="track-name">' + esc(t.title) +
              (t.cn ? ' <span class="cn">（' + esc(t.cn) + '）</span>' : '') + '</span>' +
            '<span class="track-sub">' + esc(t.artist || '未知艺人') + '</span>' +
          '</span>' +
          '<span class="track-wave"><canvas></canvas></span>' +
          '<span class="track-dur">' + fmtTime(t.duration) + '</span>' +
        '</li>';
      }).join('');
      // 列表 DOM 重建了，迷你波形的 canvas 引用和尺寸缓存全部失效
      invalidateTrackWave();
    }

    /* ── 状态同步：底部条与列表走同一套逻辑，保证完全一致 ── */
    const RING_LEN = 2 * Math.PI * 16.4;

    const isPlaying = () => !audio.paused && !audio.ended && !!audio.currentSrc;

    /** 需要同步的容器：底部条 + 当前选中行 */
    function syncTargets() {
      const out = [dock];
      const li = listEl.querySelector('.track.active');
      if (li) out.push(li);
      return out;
    }

    /** 把 active / playing 与圆环进度同时同步到两处 */
    function syncPlaybackUI() {
      const playing = isPlaying();
      const p = total() ? Math.max(0, Math.min(1, audio.currentTime / audio.duration)) : 0;

      for (const host of syncTargets()) {
        host.classList.toggle('active', idx >= 0);
        host.classList.toggle('playing', playing);

        const fg = host.querySelector('.rb-fg');
        if (!fg) continue;
        // 暂停 / 加载中 / 无时长：清掉 inline 交回 CSS
        // （暂停 = 整圈闭合变蓝，加载 = 一段短弧转圈）
        if (!playing || host.classList.contains('loading') || !total()) {
          fg.style.strokeDashoffset = '';
        } else {
          fg.style.strokeDashoffset = (RING_LEN * (1 - p)).toFixed(2);
        }
      }
    }

    /** 只更新某一行的时长文本，不重建整个列表（重建会丢 canvas 状态） */
    function updateRowDuration(i) {
      const li = listEl.querySelector('.track[data-i="' + i + '"] .track-dur');
      const t = tracks[i];
      if (li && t) li.textContent = fmtTime(t.duration);
    }

    /** 总时长文案随实际测量结果更新 */
    function updateCountText() {
      if (!el.count) return;
      const known = tracks.filter((t) => t.duration);
      const tot = known.reduce((s2, t) => s2 + t.duration, 0);
      let txt = tracks.length + ' 首';
      if (known.length === tracks.length) txt += ' · 共 ' + Math.max(1, Math.round(tot / 60)) + ' 分钟';
      el.count.textContent = txt;
    }

    function setDockTitle(t) {
      if (!t) { el.title.textContent = '未在播放'; return; }
      el.title.innerHTML = esc(t.artist) + ' · ' + esc(t.title) +
        (t.cn ? ' <span class="cn">（' + esc(t.cn) + '）</span>' : '');
    }

    /* ── 播放控制 ── */
    async function start(i, autoplay) {
      if (i < 0 || i >= tracks.length) return;
      idx = i;
      const t = tracks[i];
      peaks = t.peaks || [];
      setDockTitle(t);
      renderList();
      el.dur.textContent = fmtTime(t.duration);
      el.cur.textContent = '0:00';
      dock.classList.add('on');
      dock.setAttribute('aria-hidden', 'false');
      drawWave();

      if (blobCache.has(t.file)) {
        const c = blobCache.get(t.file);
        audio.src = c.url;
        if (!t.peaks && c.blob) computePeaks(t, c.blob);
        if (autoplay) audio.play().catch(() => {});
        return;
      }

      showLoading(true);
      setBufUI(0);
      drawWave();

      // 让加载态先渲染（用宏任务，后台页面 rAF 不回调，不能用 rAF 等）
      await new Promise((r) => setTimeout(r, 16));

      try {
        const entry = await ensureAudio(t);
        if (idx !== i) return;
        audio.src = entry.url;
        showLoading(false);
        // 没有预生成波形的（新加的歌）就地解码补上
        if (!t.peaks) computePeaks(t, entry.blob);
        if (autoplay) {
          audio.play().catch(() => {
            // 被自动播放策略拦截时给出可见反馈，不要静默失败
            syncPlaybackUI();
            if (el.hint) el.hint.textContent = '浏览器拦截了自动播放，再点一次播放按钮即可';
          });
        }
      } catch (e) {
        showLoading(false);
        if (e.name === 'AbortError') return;
        el.title.textContent = '加载失败：' + t.file;
      }
    }

    function playPause() {
      if (idx < 0) { start(0, true); return; }
      if (audio.paused) {
        if (!audio.src) { start(idx, true); return; }
        audio.play().catch(() => {
          dock.classList.remove('playing');
          if (el.hint) el.hint.textContent = '播放被浏览器拦截，请再点一次';
        });
      } else {
        audio.pause();
      }
    }

    function next(step) {
      if (!tracks.length) return;
      if (inflight) { try { inflight.controller.abort(); } catch (e) {} inflight = null; }
      start(((idx < 0 ? 0 : idx) + step + tracks.length) % tracks.length, true);
    }

    /* ── 事件 ── */
    el.play.addEventListener('click', playPause);
    el.prev.addEventListener('click', () => {
      if (audio.currentTime > 3) audio.currentTime = 0;
      else next(-1);
    });
    el.next.addEventListener('click', () => next(1));

    listEl.addEventListener('click', (e) => {
      const li = e.target.closest('.track[data-i]');
      if (!li) return;
      const i = +li.dataset.i;
      // 点当前播放的曲目 = 暂停/继续
      if (i === idx) { playPause(); return; }
      if (inflight) { try { inflight.controller.abort(); } catch (err) {} inflight = null; }
      start(i, true);
    });

    audio.addEventListener('playing', () => {
      showLoading(false);
      startTick();
      if (el.hint) el.hint.textContent = '正在播放 · 点曲目可切换';
    });
    audio.addEventListener('pause', () => {
      stopTick();
      syncPlaybackUI();
      // 暂停后提示文案也要跟着变，否则会一直写着“正在播放”
      if (idx >= 0 && el.hint) el.hint.textContent = '已暂停 · 点曲目可继续';
    });
    audio.addEventListener('timeupdate', () => { syncTime(); drawWave(); syncPlaybackUI(); });
    audio.addEventListener('seeked', () => { syncTime(); drawWave(); syncPlaybackUI(); });
    audio.addEventListener('loadedmetadata', () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) {
        el.dur.textContent = fmtTime(d);
        // 把真实时长回写到数据里，并同步列表行——
        // 否则会出现「底部有条目时长、列表里却是 --:--」的不一致
        const t = tracks[idx];
        if (t && (!t.duration || Math.abs(t.duration - d) > 0.5)) {
          t.duration = Math.round(d * 100) / 100;
          updateRowDuration(idx);
          updateCountText();
        }
      }
      // 元数据就绪即可收起加载态
      showLoading(false);
      drawWave();
    });
    audio.addEventListener('ended', () => {
      stopTick();
      syncPlaybackUI();
      next(1);
    });
    audio.addEventListener('error', () => {
      if (idx < 0) return;
      stopTick();
      showLoading(false);
      if (el.hint) el.hint.textContent = '加载失败：' + (tracks[idx] ? tracks[idx].file : '');
    });

    // 进度拖动
    let dragging = false;
    function seek(ev) {
      const r = cv.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      if (total()) audio.currentTime = ratio * audio.duration;
      drawWave();
    }

    el.wave.addEventListener('mousedown', (e) => { dragging = true; seek(e); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (dragging) seek(e); });
    window.addEventListener('mouseup', () => { dragging = false; });
    el.wave.addEventListener('mousemove', (e) => {
      hoverX = e.clientX - cv.getBoundingClientRect().left;
      drawWave();
    });
    el.wave.addEventListener('mouseleave', () => { hoverX = -1; drawWave(); });
    el.wave.addEventListener('keydown', (e) => {
      if (!total()) return;
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
      if (e.key === ' ' || e.key === 'Enter') { playPause(); e.preventDefault(); }
    });

    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { sizeCanvas(); drawWave(); invalidateTrackWave(); syncTrackWave(); }, 140);
    });

    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('play', () => audio.play().catch(() => {}));
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => next(-1));
        navigator.mediaSession.setActionHandler('nexttrack', () => next(1));
      } catch (e) {}
    }

    /* ── 启动：曲目数据来自 music-data.js（script 标签），不依赖 fetch ── */
    (function boot() {
      tracks = Array.isArray(window.__MUSIC__) ? window.__MUSIC__ : [];
      if (!tracks.length) {
        if (el.hint) {
          el.hint.textContent = window.__MUSIC__
            ? '歌单为空，请在 music-data.js 里添加曲目'
            : '未找到 music-data.js，请确认它和 index.html 在同一目录';
        }
        return;
      }
      renderList();
      if (el.count) {
        const tot = tracks.reduce((s, t) => s + (t.duration || 0), 0);
        el.count.textContent = tracks.length + ' 首 · 共 ' + Math.floor(tot / 60) + ' 分钟';
      }
      peaks = tracks[0].peaks || [];
      el.dur.textContent = fmtTime(tracks[0].duration);
      sizeCanvas();
      drawWave();
    })();

    sizeCanvas();
  }

  /* ── 追番 / 追剧（两个独立区块）────────────────────── */
  function initFavorites() {
    const data = window.__BANGUMI__;
    const items = data && Array.isArray(data.items) ? data.items : [];

    // 一组 = { 列表容器, 数量文案, 提示文案, 过滤条件 }
    const groups = [
      {
        list: document.getElementById('favAnimeList'),
        count: document.getElementById('favAnimeCount'),
        hint: document.getElementById('favAnimeHint'),
        match: (x) => x.group === '番剧',
        label: '部番剧'
      },
      {
        list: document.getElementById('favMovieList'),
        count: document.getElementById('favMovieCount'),
        hint: document.getElementById('favMovieHint'),
        match: (x) => x.group !== '番剧',
        label: '部影视'
      }
    ];

    const kindTag = (x) => '<span class="fav-tag">' + esc(x.kind || x.group || '') + '</span>';
    const badgeTag = (x) => (x.badge ? '<span class="fav-tag gold">' + esc(x.badge) + '</span>' : '');
    const scoreTag = (x) => (x.score != null
      ? '<span class="fav-tag score">★ ' + esc(x.score) + '</span>' : '');

    const itemHTML = (x, key) => {
      const meta = [];
      if (x.status) meta.push('<span>' + esc(x.status) + '</span>');
      if (x.ep) meta.push('<span>' + esc(x.ep) + '</span>');

      return '<li class="fav" data-key="' + key + '">' +
        '<button class="fav-top" type="button" aria-expanded="false">' +
          '<span class="fav-name">' + esc(x.title) + '</span>' +
          '<span class="chev" aria-hidden="true">' + ICON.chev + '</span>' +
        '</button>' +
        '<div class="fav-panel"><div class="inner">' +
          '<div class="fav-body">' +
            (x.cover
              ? '<img class="fav-cover" src="' + esc(x.cover) + '" alt="' + esc(x.title) + '" ' +
                'loading="lazy" referrerpolicy="no-referrer">'
              : '') +
            '<div class="fav-info">' +
              '<div class="fav-tags">' + kindTag(x) + scoreTag(x) + badgeTag(x) + '</div>' +
              (meta.length ? '<div class="fav-meta">' + meta.join('') + '</div>' : '') +
              (x.summary ? '<p class="fav-sum">' + esc(x.summary) + '</p>' : '') +
              (x.url
                ? '<a class="fav-link" href="' + esc(x.url) + '" target="_blank" rel="noopener">' +
                  '在 B 站打开 ↗</a>'
                : '') +
            '</div>' +
          '</div>' +
        '</div></div>' +
      '</li>';
    };

    let totalShown = 0;

    for (const g of groups) {
      if (!g.list) continue;
      const list = items.filter(g.match);

      if (!list.length) {
        if (g.hint) {
          g.hint.textContent = data
            ? '还没有记录'
            : '未找到 bangumi-data.js，请运行 update-bangumi.mjs 生成';
        }
        if (g.count) g.count.textContent = '';
        continue;
      }

      totalShown += list.length;
      g.list.innerHTML = list.map((x, i) => itemHTML(x, g.list.id + '-' + i)).join('');

      if (g.count) g.count.textContent = list.length + ' ' + g.label;

      if (g.hint) {
        g.hint.textContent = data.updated
          ? '数据更新于 ' + new Date(data.updated).toLocaleDateString('zh-CN') +
            ' · 点右侧折叠符号查看封面与简介'
          : '点右侧折叠符号查看封面与简介';
      }

      // 折叠交互（每个列表各自绑定）
      g.list.addEventListener('click', (e) => {
        const top = e.target.closest('.fav-top');
        if (!top) return;
        const li = top.closest('.fav');
        if (!li) return;
        const open = li.classList.toggle('open');
        top.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    // 两个区块都没有数据时才提示缺失
    if (!items.length) {
      for (const g of groups) {
        if (g.hint && !/未找到|还没有/.test(g.hint.textContent)) {
          g.hint.textContent = '未找到 bangumi-data.js，请运行 update-bangumi.mjs 生成';
        }
      }
    }
  }

  /* ── 滚动显现：滚入时由下往上移入并变清晰，往上滚出时反向变模糊 ── */
  function initReveal() {
    const els = Array.from(document.querySelectorAll('[data-reveal]'));
    if (!els.length) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('rv-in'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const el = en.target;

        if (en.isIntersecting) {
          el.classList.remove('rv-out-up');
          el.classList.add('rv-in');
          el.dataset.rvSeen = '1';
          scheduleSettle(el);
        } else {
          const r = el.getBoundingClientRect();
          const above = r.bottom <= 0;      // 整体跑到视口上方 = 往上滚出

          if (above) {
            // 往上滚出：反向退场（往上移出 + 变模糊）
            el.classList.remove('rv-settled');
            el.classList.remove('rv-in');
            el.classList.add('rv-out-up');
          } else {
            // 向下滚出视口底部：清掉退场标记，等下次进入时正常淡入
            el.classList.remove('rv-out-up');
            el.classList.remove('rv-settled');
            el.classList.remove('rv-in');
          }
        }
      }
    }, {
      rootMargin: '-6% 0px -6% 0px',
      threshold: [0, 0.08, 0.5, 1]
    });

    // 入场动画播完就撤掉 filter / will-change，让元素回到普通图层，
    // 否则整页滚动时浏览器要一直维护这些合成层，越往后越卡
    const settleTimers = new WeakMap();
    function scheduleSettle(el) {
      clearTimeout(settleTimers.get(el));
      settleTimers.set(el, setTimeout(() => {
        if (el.classList.contains('rv-in')) el.classList.add('rv-settled');
      }, 700));
    }

    els.forEach((el) => {
      el.classList.add('rv');
      io.observe(el);
    });

    // 兜底：万一切换标签页/恢复滚动后观察器没触发，把已经滚进视口的补上
    const safety = () => {
      const vh = window.innerHeight;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.94 && r.bottom > 0 && !el.classList.contains('rv-in')) {
          el.classList.add('rv-in');
          el.classList.remove('rv-out-up');
          scheduleSettle(el);
        }
      }
    };
    window.addEventListener('load', safety);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) safety(); });
  }

  /* ── 启动 ────────────────────────────────────────────── */
  async function boot() {
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    document.body.classList.add('loading');
    loadProgress(12);

    // 并行初始化所有模块（点阵、头像、弹窗、控制、播放器、追番、显现）
    initDots();
    hookAvatar();
    setupModal('emailBtn', 'emailModal');
    setupModal('biliBtn', 'biliModal');
    setupCopyEmail();
    setupControls();
    initPlayer();          // 只初始化 UI，不预加载音乐
    initFavorites();
    initReveal();

    // 兜底：不管发生什么，加载动画都不会一直卡住
    const failsafe = setTimeout(() => hideLoader(), LOADER_MAX);

    // 并行加载所有数据（仓库、用户信息），不阻塞 loader 消失
    const reposPromise = loadRepos(false);
    const userPromise = getUser()
      .then((u) => { state.user = u; renderStats(); applyAvatar(u); })
      .catch(() => {});

    // loader 只等最短时间，内容加载在后台继续
    const avatarReady = waitAvatar(1500);
    await Promise.all([userPromise, avatarReady]);
    loadProgress(92);
    clearTimeout(failsafe);
    hideLoader();

    // 仓库列表在后台加载完成后更新（不阻塞用户看页面）
    await reposPromise;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
