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
