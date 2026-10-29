-- Short, single-use, operator-issued enrollment codes. No public table access.
create table public.enrollment_codes (
  code_hash text primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create table public.enrollment_rate (
  singleton boolean primary key default true check (singleton),
  bucket timestamptz not null,
  attempts integer not null
);
alter table public.enrollment_codes enable row level security;
alter table public.enrollment_rate enable row level security;
revoke all on public.enrollment_codes, public.enrollment_rate from public,anon,authenticated;
grant all on public.enrollment_codes, public.enrollment_rate to service_role;

-- Serialize the limiter and redemption together. Failed codes still consume attempts.
create function public.redeem_enrollment(code_hash text, new_secret_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; c enrollment_codes; d devices; now_time timestamptz:=clock_timestamp();
begin
 if code_hash !~ '^[a-f0-9]{64}$' or new_secret_hash !~ '^[a-f0-9]{64}$' then return jsonb_build_object('_status',400); end if;
 insert into enrollment_rate(singleton,bucket,attempts) values(true,date_trunc('minute',now_time),1)
 on conflict(singleton) do update set attempts=case when enrollment_rate.bucket=excluded.bucket then enrollment_rate.attempts+1 else 1 end, bucket=excluded.bucket returning attempts into n;
 if n>5 then return jsonb_build_object('_status',429); end if;
 select * into c from enrollment_codes e where e.code_hash=redeem_enrollment.code_hash for update;
 if c.code_hash is null or c.used_at is not null or c.expires_at<=now_time then return jsonb_build_object('_status',401); end if;
 select * into d from devices where id=c.device_id for update;
 if d.id is null or d.revoked_at is not null then return jsonb_build_object('_status',403); end if;
 if exists(select 1 from tracking_sessions where device_id=d.id and status='active' and expires_at>now_time) then return jsonb_build_object('_status',409); end if;
 update devices set device_secret_hash=new_secret_hash where id=d.id;
 update enrollment_codes set used_at=now_time where enrollment_codes.code_hash=c.code_hash;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.redeem_enrollment(text,text) from public,anon,authenticated;
grant execute on function public.redeem_enrollment(text,text) to service_role;
