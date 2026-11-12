import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTrackingRequest, visitorFingerprint } from './redirect-handler.mjs';
import { prepareCompanyTracking } from './会社別URL.mjs';

const token = '0123456789abcdef0123456789abcdef';
const base = 'https://lxxzvbggxoroxayiupfj.supabase.co/functions/v1/ls-flow';
const url = `${base}/${token}`;
const browser = 'Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36';
const config = { base_url: base, links: { 'LS-20261022-9999': { token, page: 'personal-gym' } } };
function setup(extra = {}) {
  const events = [];
  return { events, options: { findLink: async t => t === token ? { company_id: 'LS-20261022-9999', page: 'personal-gym' } : null, recordClick: async e => events.push(e), fingerprint: async () => 'a'.repeat(64), ...extra } };
}
test('有効な会社別リンクは記録して既存の設計図へ転送する', async () => {
  const { events, options } = setup();
  const response = await handleTrackingRequest(new Request(url, { headers: { 'User-Agent': browser } }), options);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://line-stock-flow.hitomi-k.workers.dev/personal-gym/');
  assert.equal(events.length, 1); assert.equal(events[0].company_id, 'LS-20261022-9999');
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('別の会社のリンクはその会社に紐づく', async () => {
  const { events, options } = setup({ findLink: async () => ({ company_id: 'LS-20261022-9998', page: 'online-school' }) });
  const response = await handleTrackingRequest(new Request(url, { headers: { 'User-Agent': browser } }), options);
  assert.equal(events[0].company_id, 'LS-20261022-9998');
  assert.match(response.headers.get('location'), /online-school\/$/);
});
test('HEAD・ボット・先読みは転送だけ行い人数に加えない', async () => {
  for (const init of [{ method: 'HEAD', headers: { 'User-Agent': browser } }, { headers: { 'User-Agent': 'Googlebot' } }, { headers: { 'User-Agent': browser, 'sec-purpose': 'prefetch' } }]) {
    const { events, options } = setup();
    assert.equal((await handleTrackingRequest(new Request(url, init), options)).status, 302);
    assert.equal(events.length, 0);
  }
});
test('不明な識別子・余分なパス・不正な転送先は記録しない', async () => {
  for (const target of [`${base}/bad`, `${base}/${'f'.repeat(32)}`, `${url}/extra`]) {
    const { events, options } = setup();
    assert.equal((await handleTrackingRequest(new Request(target), options)).status, 404);
    assert.equal(events.length, 0);
  }
  const { options } = setup({ findLink: async () => ({ company_id: 'x', page: 'https://example.com' }) });
  assert.equal((await handleTrackingRequest(new Request(url), options)).status, 404);
});
test('記録障害でも登録済みリンクの設計図への転送を続ける', async () => {
  const { options } = setup({ recordClick: async () => { throw new Error('unavailable'); } });
  assert.equal((await handleTrackingRequest(new Request(url, { headers: { 'User-Agent': browser } }), options)).status, 302);
});
test('日付・会社で識別用ハッシュが変わり、IPそのものは残らない', async () => {
  const req = new Request(url, { headers: { 'User-Agent': browser, 'x-forwarded-for': '192.0.2.1' } });
  const day = new Date('2026-10-24T10:00:00Z');
  const a = await visitorFingerprint('test-secret', req, 'a', day);
  assert.equal(a, await visitorFingerprint('test-secret', req, 'a', day));
  assert.notEqual(a, await visitorFingerprint('test-secret', req, 'b', day));
  assert.notEqual(a, await visitorFingerprint('test-secret', req, 'a', new Date('2026-10-25T10:00:00Z')));
  assert.match(a, /^[a-f0-9]{64}$/); assert.ok(!a.includes('192.0.2.1'));
});
test('営業本文では設計図URLだけが変わり、予約URL・文章は変わらない', () => {
  const body = 'ご担当者様\n設計図\nhttps://line-stock-flow.hitomi-k.workers.dev/personal-gym/\n面談\nhttps://calendar.app.google/example\n署名';
  const result = prepareCompanyTracking(body, 'LS-20261022-9999', config);
  assert.equal(result.body, body.replace('https://line-stock-flow.hitomi-k.workers.dev/personal-gym/', url));
  assert.equal(result.urls.length, 1);
});
test('リンク未登録や業種不一致では送付前に止まり、共通リンクで送らない', () => {
  const body = 'https://line-stock-flow.hitomi-k.workers.dev/personal-gym/';
  assert.throws(() => prepareCompanyTracking(body, 'missing', config), /未登録/);
  assert.throws(() => prepareCompanyTracking(body.replace('personal-gym', 'beauty-clinic'), 'LS-20261022-9999', config), /一致しません/);
  assert.equal(prepareCompanyTracking('設計図URLがない旧本文', 'missing', config).body, '設計図URLがない旧本文');
});


test('新しい4種類も本文と一致する時だけ追跡し正しい図へ転送する', async () => {
  for (const page of ['custom-home', 'solar', 'reform', 'exterior']) {
    const cfg = { base_url: base, links: { 'LS-20261022-9999': { token, page } } };
    const body = `https://line-stock-flow.hitomi-k.workers.dev/${page}/`;
    assert.equal(prepareCompanyTracking(body, 'LS-20261022-9999', cfg).body, url);
    assert.throws(() => prepareCompanyTracking(body.replace(page, 'personal-gym'), 'LS-20261022-9999', cfg), /一致しません/);
    const { options } = setup({ findLink: async () => ({ company_id: 'LS-20261022-9999', page }) });
    const response = await handleTrackingRequest(new Request(url, { method: 'HEAD' }), options);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `https://line-stock-flow.hitomi-k.workers.dev/${page}/`);
  }
});

// 追跡リンク登録.py（11/12 直し2）：Supabase を差し替えて、表だけ違う会社も直すこと・直せない時に終了コードが0にならないことを見る
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const fakeSupabase = String.raw`
import io, json, re, runpy, sys, urllib.parse, urllib.request
state_path, script = sys.argv[1], sys.argv[2]
state = json.load(open(state_path))
class R(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): pass
def urlopen(req, timeout=None):
    u = urllib.parse.urlsplit(req.full_url); q = urllib.parse.parse_qs(u.query)
    m = req.get_method(); state['calls'].append(m)
    rows = [r for r in state['rows'] if not ('is_test' in q and r['is_test'])]
    if 'company_id' in q:
        v = q['company_id'][0]
        ids = v[4:-1].split(',') if v.startswith('in.(') else [v[3:]]
        rows = [r for r in rows if r['company_id'] in ids]
    if m == 'PATCH':
        for r in rows: r.update(json.loads(req.data))
    if m == 'POST':
        rows = []
        for w in json.loads(req.data):
            if not any(r['company_id'] == w['company_id'] for r in state['rows']):
                r = {**w, 'token': 'f' * 32, 'is_test': False}; state['rows'].append(r); rows.append(r)
    return R(json.dumps([{k: r[k] for k in ('company_id', 'token', 'page')} for r in rows]).encode())
urllib.request.urlopen = urlopen
sys.argv = [script] + sys.argv[3:]
try:
    runpy.run_path(script, run_name='__main__')
finally:
    json.dump(state, open(state_path, 'w'))
`;
function runRegister({ links, rows, companies, env = true }) {
  const dir = mkdtempSync(join(tmpdir(), '追跡登録-'));
  const script = join(dir, '追跡リンク登録.py');
  copyFileSync(join(dirname(fileURLToPath(import.meta.url)), '追跡リンク登録.py'), script);
  writeFileSync(join(dir, '会社別リンク.json'), JSON.stringify({ base_url: base, links }));
  writeFileSync(join(dir, 'cs.json'), JSON.stringify([{ results: companies.map(([id, message_id, list_source = '名簿']) => ({ id, name: id, industry: '住宅', status: '確認中', list_source, message_id })) }]));
  writeFileSync(join(dir, 'ms.json'), JSON.stringify([{ results: [{ id: 'MSG-注文住宅-v9', body: '設計図 https://line-stock-flow.hitomi-k.workers.dev/custom-home/' }] }]));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ rows, calls: [] }));
  writeFileSync(join(dir, 'fake.py'), fakeSupabase);
  const r = spawnSync('python3', ['-I', join(dir, 'fake.py'), join(dir, 'state.json'), script, join(dir, 'cs.json'), join(dir, 'ms.json')], {
    encoding: 'utf8', env: env ? { ...process.env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' } : { PATH: process.env.PATH } });
  return { ...r, state: JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')), links: JSON.parse(readFileSync(join(dir, '会社別リンク.json'), 'utf8')).links };
}
test('JSONは本文どおりで表だけ違う会社も、表の page を本文に合わせる（token・テスト行は変えない）', () => {
  const r = runRegister({
    links: { A: { token, page: 'custom-home' } },
    rows: [{ company_id: 'A', token, page: 'solar-housing', is_test: false }, { company_id: 'A', token: 'e'.repeat(32), page: 'solar-housing', is_test: true }],
    companies: [['A', 'MSG-注文住宅-v9']],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.state.calls.includes('PATCH'));
  assert.equal(r.state.rows[0].page, 'custom-home');
  assert.equal(r.state.rows[1].page, 'solar-housing');
  assert.deepEqual(r.links.A, { token, page: 'custom-home' });
});
test('JSONも表も本文どおりなら何も書かない', () => {
  const r = runRegister({ links: { A: { token, page: 'custom-home' } }, rows: [{ company_id: 'A', token, page: 'custom-home', is_test: false }], companies: [['A', 'MSG-注文住宅-v9']] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.state.calls, ['GET']);
});
test('PATCHが表の行に当たらない・読み直しで返らない時はエラーで終了コード1', () => {
  const r = runRegister({
    links: { A: { token, page: 'solar-housing' } },
    rows: [{ company_id: 'A', token, page: 'solar-housing', is_test: true }],
    companies: [['A', 'MSG-注文住宅-v9']],
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /A：PATCH が表の行に1件も当たらなかった/);
  assert.deepEqual(r.links.A, { token, page: 'solar-housing' });
});
test('新しく発行した会社が読み直しで表の非テスト行として返らない時もエラーで終了コード1', () => {
  const r = runRegister({ links: {}, rows: [{ company_id: 'B', token, page: 'custom-home', is_test: true }], companies: [['B', 'MSG-注文住宅-v9', 'Meta広告']] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /B：読み直しで表の非テスト行が返らなかった/);
  assert.equal(r.links.B, undefined);
});
test('Secrets が無い時は表を読まずに待ちを出すだけで終了コード0', () => {
  const r = runRegister({ links: { A: { token, page: 'solar-housing' } }, rows: [], companies: [['A', 'MSG-注文住宅-v9']], env: false });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.state.calls, []);
  assert.match(r.stdout, /page直しの待ち：1社/);
});
