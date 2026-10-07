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
