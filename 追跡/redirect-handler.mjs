export const FLOW_ORIGIN = 'https://line-stock-flow.hitomi-k.workers.dev';
export const FLOW_PAGES = new Set(['driving-school', 'personal-gym', 'beauty-clinic', 'online-school', 'solar-housing']);
export const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const AUTOMATION_UA = /bot|spider|crawler|preview|curl|wget|python|node|undici|headless|slack|discord|facebookexternalhit|telegram|whatsapp|safelinks|proofpoint|barracuda|mimecast/i;

// IP・User-Agentそのものは保存せず、会社と日本時間の日付ごとに変わるHMACだけを記録する。
export async function visitorFingerprint(secret, req, companyId, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify([companyId, day, ip, req.headers.get('user-agent') || ''])));
  return [...new Uint8Array(signature)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function handleTrackingRequest(req, { findLink, recordClick, fingerprint, onError = () => {} }) {
  const headers = { 'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Type': 'text/plain; charset=utf-8' };
  if (!['GET', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const at = parts.lastIndexOf('ls-flow');
  const token = parts[at + 1];
  if (at < 0 || parts.length !== at + 2 || !TOKEN_PATTERN.test(token || '')) return new Response('Not found', { status: 404, headers });
  let link;
  try { link = await findLink(token); }
  catch (error) { onError('lookup', error); return new Response('Temporarily unavailable', { status: 503, headers }); }
  // ランダムな識別子の一致を確認してから記録する。転送先は既存の5ページだけ。
  if (!link || !FLOW_PAGES.has(link.page)) return new Response('Not found', { status: 404, headers });
  const ua = req.headers.get('user-agent') || '';
  const purpose = [req.headers.get('purpose'), req.headers.get('sec-purpose'), req.headers.get('x-purpose')].filter(Boolean).join(' ');
  if (req.method === 'GET' && ua && !AUTOMATION_UA.test(ua) && !/prefetch|preview/i.test(purpose)) {
    try { await recordClick({ company_id: link.company_id, visitor_key: await fingerprint(req, link.company_id) }); }
    catch (error) { onError('record', error); } // 記録の一時障害で、設計図を開くことまで妨げない。
  }
  return new Response(null, { status: 302, headers: { ...headers, Location: `${FLOW_ORIGIN}/${link.page}/` } });
}
