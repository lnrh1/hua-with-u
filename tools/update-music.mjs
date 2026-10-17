/* 全自动生成歌单数据
 *
 * 用法：node tools/update-music.mjs
 *
 * 你只要把 mp3 丢进仓库根目录，跑一次（或让 CI 自动跑）即可：
 *   - 歌名/艺人自动从 ID3 读取，读不到就用文件名
 *   - 时长与波形用无头浏览器解码生成
 *   - 已生成过的不会重复解码（按文件大小+mtime 判断），CI 上能显著提速
 *
 * 想手动指定显示名，可选地建一个 music-meta.json：
 *   { "某文件.mp3": { "artist": "艺人", "title": "标题", "cn": "中文名" } }
 */
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowser } from './browser.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'music-data.js');
const META_FILE = join(ROOT, 'music-meta.json');
const CACHE_FILE = join(ROOT, '.music-cache.json');
const BINS = 140;

/* ── 可选的人工元数据覆盖 ── */
let META = {};
if (existsSync(META_FILE)) {
  try { META = JSON.parse(readFileSync(META_FILE, 'utf8')); }
  catch (e) { console.warn('music-meta.json 解析失败，已忽略：' + e.message); }
}

/* ── 读 ID3（标题/艺人）── */
function readId3(path) {
  const buf = readFileSync(path);
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return {};
  const ver = buf[3];
  const flags = buf[5];
  const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
  let off = 10;
  if (flags & 0x40) {
    off += 4 + ((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]);
  }
  const want = { TIT2: 'title', TPE1: 'artist' };
  const out = {};
  const end = Math.min(buf.length, 10 + size);
  while (off + 10 <= end) {
    const id = buf.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsz = ver === 4
      ? (buf[off + 4] << 21) | (buf[off + 5] << 14) | (buf[off + 6] << 7) | buf[off + 7]
      : buf.readUInt32BE(off + 4);
    if (fsz <= 0 || off + 10 + fsz > end) break;
    if (want[id]) {
      const raw = buf.subarray(off + 10, off + 10 + fsz);
      const enc = raw[0];
      let s = '';
      try {
        if (enc === 1) s = raw.subarray(1).toString('utf16le');
        else if (enc === 3) s = raw.subarray(1).toString('utf8');
        else s = raw.subarray(1).toString('latin1');
      } catch { /* ignore */ }
      // 去掉 BOM 与空字符
      s = s.replace(/^\ufeff/, '').replace(/\0/g, '').trim();
      if (s) out[want[id]] = s;
    }
    off += 10 + fsz;
  }
  return out;
}

/* ── 扫描 mp3 ── */
const files = readdirSync(ROOT)
  .filter((f) => /\.mp3$/i.test(f))
  .sort((a, b) => a.localeCompare(b, 'zh'));

if (!files.length) {
  console.error('仓库里没有找到 .mp3 文件');
  process.exit(1);
}
console.log(`发现 ${files.length} 个 mp3`);

/* ── 增量缓存：文件没变就不重新解码 ── */
let cache = {};
if (existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { /* ignore */ }
}

const tracks = [];
const needDecode = [];

for (const file of files) {
  const full = join(ROOT, file);
  const st = statSync(full);
  const stamp = st.size + ':' + Math.round(st.mtimeMs);
  const hit = cache[file] && cache[file].stamp === stamp ? cache[file] : null;

  // 名称每次都重新决定（META 可为任意文件新增覆盖），缓存只复用解码结果
  const tag = readId3(full);
  const baseName = file.replace(/\.mp3$/i, '');
  const over = META[file] || {};
  const naming = {
    artist: over.artist || tag.artist || '未知艺人',
    title: over.title || tag.title || baseName,
    cn: over.cn || ''
  };

  if (hit) {
    tracks.push({ file, ...naming, duration: hit.duration, peaks: hit.peaks, _stamp: stamp });
  } else {
    needDecode.push({ file, full, stamp, naming });
  }
}

/* ── 用浏览器解码补齐 ── */
if (needDecode.length) {
  console.log(`需要解码：${needDecode.length} 个（其余命中缓存）`);
  // 起一个本地静态服务，浏览器才能 fetch 音频
  const { createServer } = await import('node:http');
  const { extname } = await import('node:path');
  const TYPES = { '.mp3': 'audio/mpeg', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };

  const server = createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const target = join(ROOT, p === '/' ? 'index.html' : p);
    try {
      const body = readFileSync(target);
      res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;

  try {
    await withBrowser(base + 'index.html', async (cdp) => {
      for (const item of needDecode) {
        const r = await cdp.eval(`(async () => {
          const url = ${JSON.stringify(encodeURIComponent(item.file))};
          const resp = await fetch(url);
          if (!resp.ok) return { ok: false, err: 'HTTP ' + resp.status };
          const buf = await resp.arrayBuffer();
          const AC = window.AudioContext || window.webkitAudioContext;
          const ctx = new AC();
          const audio = await ctx.decodeAudioData(buf);
          const ch = audio.getChannelData(0);
          const N = ${BINS};
          const block = Math.floor(ch.length / N) || 1;
          const rms = [];
          for (let i = 0; i < N; i++) {
            const s = i * block, e = Math.min(s + block, ch.length);
            const step = Math.max(1, Math.floor((e - s) / 4000));
            let sum = 0, cnt = 0;
            for (let j = s; j < e; j += step) { const v = ch[j]; sum += v * v; cnt++; }
            rms.push(Math.sqrt(sum / Math.max(1, cnt)));
          }
          const mx = Math.max.apply(null, rms) || 1;
          const peaks = rms.map(v => Math.round(v / mx * 1000) / 1000);
          const dur = Math.round(audio.duration * 100) / 100;
          if (ctx.close) ctx.close();
          return { ok: true, duration: dur, peaks };
        })()`);

        if (!r.ok) { console.warn(`  跳过 ${item.file}：${r.err}`); continue; }

        const track = {
          file: item.file,
          ...item.naming,
          duration: r.duration,
          peaks: r.peaks,
          _stamp: item.stamp
        };
        tracks.push(track);
        console.log(`  ${track.artist} · ${track.title}  ${r.duration}s  ${r.peaks.length} 点`);
      }
    });
  } finally {
    server.close();
  }
}

/* ── 按文件名排序，保持稳定 ── */
tracks.sort((a, b) => a.file.localeCompare(b.file, 'zh'));

/* ── 写缓存（不含 _stamp，避免污染数据文件）── */
const nextCache = {};
for (const t of tracks) {
  // 只缓存解码结果；名称不进缓存，保证改 music-meta.json 立即生效
  nextCache[t.file] = { stamp: t._stamp, duration: t.duration, peaks: t.peaks };
}
writeFileSync(CACHE_FILE, JSON.stringify(nextCache, null, 0), 'utf8');

const clean = tracks.map(({ _stamp, ...rest }) => rest);
writeFileSync(OUT, `/* 歌单数据 —— 由 tools/update-music.mjs 自动生成，请勿手改
 * 把 mp3 放进仓库根目录后重新运行该脚本即可
 * 生成时间：${new Date().toISOString()}
 */
window.__MUSIC__ = ` + JSON.stringify(clean, null, 1) + `;
`, 'utf8');

const total = clean.reduce((s, t) => s + (t.duration || 0), 0);
console.log(`\n完成：${clean.length} 首，合计 ${Math.floor(total / 60)} 分 ${Math.round(total % 60)} 秒`);
console.log(`写出 ${OUT}`);
