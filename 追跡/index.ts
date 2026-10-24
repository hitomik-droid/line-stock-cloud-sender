import { handleTrackingRequest, visitorFingerprint } from './redirect-handler.mjs';

const base = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0];
if (!base || typeof key !== 'string' || !key) throw new Error('Server credentials are not configured');
const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

async function rest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Tracking storage returned ${response.status}`);
  return response;
}

Deno.serve((req: Request) => handleTrackingRequest(req, {
  async findLink(token: string) {
    const query = new URLSearchParams({ token: `eq.${token}`, select: 'company_id,page', limit: '1' });
    const response = await rest(`line_stock_tracking_links?${query}`);
    return (await response.json())[0] || null;
  },
  async recordClick(event: { company_id: string; visitor_key: string }) {
    await rest('line_stock_tracking_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(event) });
  },
  fingerprint: (request: Request, companyId: string) => visitorFingerprint(key, request, companyId),
  onError: (stage: string) => console.error(`Company tracking ${stage} failed`),
}));
