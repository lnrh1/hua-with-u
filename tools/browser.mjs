/* 无头浏览器驱动：用于在 Node 侧解码音频算波形
 *
 * 为什么要浏览器：mp3 解码在 Node 里没有内置能力，CI 上也不一定有 ffmpeg，
 * 但 GitHub Actions 的 ubuntu runner 自带 Chrome，用它 decodeAudioData 最省事，
 * 且不需要任何 npm 依赖。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  // Linux / CI
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // Windows
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

export function findBrowser() {
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  throw new Error('找不到 Chrome/Chromium。请设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端 */
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }

  send(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }
}

/**
 * 启动无头浏览器并返回 { page, close }
 * @param {string} url 要打开的页面
 */
export async function withBrowser(url, fn) {
  const bin = findBrowser();
  const port = 9200 + Math.floor(Math.random() * 300);
  const profile = mkdtempSync(join(tmpdir(), 'dsh-chrome-'));

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    'about:blank'
  ];

  const proc = spawn(bin, args, { stdio: 'ignore', detached: false });

  let ws, cdp;
  try {
    // 等调试端口就绪
    let target = null;
    for (let i = 0; i < 100 && !target; i++) {
      await sleep(200);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
        if (r.ok) target = await r.json();
      } catch { /* 还没起来 */ }
    }
    if (!target) throw new Error('浏览器启动超时（调试端口未就绪）');

    ws = await new Promise((resolve, reject) => {
      const s = new WebSocket(target.webSocketDebuggerUrl);
      s.addEventListener('open', () => resolve(s));
      s.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    });

    cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 等页面真正加载
    for (let i = 0; i < 100; i++) {
      const ready = await cdp.eval('document.readyState === "complete"').catch(() => false);
      if (ready) break;
      await sleep(150);
    }

    return await fn(cdp);
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    await sleep(150);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
