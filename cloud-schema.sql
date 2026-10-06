-- Public community: no login or upload-count quotas; maximum file size 1 MiB.
begin;
create table if not exists public.artifacts (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 160),
 model text not null check (char_length(model) between 1 and 160),
 author_name text not null check (char_length(author_name) between 1 and 60),
 prompt text not null default '' check (char_length(prompt) <= 6000),
 mime text not null check (mime in ('text/html','image/svg+xml','image/png','image/jpeg','image/webp','image/gif')),
 byte_size integer not null check (byte_size between 1 and 1048576),
 created_at timestamptz not null default now()
);
create table if not exists public.artifact_payloads (
 id uuid primary key references public.artifacts(id) on delete cascade,
 content text not null check (octet_length(content) <= 1500000)
);
create table if not exists public.artifact_upload_events (
 owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists artifact_events_owner_time on public.artifact_upload_events(owner_id,created_at);
create index if not exists artifacts_owner on public.artifacts(owner_id);
alter table public.artifacts alter column owner_id drop not null;
alter table public.artifacts enable row level security;
alter table public.artifact_payloads enable row level security;
alter table public.artifact_upload_events enable row level security;
revoke all on public.artifacts, public.artifact_payloads, public.artifact_upload_events from anon, authenticated;
grant select on public.artifacts to anon, authenticated;
-- Deletion/moderation is restricted to the dashboard administrator.
drop policy if exists artifacts_public_read on public.artifacts;
create policy artifacts_public_read on public.artifacts for select to anon,authenticated using (true);
drop policy if exists artifacts_owner_delete on public.artifacts;


create or replace function public.publish_artifact(p_title text,p_model text,p_author_name text,p_prompt text,p_mime text,p_content text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); new_id uuid; n integer; raw bytea;
begin
 if p_title is null or char_length(btrim(p_title)) not between 1 and 160 or p_model is null or char_length(btrim(p_model)) not between 1 and 160 or p_author_name is null or char_length(btrim(p_author_name)) not between 1 and 60 or char_length(coalesce(p_prompt,''))>6000 then raise exception '标题、模型、署名或提示词长度不符合要求'; end if;
 if p_content is null or octet_length(p_content)>1500000 then raise exception '文件超过1 MiB限制'; end if;
 if p_mime in ('text/html','image/svg+xml') then n:=octet_length(p_content);
 elsif p_mime in ('image/png','image/jpeg','image/webp','image/gif') then
  if p_content !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception '图片编码无效'; end if;
  raw:=decode(p_content,'base64'); n:=octet_length(raw);
  if (p_mime='image/png' and encode(substring(raw from 1 for 8),'hex')<>'89504e470d0a1a0a') or
   (p_mime='image/jpeg' and encode(substring(raw from 1 for 3),'hex')<>'ffd8ff') or
   (p_mime='image/gif' and encode(substring(raw from 1 for 6),'hex') not in ('474946383761','474946383961')) or
   (p_mime='image/webp' and (encode(substring(raw from 1 for 4),'hex')<>'52494646' or encode(substring(raw from 9 for 4),'hex')<>'57454250')) then raise exception '图片内容与格式不符'; end if;
 else raise exception '不支持的文件格式'; end if;
 if n not between 1 and 1048576 then raise exception '文件必须为1字节至1 MiB'; end if;
 insert into public.artifacts(owner_id,title,model,author_name,prompt,mime,byte_size) values(u,btrim(p_title),btrim(p_model),btrim(p_author_name),coalesce(p_prompt,''),p_mime,n) returning id into new_id;
 insert into public.artifact_payloads(id,content) values(new_id,p_content);
 return new_id;
end; $$;
revoke all on function public.publish_artifact(text,text,text,text,text,text) from public,anon;
grant execute on function public.publish_artifact(text,text,text,text,text,text) to anon,authenticated;

create or replace function public.artifact_content(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('content',p.content,'mime',a.mime)
 from public.artifact_payloads p join public.artifacts a using(id) where a.id=p_id;
$$;
revoke all on function public.artifact_content(uuid) from public;
grant execute on function public.artifact_content(uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
