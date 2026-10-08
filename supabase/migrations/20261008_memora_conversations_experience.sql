-- Memora persistent conversations, ambient experience, and secret-memory protection
-- Applied to production on 2026-10-08 and kept here for reproducibility.

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  archived boolean not null default false
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

grant select, insert, update, delete on public.chat_threads to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;

drop policy if exists chat_threads_select_own on public.chat_threads;
drop policy if exists chat_threads_insert_own on public.chat_threads;
drop policy if exists chat_threads_update_own on public.chat_threads;
drop policy if exists chat_threads_delete_own on public.chat_threads;

create policy chat_threads_select_own
on public.chat_threads
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy chat_threads_insert_own
on public.chat_threads
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy chat_threads_update_own
on public.chat_threads
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy chat_threads_delete_own
on public.chat_threads
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists chat_messages_select_own on public.chat_messages;
drop policy if exists chat_messages_insert_own on public.chat_messages;
drop policy if exists chat_messages_update_own on public.chat_messages;
drop policy if exists chat_messages_delete_own on public.chat_messages;

create policy chat_messages_select_own
on public.chat_messages
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy chat_messages_insert_own
on public.chat_messages
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.chat_threads t
    where t.id = thread_id
      and t.user_id = (select auth.uid())
  )
);

create policy chat_messages_update_own
on public.chat_messages
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy chat_messages_delete_own
on public.chat_messages
for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists chat_threads_user_recent_idx
on public.chat_threads(user_id, archived, last_message_at desc);

create index if not exists chat_messages_thread_created_idx
on public.chat_messages(thread_id, created_at);

alter table public.user_settings
  add column if not exists ambient_enabled boolean not null default true;

alter table public.user_settings
  add column if not exists ambient_scene text not null default 'auto';

alter table public.user_settings
  add column if not exists ambient_volume numeric not null default 0.24
  check (ambient_volume >= 0 and ambient_volume <= 1);

alter table public.user_settings
  add column if not exists dynamic_background boolean not null default true;

create or replace function public.prevent_manual_secret_memory()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(new.source_type,'manual') = 'manual'
     and coalesce(new.provenance_kind,'user_stated') = 'user_stated'
     and (
       new.original_text ~ 'sk-[A-Za-z0-9_-]{20,}'
       or new.original_text ~ 'gh[pousr]_[A-Za-z0-9_]{20,}'
       or new.original_text ~ 'AKIA[0-9A-Z]{16}'
       or new.original_text ~ 'AIza[0-9A-Za-z_-]{20,}'
       or new.original_text ~ 'xox[baprs]-[0-9A-Za-z-]{20,}'
     )
  then
    raise exception 'Sensitive credential detected. Store credentials in Sources, not Memories.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_manual_secret_memory_trigger on public.memories;

create trigger prevent_manual_secret_memory_trigger
before insert or update of original_text on public.memories
for each row execute function public.prevent_manual_secret_memory();


create index if not exists chat_messages_user_idx
on public.chat_messages(user_id);

create index if not exists memory_facts_source_memory_idx
on public.memory_facts(source_memory_id);

create index if not exists memory_facts_source_media_idx
on public.memory_facts(source_media_id);


-- Companion onboarding, mood memory and contextual scenery preferences
alter table public.user_settings
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_skipped_at timestamptz,
  add column if not exists mood_checkins_enabled boolean not null default true,
  add column if not exists contextual_scenery boolean not null default true;

create table if not exists public.mood_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mood text not null,
  intensity smallint check (intensity is null or (intensity between 1 and 5)),
  note text,
  source text not null default 'chat',
  memory_id uuid references public.memories(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.mood_logs enable row level security;
grant select, insert, update, delete on public.mood_logs to authenticated;

drop policy if exists mood_logs_select_own on public.mood_logs;
drop policy if exists mood_logs_insert_own on public.mood_logs;
drop policy if exists mood_logs_update_own on public.mood_logs;
drop policy if exists mood_logs_delete_own on public.mood_logs;

create policy mood_logs_select_own on public.mood_logs
for select to authenticated
using ((select auth.uid()) = user_id);

create policy mood_logs_insert_own on public.mood_logs
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy mood_logs_update_own on public.mood_logs
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy mood_logs_delete_own on public.mood_logs
for delete to authenticated
using ((select auth.uid()) = user_id);

create index if not exists mood_logs_user_created_idx
on public.mood_logs(user_id, created_at desc);


-- Keep mood history within "delete my memory vault"
create or replace function public.delete_all_my_memory_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required'; end if;

  delete from public.ai_request_logs where user_id=uid;
  delete from public.reminders where user_id=uid;
  delete from public.events where user_id=uid;
  delete from public.mood_logs where user_id=uid;
  delete from public.thing_locations where user_id=uid;
  delete from public.things where user_id=uid;
  delete from public.memory_facts where user_id=uid;
  delete from public.people where user_id=uid;
  delete from public.places where user_id=uid;
  delete from public.documents where user_id=uid;
  delete from public.sources where user_id=uid;
  delete from public.tags where user_id=uid;
  delete from public.memories where user_id=uid;
end;
$$;

revoke all on function public.delete_all_my_memory_data() from public, anon;
grant execute on function public.delete_all_my_memory_data() to authenticated;


create index if not exists mood_logs_memory_idx
on public.mood_logs(memory_id);
