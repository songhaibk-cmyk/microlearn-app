-- MicroLearn classroom data model and row-level access policies.
-- Run once in Supabase SQL Editor before deploying the frontend.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 140),
  teacher_join_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete set null,
  full_name text not null default 'Học sinh' check (length(trim(full_name)) between 1 and 120),
  email text not null,
  role text not null default 'student' check (role in ('student', 'teacher', 'school_admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  grade smallint not null check (grade between 1 and 12),
  academic_year text not null,
  join_code text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.class_teachers (
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);

create table if not exists public.enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 180),
  objective text not null default '',
  skill_tag text not null default '',
  difficulty smallint not null default 1 check (difficulty between 1 and 4),
  estimated_minutes smallint not null default 10 check (estimated_minutes between 1 and 60),
  content jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.task_attempts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  answer text not null default '',
  hints_used smallint not null default 0 check (hints_used between 0 and 100),
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  created_at timestamptz not null default now()
);

create table if not exists public.task_answer_keys (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now()
);

create index if not exists classes_school_idx on public.classes(school_id);
create index if not exists class_teachers_teacher_idx on public.class_teachers(teacher_id);
create index if not exists enrollments_student_idx on public.enrollments(student_id);
create index if not exists tasks_class_idx on public.tasks(class_id, created_at desc);
create index if not exists task_attempts_student_idx on public.task_attempts(student_id, created_at desc);
create index if not exists task_attempts_task_idx on public.task_attempts(task_id, created_at desc);

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.current_profile_school()
returns uuid language sql stable security definer set search_path = public
as $$ select school_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_teacher_of_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.class_teachers where class_id = p_class_id and teacher_id = auth.uid()) $$;

create or replace function public.is_student_in_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.enrollments where class_id = p_class_id and student_id = auth.uid()) $$;

create or replace function public.can_access_class(p_class_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class_id and c.school_id = public.current_profile_school()
      and (
        public.current_profile_role() = 'school_admin'
        or (public.current_profile_role() = 'teacher' and public.is_teacher_of_class(c.id))
        or (public.current_profile_role() = 'student' and public.is_student_in_class(c.id))
      )
  )
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1 from public.profiles target
      where target.id = p_profile_id and target.school_id = public.current_profile_school()
        and (
          public.current_profile_role() = 'school_admin'
          or exists (
            select 1 from public.enrollments e
            join public.class_teachers ct on ct.class_id = e.class_id
            where e.student_id = target.id and ct.teacher_id = auth.uid()
          )
        )
    )
$$;

