import fs from 'node:fs';
import { FLOW_ORIGIN, FLOW_PAGES, TOKEN_PATTERN } from './redirect-handler.mjs';

const TRACKING_BASE = 'https://lxxzvbggxoroxayiupfj.supabase.co/functions/v1/ls-flow';
const FLOW_URL = /https:\/\/line-stock-flow\.hitomi-k\.workers\.dev\/[^\s<>"'）)]+/gu;
let savedConfig;

export function prepareCompanyTracking(body, companyId, suppliedConfig) {
  if (typeof body !== 'string') throw new Error('送付本文がありません');
  const matches = [...body.matchAll(FLOW_URL)];
  if (!matches.length) return { body, urls: [] };
  const config = suppliedConfig || (savedConfig ||= JSON.parse(fs.readFileSync(new URL('./会社別リンク.json', import.meta.url), 'utf8')));
  if (config.base_url !== TRACKING_BASE) throw new Error('会社別追跡の接続先が不正です');
  const entry = config.links?.[companyId];
  if (!entry || !TOKEN_PATTERN.test(entry.token || '')) throw new Error(`会社別追跡リンクが未登録：${companyId}（追跡/README.mdの手順で登録する）`);
  const urls = [];
  const replaced = body.replace(FLOW_URL, original => {
    const source = new URL(original);
    const page = source.pathname.replace(/^\/+|\/+$/g, '');
    if (source.origin !== FLOW_ORIGIN || !FLOW_PAGES.has(page) || entry.page !== page) throw new Error(`会社別追跡の業種と本文が一致しません：${companyId}`);
    const tracked = `${TRACKING_BASE}/${entry.token}`;
    urls.push({ original, tracked });
    return tracked;
  });
  return { body: replaced, urls };
}
