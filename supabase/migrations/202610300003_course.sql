-- A single planned course per enrolled device. Never expose raw table access.
create table public.courses (
 device_id uuid primary key references public.devices(id) on delete cascade,
 course jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.courses enable row level security;
revoke all on public.courses from public,anon,authenticated;
grant all on public.courses to service_role;
create function public.read_course(credential_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; course_data jsonb;
begin
 -- Reuse viewer authentication, expiry/revocation and the rate limiter.
 result:=public.tracker_request('get-track',credential_hash,'{}'::jsonb);
 if result ? '_status' then return result; end if;
 select c.course into course_data from public.courses c join public.devices d on d.id=c.device_id where d.view_token_hash=credential_hash;
 return jsonb_build_object('course',course_data);
end $$;
revoke all on function public.read_course(text) from public,anon,authenticated;
grant execute on function public.read_course(text) to service_role;
