create extension if not exists pgcrypto;
create table public.devices (
 id uuid primary key default gen_random_uuid(), device_secret_hash text not null unique,
 view_token_hash text not null unique, created_at timestamptz not null default now(),
 revoked_at timestamptz, view_expires_at timestamptz not null default now()+interval '30 days'
);
create table public.tracking_sessions (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references public.devices(id),
 status text not null check(status in ('active','stopped','expired')), started_at timestamptz not null default now(),
 ended_at timestamptz, expires_at timestamptz not null default now()+interval '12 hours', mode_expires_at timestamptz
);
create unique index one_active_session on public.tracking_sessions(device_id) where status='active';
create index device_sessions on public.tracking_sessions(device_id,started_at desc);
create table public.location_points (
 id uuid primary key, session_id uuid not null references public.tracking_sessions(id) on delete cascade,
 seq integer not null check(seq>=0), latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 horizontal_accuracy_m double precision not null check(horizontal_accuracy_m between 0 and 100),
 recorded_at timestamptz not null, received_at timestamptz not null default clock_timestamp(),
 arrival bigint generated always as identity unique, unique(session_id,seq)
);
create index route_order on public.location_points(session_id,recorded_at,seq);
create index route_arrival on public.location_points(session_id,arrival);
create table public.waiting_points (
 device_id uuid primary key references public.devices(id), latitude double precision, longitude double precision,
 updated_at timestamptz not null default now(),
 check ((latitude is null and longitude is null) or (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
);
create table public.request_limits (device_id uuid references public.devices(id), role_name text,
 bucket timestamptz not null, count integer not null, primary key(device_id,role_name));
alter table public.devices enable row level security;
alter table public.tracking_sessions enable row level security;
alter table public.location_points enable row level security;
alter table public.waiting_points enable row level security;
alter table public.request_limits enable row level security;
revoke all on public.devices,public.tracking_sessions,public.location_points,public.waiting_points,public.request_limits from public,anon,authenticated;

grant all on public.devices,public.tracking_sessions,public.location_points,public.waiting_points,public.request_limits to service_role;
grant usage,select on sequence public.location_points_arrival_seq to service_role;

-- Service-role-only transactional boundary. Device row lock serializes start/stop/ingest and rate updates.
create function public.tracker_request(action text, credential_hash text, body jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d devices; s tracking_sessions; w jsonb; wp_time timestamptz; p jsonb; old location_points;
 n integer:=0; ids jsonb:='[]'; route jsonb; latest jsonb; cursor_value bigint; max_cursor bigint;
 viewer boolean:=action in ('get-track','set-waiting-point'); lim integer; t timestamptz:=clock_timestamp();
 lat double precision; lon double precision; acc double precision; measured timestamptz; pid uuid; sq integer;
begin
 if action not in ('start-session','ingest-location','stop-session','get-track','set-waiting-point') then raise sqlstate 'PT404' using message='Unknown endpoint'; end if;
 if viewer then select * into d from devices where view_token_hash=credential_hash for update;
 else select * into d from devices where device_secret_hash=credential_hash for update; end if;
 if d.id is null then raise sqlstate 'PT401' using message='Invalid credential'; end if;
 if d.revoked_at is not null or (viewer and d.view_expires_at<=t) then raise sqlstate 'PT403' using message='Access expired or revoked'; end if;
 insert into request_limits values(d.id,case when viewer then 'viewer' else 'device' end,date_trunc('minute',t),1)
 on conflict(device_id,role_name) do update set count=case when request_limits.bucket=excluded.bucket then request_limits.count+1 else 1 end,bucket=excluded.bucket returning count into lim;
 if lim>120 then return jsonb_build_object('_status',429,'error','Rate limited'); end if;
 -- Preserve the rate counter even when validation rolls back the action below.
 begin
 update tracking_sessions set status='expired',ended_at=t where device_id=d.id and status='active' and expires_at<=t;
 select * into s from tracking_sessions where device_id=d.id order by started_at desc limit 1;
 if action='start-session' and (s.id is null or s.status<>'active') then
  insert into tracking_sessions(device_id,status) values(d.id,'active') returning * into s;
 end if;
 select case when latitude is null then null else jsonb_build_object('latitude',latitude,'longitude',longitude,'updated_at',updated_at) end, updated_at into w,wp_time from waiting_points where device_id=d.id;
 if action='set-waiting-point' then
  if body->>'clear'='true' then lat:=null; lon:=null;
  else
   if jsonb_typeof(body->'latitude')<>'number' or jsonb_typeof(body->'longitude')<>'number' or not(body ? 'latitude' and body ? 'longitude') then raise sqlstate 'PT400' using message='Coordinates required'; end if;
   lat:=(body->>'latitude')::double precision; lon:=(body->>'longitude')::double precision;
   if not(lat between -90 and 90 and lon between -180 and 180) then raise sqlstate 'PT400' using message='Invalid coordinates'; end if;
  end if;
  insert into waiting_points values(d.id,lat,lon,t) on conflict(device_id) do update set latitude=excluded.latitude,longitude=excluded.longitude,updated_at=t;
  return jsonb_build_object('waiting_point',case when lat is null then null else jsonb_build_object('latitude',lat,'longitude',lon,'updated_at',t) end,'waiting_point_updated_at',t,'server_time',t);
 end if;
 if action='start-session' then return jsonb_build_object('session_id',s.id,'waiting_point',w,'waiting_point_updated_at',wp_time,'server_time',t); end if;
 if action in ('ingest-location','stop-session') then
  select * into s from tracking_sessions where id=(body->>'session_id')::uuid and device_id=d.id for update;
  if s.id is null then raise sqlstate 'PT404' using message='Session not found'; end if;
  if action='stop-session' then
   update tracking_sessions set status='stopped',ended_at=coalesce(ended_at,t) where id=s.id;
   return jsonb_build_object('status','stopped','server_time',t);
  end if;
  if s.status<>'active' or s.expires_at<=t then raise sqlstate 'PT409' using message='Session is not active'; end if;
  if jsonb_typeof(body->'points') is distinct from 'array' then raise sqlstate 'PT400' using message='Points array required'; end if;
  if jsonb_array_length(body->'points') not between 1 and 100 then raise sqlstate 'PT400' using message='Batch must contain 1 to 100 points'; end if;
  for p in select value from jsonb_array_elements(body->'points') loop
   if not(p ?& array['id','seq','latitude','longitude','horizontal_accuracy_m','recorded_at']) or
    jsonb_typeof(p->'latitude')<>'number' or jsonb_typeof(p->'longitude')<>'number' or jsonb_typeof(p->'horizontal_accuracy_m')<>'number' or jsonb_typeof(p->'seq')<>'number' then raise sqlstate 'PT400' using message='Invalid point'; end if;
   pid:=(p->>'id')::uuid; sq:=(p->>'seq')::integer; lat:=(p->>'latitude')::double precision; lon:=(p->>'longitude')::double precision; acc:=(p->>'horizontal_accuracy_m')::double precision; measured:=(p->>'recorded_at')::timestamptz;
   if pid is null or sq is null or measured is null or (p->>'seq')::numeric<>sq or sq<0 or not(lat between -90 and 90 and lon between -180 and 180 and acc between 0 and 100) or measured<t-interval '7 days' or measured>t+interval '2 minutes' or measured<s.started_at-interval '2 minutes' then raise sqlstate 'PT400' using message='Point out of bounds'; end if;
   select * into old from location_points where id=pid or (session_id=s.id and seq=sq) limit 1;
   if old.id is not null then
    if old.id<>pid or old.session_id<>s.id or old.seq<>sq or old.latitude<>lat or old.longitude<>lon or old.horizontal_accuracy_m<>acc or old.recorded_at<>measured then raise sqlstate 'PT409' using message='Idempotency conflict'; end if;
   else
    insert into location_points(id,session_id,seq,latitude,longitude,horizontal_accuracy_m,recorded_at) values(pid,s.id,sq,lat,lon,acc,measured); n:=n+1;
   end if;
   ids:=ids||jsonb_build_array(pid);
  end loop;
  return jsonb_build_object('accepted_count',n,'acked_ids',ids,'waiting_point',w,'waiting_point_updated_at',wp_time,'server_time',t);
 end if;
 if s.id is null or s.status<>'active' then return jsonb_build_object('status',case when s.id is null then 'not_sharing' when s.status='expired' then 'expired' else 'stopped' end,'session_id',null,'latest',null,'route','[]'::jsonb,'last_received_at',null,'waiting_point',w,'server_time',t); end if;
 cursor_value:=coalesce((body->>'cursor')::bigint,0);
 if cursor_value<0 then raise sqlstate 'PT400' using message='Invalid cursor'; end if;
 -- The cursor follows arrival order so delayed batches cannot be missed. Clients sort drawing by measurement time/seq.
 select coalesce(jsonb_agg(to_jsonb(q) order by q.recorded_at,q.seq),'[]'),max(q.arrival) into route,max_cursor from
  (select id,seq,latitude,longitude,horizontal_accuracy_m,recorded_at,received_at,arrival from location_points where session_id=s.id and arrival>cursor_value order by arrival limit 500) q;
 select to_jsonb(q) into latest from (select id,seq,latitude,longitude,horizontal_accuracy_m,recorded_at,received_at,arrival from location_points where session_id=s.id order by recorded_at desc,seq desc limit 1) q;
 return jsonb_build_object('status','active','session_id',s.id,'latest',latest,'route',route,'next_cursor',coalesce(max_cursor,cursor_value),'has_more',exists(select 1 from location_points where session_id=s.id and arrival>coalesce(max_cursor,cursor_value)), 'last_received_at',(select max(received_at) from location_points where session_id=s.id),'waiting_point',w,'server_time',t);
exception
 when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then return jsonb_build_object('_status',400,'error','Invalid request value');
 when sqlstate 'PT400' or sqlstate 'PT404' or sqlstate 'PT409' then return jsonb_build_object('_status',substring(SQLSTATE from 3)::integer,'error','Request rejected');
 end;
end $$;
revoke all on function public.tracker_request(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.tracker_request(text,text,jsonb) to service_role;

create function public.cleanup_tracker() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update tracking_sessions set status='expired',ended_at=now() where status='active' and expires_at<=now();
 delete from location_points where recorded_at<now()-interval '7 days';
 delete from request_limits where bucket<now()-interval '1 day';
 delete from waiting_points where updated_at<now()-interval '7 days';
end $$;
revoke all on function public.cleanup_tracker() from public,anon,authenticated;
grant execute on function public.cleanup_tracker() to service_role;
