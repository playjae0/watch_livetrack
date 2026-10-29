create or replace function public.cleanup_tracker() returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update tracking_sessions set status='expired',ended_at=now() where status='active' and expires_at<=now();
 delete from location_points where recorded_at<now()-interval '7 days';
 delete from request_limits where bucket<now()-interval '1 day';
 delete from waiting_points where updated_at<now()-interval '7 days';
 delete from enrollment_codes where expires_at<now() or used_at is not null;
end $$;