create or replace function public.create_school(p_name text, p_teacher_join_code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập.'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Tên trường cần ít nhất 2 ký tự.'; end if;
  if length(trim(coalesce(p_teacher_join_code, ''))) < 8 then raise exception 'Mã mời chưa hợp lệ.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and school_id is not null) then
    raise exception 'Tài khoản đã thuộc một trường.';
  end if;
  insert into public.schools(name, teacher_join_code)
  values (trim(p_name), upper(trim(p_teacher_join_code))) returning id into new_school_id;
  update public.profiles set school_id = new_school_id, role = 'school_admin' where id = auth.uid();
  return new_school_id;
end;
$$;

create or replace function public.join_school_as_teacher(p_teacher_join_code text)
returns void language plpgsql security definer set search_path = public
as $$
declare target_school_id uuid;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập.'; end if;
  select id into target_school_id from public.schools where teacher_join_code = upper(trim(p_teacher_join_code));
  if target_school_id is null then raise exception 'Mã mời giáo viên không đúng.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and school_id is not null) then
    raise exception 'Tài khoản đã thuộc một trường.';
  end if;
  update public.profiles set school_id = target_school_id, role = 'teacher' where id = auth.uid();
end;
$$;

create or replace function public.join_class_by_code(p_join_code text)
returns void language plpgsql security definer set search_path = public
as $$
declare target_class public.classes%rowtype; existing_school uuid; existing_role text;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập.'; end if;
  select * into target_class from public.classes where join_code = upper(trim(p_join_code));
  if target_class.id is null then raise exception 'Mã lớp không đúng.'; end if;
  select school_id, role into existing_school, existing_role from public.profiles where id = auth.uid();
  if existing_role <> 'student' then raise exception 'Chỉ tài khoản học sinh mới tham gia lớp bằng mã lớp.'; end if;
  if existing_school is not null and existing_school <> target_class.school_id then
    raise exception 'Tài khoản đang thuộc một trường khác.';
  end if;
  update public.profiles set school_id = target_class.school_id where id = auth.uid();
  insert into public.enrollments(class_id, student_id) values (target_class.id, auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.create_class(p_name text, p_grade smallint, p_academic_year text, p_join_code text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_class_id uuid; actor_role text; school_id_value uuid;
begin
  actor_role := public.current_profile_role();
  school_id_value := public.current_profile_school();
  if actor_role not in ('teacher', 'school_admin') or school_id_value is null then raise exception 'Không có quyền tạo lớp.'; end if;
  insert into public.classes(school_id, name, grade, academic_year, join_code, created_by)
  values (school_id_value, trim(p_name), p_grade, trim(p_academic_year), upper(trim(p_join_code)), auth.uid()) returning id into new_class_id;
  if actor_role = 'teacher' then
    insert into public.class_teachers(class_id, teacher_id, assigned_by) values (new_class_id, auth.uid(), auth.uid());
  end if;
  return new_class_id;
end;
$$;

create or replace function public.assign_teacher_to_class(p_class_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.current_profile_role() <> 'school_admin' then raise exception 'Chỉ quản trị viên trường mới được phân công giáo viên.'; end if;
  if not exists (
    select 1 from public.classes c join public.profiles p on p.id = p_teacher_id
    where c.id = p_class_id and c.school_id = public.current_profile_school()
      and p.school_id = c.school_id and p.role = 'teacher'
  ) then raise exception 'Lớp hoặc giáo viên không thuộc trường này.'; end if;
  insert into public.class_teachers(class_id, teacher_id, assigned_by)
  values (p_class_id, p_teacher_id, auth.uid()) on conflict (class_id, teacher_id) do nothing;
end;
$$;

create or replace function public.remove_teacher_from_class(p_class_id uuid, p_teacher_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.current_profile_role() <> 'school_admin' then raise exception 'Chỉ quản trị viên trường mới được gỡ phân công.'; end if;
  if not exists (select 1 from public.classes where id = p_class_id and school_id = public.current_profile_school()) then
    raise exception 'Lớp không thuộc trường này.';
  end if;
  delete from public.class_teachers where class_id = p_class_id and teacher_id = p_teacher_id;
end;
$$;

create or replace function public.rotate_teacher_join_code(p_new_code text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if public.current_profile_role() <> 'school_admin' then raise exception 'Chỉ quản trị viên trường mới được đổi mã mời.'; end if;
  if length(trim(coalesce(p_new_code, ''))) < 8 then raise exception 'Mã mời cần ít nhất 8 ký tự.'; end if;
  update public.schools set teacher_join_code = upper(trim(p_new_code)) where id = public.current_profile_school();
end;
$$;

create or replace function public.school_teacher_directory()
returns table(id uuid, full_name text, email text) language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email from public.profiles p
  where p.school_id = public.current_profile_school() and p.role = 'teacher'
    and public.current_profile_role() = 'school_admin'
  order by p.full_name
$$;

create or replace function public.create_class_task(
  p_class_id uuid, p_title text, p_objective text, p_skill_tag text, p_difficulty smallint, p_content jsonb, p_answer text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_task_id uuid; actor_role text;
begin
  actor_role := public.current_profile_role();
  if actor_role not in ('teacher', 'school_admin') or not public.can_access_class(p_class_id) then
    raise exception 'Bạn không được phân công quản lý lớp này.';
  end if;
  if length(trim(coalesce(p_title, ''))) < 2 or length(trim(coalesce(p_answer, ''))) = 0
    or p_difficulty not between 1 and 4
    or coalesce(jsonb_typeof(p_content->'options'), '') <> 'array'
    or case when jsonb_typeof(p_content->'options') = 'array' then jsonb_array_length(p_content->'options') else 0 end < 2
    or not exists (
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(p_content->'options') = 'array' then p_content->'options' else '[]'::jsonb end
      ) as option(value)
      where lower(trim(option.value)) = lower(trim(p_answer))
    )
    or length(trim(coalesce(p_content->>'prompt', ''))) = 0 then
    raise exception 'Nội dung nhiệm vụ hoặc đáp án chưa hợp lệ.';
  end if;
  insert into public.tasks(class_id, title, objective, skill_tag, difficulty, content, created_by)
  values (
    p_class_id, trim(p_title), trim(coalesce(p_objective, '')), trim(coalesce(p_skill_tag, '')), p_difficulty,
    jsonb_build_object('prompt', p_content->>'prompt', 'options', p_content->'options', 'explanation', coalesce(p_content->>'explanation', '')),
    auth.uid()
  )
  returning id into new_task_id;
  insert into public.task_answer_keys(task_id, answer) values (new_task_id, trim(p_answer));
  return new_task_id;
end;
$$;

create or replace function public.submit_task_attempt(
  p_task_id uuid, p_answer text, p_hints_used smallint default 0, p_active_seconds integer default 0
)
returns table(score smallint, explanation text) language plpgsql security definer set search_path = public
as $$
declare expected_answer text; actual_score smallint; task_class uuid; task_explanation text;
begin
  if auth.uid() is null or public.current_profile_role() <> 'student' then raise exception 'Chỉ học sinh mới nộp nhiệm vụ.'; end if;
  select t.class_id, t.content->>'explanation', k.answer
    into task_class, task_explanation, expected_answer
    from public.tasks t join public.task_answer_keys k on k.task_id = t.id where t.id = p_task_id;
  if task_class is null or not public.is_student_in_class(task_class) then raise exception 'Bạn không thuộc lớp của nhiệm vụ này.'; end if;
  if length(trim(coalesce(p_answer, ''))) = 0 then raise exception 'Câu trả lời không được để trống.'; end if;
  actual_score := case when lower(trim(p_answer)) = lower(trim(expected_answer)) then 100 else 0 end;
  insert into public.task_attempts(task_id, student_id, score, answer, hints_used, active_seconds)
  values (p_task_id, auth.uid(), actual_score, trim(p_answer), p_hints_used, p_active_seconds);
  return query select actual_score, coalesce(task_explanation, '');
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, email, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'Học sinh'), lower(new.email), 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_microlearn on auth.users;
create trigger on_auth_user_created_microlearn after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_teachers enable row level security;
alter table public.enrollments enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attempts enable row level security;
alter table public.task_answer_keys enable row level security;

drop policy if exists school_read_staff on public.schools;
create policy school_read_staff on public.schools for select to authenticated
using (id = public.current_profile_school() and public.current_profile_role() in ('school_admin', 'teacher'));

drop policy if exists profile_read_scoped on public.profiles;
create policy profile_read_scoped on public.profiles for select to authenticated using (public.can_view_profile(id));

drop policy if exists classes_read_accessible on public.classes;
create policy classes_read_accessible on public.classes for select to authenticated using (public.can_access_class(id));
drop policy if exists classes_create_staff on public.classes;
create policy classes_create_staff on public.classes for insert to authenticated
with check (school_id = public.current_profile_school() and public.current_profile_role() in ('teacher', 'school_admin') and created_by = auth.uid());
drop policy if exists classes_update_managers on public.classes;
create policy classes_update_managers on public.classes for update to authenticated
using (school_id = public.current_profile_school() and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(id)))
with check (school_id = public.current_profile_school());
drop policy if exists classes_delete_admin on public.classes;
create policy classes_delete_admin on public.classes for delete to authenticated
using (school_id = public.current_profile_school() and public.current_profile_role() = 'school_admin');

drop policy if exists class_teachers_read_scoped on public.class_teachers;
create policy class_teachers_read_scoped on public.class_teachers for select to authenticated
using (teacher_id = auth.uid() or (public.current_profile_role() = 'school_admin' and exists (select 1 from public.classes c where c.id = class_id and c.school_id = public.current_profile_school())));
drop policy if exists class_teachers_manage_admin on public.class_teachers;
create policy class_teachers_manage_admin on public.class_teachers for all to authenticated
using (public.current_profile_role() = 'school_admin' and exists (select 1 from public.classes c where c.id = class_id and c.school_id = public.current_profile_school()))
with check (public.current_profile_role() = 'school_admin' and exists (select 1 from public.classes c where c.id = class_id and c.school_id = public.current_profile_school()));

drop policy if exists enrollments_read_scoped on public.enrollments;
create policy enrollments_read_scoped on public.enrollments for select to authenticated
using (student_id = auth.uid() or public.can_access_class(class_id));

drop policy if exists tasks_read_class on public.tasks;
create policy tasks_read_class on public.tasks for select to authenticated using (public.can_access_class(class_id));
drop policy if exists tasks_insert_teachers on public.tasks;
create policy tasks_insert_teachers on public.tasks for insert to authenticated
with check (public.current_profile_role() in ('teacher', 'school_admin') and public.can_access_class(class_id) and created_by = auth.uid());
drop policy if exists tasks_update_teachers on public.tasks;
create policy tasks_update_teachers on public.tasks for update to authenticated
using (public.can_access_class(class_id) and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(class_id)))
with check (public.can_access_class(class_id) and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(class_id)));
drop policy if exists tasks_delete_teachers on public.tasks;
create policy tasks_delete_teachers on public.tasks for delete to authenticated
using (public.can_access_class(class_id) and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(class_id)));

drop policy if exists task_answer_keys_read_staff on public.task_answer_keys;
create policy task_answer_keys_read_staff on public.task_answer_keys for select to authenticated
using (exists (select 1 from public.tasks t where t.id = task_id and public.can_access_class(t.class_id)
  and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(t.class_id))));

