/* 自动抓取 B 站追番 / 追剧，生成 bangumi-data.js
 *
 * 用法：node tools/update-bangumi.mjs [mid]
 *
 * 为什么用脚本而不是页面里 fetch：
 *   api.bilibili.com 不返回 Access-Control-Allow-Origin，
 *   浏览器跨域一定被拦；Node 不是浏览器，不受 CORS 约束。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MID = process.argv[2] || process.env.BILI_MID || '3546386161207782';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const OUT = fileURLToPath(new URL('../bangumi-data.js', import.meta.url));

const STATUS = { 1: '想看', 2: '在看', 3: '看过' };

async function fetchList(type) {
  const url = 'https://api.bilibili.com/x/space/bangumi/follow/list' +
    `?type=${type}&follow_status=0&pn=1&ps=30&vmid=${MID}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      // 这个 Referer 是过风控的关键，缺了会返回 -352
      'Referer': `https://space.bilibili.com/${MID}/`,
      'Accept': 'application/json, text/plain, */*'
    }
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`type=${type} 返回非 JSON（可能被风控拦截）：${text.slice(0, 120)}`);
  }
  if (json.code !== 0) throw new Error(`type=${type} 接口报错 code=${json.code} ${json.message}`);
  return json.data.list || [];
}

function normalize(it) {
  const isBangumi = it.season_type === 1;
  return {
    title: it.title || '',
    group: isBangumi ? '番剧' : '影视',
    kind: it.season_type_name || (isBangumi ? '番剧' : '影视'),
    cover: (it.cover || '').replace(/^http:/, 'https:'),
    url: it.url || `https://www.bilibili.com/bangumi/play/ss${it.season_id}`,
    status: STATUS[it.follow_status] || '在看',
    ep: it.new_ep && it.new_ep.index_show ? String(it.new_ep.index_show) : '',
    score: it.rating && it.rating.score ? it.rating.score : null,
    badge: it.badge || '',
    summary: (it.evaluate || it.summary || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  };
}

const all = [];
for (const type of [1, 2]) {
  const list = await fetchList(type);
  all.push(...list.map(normalize));
  console.log(`type=${type} 取到 ${list.length} 条`);
  await new Promise((r) => setTimeout(r, 1200));   // 别打太快
}

if (!all.length) {
  console.error('没取到任何记录');
  process.exit(1);
}

const data = { mid: MID, updated: new Date().toISOString(), items: all };

writeFileSync(OUT, `/* 追番 · 追剧数据 —— 由 tools/update-bangumi.mjs 自动生成，请勿手改
 * 生成时间：${data.updated}
 * 共 ${all.length} 条（番剧 ${all.filter((x) => x.group === '番剧').length}，
 *   影视 ${all.filter((x) => x.group === '影视').length}）
 */
window.__BANGUMI__ = ` + JSON.stringify(data, null, 1) + `;
`, 'utf8');

console.log(`\n完成：${all.length} 条`);
for (const x of all) {
  console.log(`  [${x.group}/${x.kind}] ${x.title}  ${x.ep || '-'}  ${x.score ?? '-'}分`);
}
