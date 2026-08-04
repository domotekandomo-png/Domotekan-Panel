-- Funciones RPC para el sistema multi-tenant de empresas.
-- Todas SECURITY DEFINER: se ejecutan con los privilegios de quien las crea
-- (el owner del proyecto en el SQL Editor), que ya tiene acceso pleno a las
-- tablas. No se toca ningún GRANT/RLS de las tablas existentes — solo se
-- exponen estas funciones, de forma acotada, vía GRANT EXECUTE.

-- ── crear_invitacion(): añade el límite de 3 empleados por empresa ───────
-- Mismo nombre, mismos 0 parámetros (no crea una firma nueva, sustituye
-- la función existente). Cuando quien invita es 'admin', cuenta los
-- usuarios 'user' ya vinculados a su empresa MÁS las invitaciones que
-- generó y siguen vigentes (sin expirar); si la suma llega a 3, bloquea.
create or replace function public.crear_invitacion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol        text;
  v_id         uuid;
  v_empresa_id uuid;
  v_token      text;
  v_count      integer;
begin
  select id, rol, empresa_id into v_id, v_rol, v_empresa_id
  from public.usuarios where lower(trim(email)) = lower(trim(auth.email()));

  if v_id is null or v_rol not in ('superadmin', 'admin') then
    raise exception 'No tienes permisos para generar invitaciones.';
  end if;

  if v_rol = 'admin' then
    select
      (select count(*) from public.usuarios where empresa_id = v_empresa_id and rol = 'user')
      +
      (select count(*) from public.invitaciones where creado_por = v_id and expira_en > now())
    into v_count;

    if v_count >= 3 then
      raise exception 'Has alcanzado el límite de 3 empleados invitados para tu empresa.';
    end if;
  end if;

  v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  insert into public.invitaciones (token, creado_por, expira_en)
  values (v_token, v_id, now() + interval '5 minutes');

  return v_token;
end;
$$;

grant execute on function public.crear_invitacion() to authenticated;

-- ── invitaciones_restantes(): para que el frontend desactive el botón ────
-- "Invitar" sin que el admin tenga que intentarlo primero. null = sin
-- límite (superadmin), 0..3 = cupo restante para un admin, 0 = sin cupo
-- (rol que no puede invitar, p. ej. 'user'/'instalador').
create or replace function public.invitaciones_restantes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol        text;
  v_id         uuid;
  v_empresa_id uuid;
  v_count      integer;
begin
  select id, rol, empresa_id into v_id, v_rol, v_empresa_id
  from public.usuarios where lower(trim(email)) = lower(trim(auth.email()));

  if v_rol = 'superadmin' then
    return null;
  end if;

  if v_rol <> 'admin' then
    return 0;
  end if;

  select
    (select count(*) from public.usuarios where empresa_id = v_empresa_id and rol = 'user')
    +
    (select count(*) from public.invitaciones where creado_por = v_id and expira_en > now())
  into v_count;

  return greatest(0, 3 - v_count);
end;
$$;

grant execute on function public.invitaciones_restantes() to authenticated;

-- ── completar_invitacion(): gana lógica de empresa ───────────────────────
-- rol nuevo 'admin' → crea una empresa nueva con el nombre del formulario
-- rol nuevo 'user'  → hereda el empresa_id del admin que generó la invitación
--
-- Añade un 5º parámetro (p_empresa_nombre) → eso crea una firma nueva en
-- paralelo a la de 4 parámetros si no se borra explícitamente. Como el
-- invite flow es nuevo y no hay invitaciones reales en curso, se borra la
-- firma vieja en el mismo script sin ventana de riesgo.
drop function if exists public.completar_invitacion(text, uuid, text, text);

create or replace function public.completar_invitacion(
  p_token          text,
  p_user_id        uuid,
  p_email          text,
  p_nombre         text,
  p_empresa_nombre text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol        text;
  v_creado_por uuid;
  v_empresa_id uuid;
begin
  -- Revalida el token (cascada + expiración) dentro de la misma transacción
  v_rol := public.validar_invitacion(p_token);

  select creado_por into v_creado_por
  from public.invitaciones
  where token = p_token;

  if v_rol = 'admin' then
    if p_empresa_nombre is null or trim(p_empresa_nombre) = '' then
      raise exception 'Falta el nombre de la empresa.';
    end if;
    insert into public.empresas (nombre)
    values (trim(p_empresa_nombre))
    returning id into v_empresa_id;

  elsif v_rol = 'user' then
    select empresa_id into v_empresa_id
    from public.usuarios
    where id = v_creado_por;
  end if;

  insert into public.usuarios (id, email, nombre, rol, activo, empresa_id)
  values (p_user_id, lower(p_email), p_nombre, v_rol, true, v_empresa_id);

  -- Un solo uso: se borra al completarse el alta
  delete from public.invitaciones where token = p_token;

  return v_rol;
end;
$$;

grant execute on function
  public.completar_invitacion(text, uuid, text, text, text)
  to anon, authenticated;

-- ── listar_empresas(): única vía de lectura sobre 'empresas' ─────────────
-- Solo superadmin. Devuelve cada empresa con sus contadores, para la
-- página Instaladores/Empresas.
create or replace function public.listar_empresas()
returns table (
  empresa_id     uuid,
  empresa_nombre text,
  creado_en      timestamptz,
  num_admins     bigint,
  num_usuarios   bigint,
  num_hardware   bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  select rol into v_rol from public.usuarios where lower(trim(email)) = lower(trim(auth.email()));
  if v_rol is distinct from 'superadmin' then
    raise exception 'No tienes permisos para ver el listado de empresas.';
  end if;

  return query
  select
    e.id,
    e.nombre,
    e.creado_en,
    (select count(*) from public.usuarios u where u.empresa_id = e.id and u.rol in ('admin','instalador')),
    (select count(*) from public.usuarios u where u.empresa_id = e.id and u.rol = 'user'),
    (select count(*) from public.hardware_devices h where h.empresa_id = e.id)
  from public.empresas e
  order by e.creado_en;
end;
$$;

grant execute on function public.listar_empresas() to authenticated;
