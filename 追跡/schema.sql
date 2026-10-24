create table public.line_stock_tracking_links (
  company_id text primary key,
  company_name text not null,
  industry text not null,
  page text not null check (page in ('driving-school','personal-gym','beauty-clinic','online-school','solar-housing')),
  token text not null unique default replace(gen_random_uuid()::text, '-', '') check (token ~ '^[a-f0-9]{32}$'),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.line_stock_tracking_events (
  id bigint generated always as identity primary key,
  company_id text not null references public.line_stock_tracking_links(company_id) on delete cascade,
  visitor_key text not null check (visitor_key ~ '^[a-f0-9]{64}$'),
  clicked_at timestamptz not null default now()
);
create index line_stock_tracking_events_company_time on public.line_stock_tracking_events(company_id, clicked_at desc);
alter table public.line_stock_tracking_links enable row level security;
alter table public.line_stock_tracking_events enable row level security;
revoke all on public.line_stock_tracking_links, public.line_stock_tracking_events from public, anon, authenticated;
revoke all on sequence public.line_stock_tracking_events_id_seq from public, anon, authenticated;
grant select on public.line_stock_tracking_links to service_role;
grant select, insert on public.line_stock_tracking_events to service_role;
grant usage on sequence public.line_stock_tracking_events_id_seq to service_role;

create view public.line_stock_company_clicks with (security_invoker = true) as
select l.company_id, l.company_name, l.industry, l.page,
       count(e.id)::bigint as views,
       count(distinct e.visitor_key)::bigint as daily_visitors,
       min(e.clicked_at) as first_clicked_at, max(e.clicked_at) as last_clicked_at
from public.line_stock_tracking_links l
left join public.line_stock_tracking_events e on e.company_id = l.company_id
where not l.is_test
group by l.company_id, l.company_name, l.industry, l.page;
revoke all on public.line_stock_company_clicks from public, anon, authenticated;
grant select on public.line_stock_company_clicks to service_role;
