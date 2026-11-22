-- =============================================================================
-- 0004_storage.sql  -  Private bucket for shelf photos
-- Object path convention:  <user_id>/<session_id>/<timestamp>-<n>.jpg
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shelf-photos', 'shelf-photos', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy shelf_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'shelf-photos' and public.current_user_is_active());

create policy shelf_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'shelf-photos'
    and public.current_user_is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy shelf_photos_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'shelf-photos' and public.current_user_is_admin());