drop policy if exists attempts_read_scoped on public.task_attempts;
create policy attempts_read_scoped on public.task_attempts for select to authenticated
using (student_id = auth.uid() or exists (
  select 1 from public.tasks t where t.id = task_id and
    public.can_access_class(t.class_id) and (public.current_profile_role() = 'school_admin' or public.is_teacher_of_class(t.class_id))
));

create or replace view public.student_tasks with (security_barrier = true) as
select t.id, t.class_id, t.title, t.objective, t.skill_tag, t.difficulty, t.estimated_minutes, t.content, t.created_at
from public.tasks t where public.current_profile_role() = 'student' and public.can_access_class(t.class_id);

grant select on public.student_tasks to authenticated;

revoke all on public.schools, public.profiles, public.classes, public.class_teachers, public.enrollments, public.tasks, public.task_attempts from anon;
grant select on public.schools, public.profiles, public.classes, public.class_teachers, public.enrollments, public.tasks, public.task_attempts to authenticated;
grant select on public.task_answer_keys to authenticated;
revoke select on public.profiles from authenticated;
grant select (id, school_id, full_name, role, created_at) on public.profiles to authenticated;
revoke insert, update, delete on public.schools, public.profiles, public.classes, public.class_teachers, public.enrollments, public.tasks, public.task_attempts, public.task_answer_keys from authenticated;
revoke all on public.schools, public.profiles, public.classes, public.class_teachers, public.enrollments, public.tasks, public.task_attempts, public.task_answer_keys from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_school() to authenticated;
grant execute on function public.is_teacher_of_class(uuid) to authenticated;
grant execute on function public.is_student_in_class(uuid) to authenticated;
grant execute on function public.can_access_class(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.create_school(text, text) to authenticated;
grant execute on function public.join_school_as_teacher(text) to authenticated;
grant execute on function public.join_class_by_code(text) to authenticated;
grant execute on function public.create_class(text, smallint, text, text) to authenticated;
grant execute on function public.assign_teacher_to_class(uuid, uuid) to authenticated;
grant execute on function public.remove_teacher_from_class(uuid, uuid) to authenticated;
grant execute on function public.rotate_teacher_join_code(text) to authenticated;
grant execute on function public.school_teacher_directory() to authenticated;
grant execute on function public.create_class_task(uuid, text, text, text, smallint, jsonb, text) to authenticated;
grant execute on function public.submit_task_attempt(uuid, text, smallint, integer) to authenticated;
