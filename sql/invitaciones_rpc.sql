-- Funciones RPC para el flujo de invitaciones (panel-gestion).
-- Objetivo: permitir que un visitante anónimo (anon) valide un token de
-- invitación y complete su alta SIN otorgar acceso directo a las tablas
-- invitaciones/usuarios. Las funciones son SECURITY DEFINER: se ejecutan
-- con los privilegios de quien las crea (normalmente el owner del proyecto
-- en el SQL Editor), que ya tiene acceso pleno a esas tablas. No se toca
-- ningún GRANT ni RLS de las tablas existentes — solo se exponen estas
-- dos funciones, de forma acotada, vía GRANT EXECUTE.
--
-- Cascada de roles: superadmin invita -> admin (Instalador)
--                    admin invita      -> user  (Trabajador del instalador)

create or replace function public.validar_invitacion(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creado_por  uuid;
  v_expira_en   timestamptz;
  v_rol_creador text;
  v_rol_nuevo   text;
begin
  select creado_por, expira_en into v_creado_por, v_expira_en
  from public.invitaciones
  where token = p_token;

  if v_creado_por is null then
    raise exception 'Enlace de invitación no válido o ya utilizado.';
  end if;

  if v_expira_en <= now() then
    delete from public.invitaciones where token = p_token;
    raise exception 'El enlace de invitación ha caducado.';
  end if;

  select rol into v_rol_creador from public.usuarios where id = v_creado_por;

  v_rol_nuevo := case v_rol_creador
    when 'superadmin' then 'admin'
    when 'admin'       then 'user'
    else null
  end;

  if v_rol_nuevo is null then
    raise exception 'El creador de esta invitación no tiene permisos para generar accesos.';
  end if;

  return v_rol_nuevo;
end;
$$;

create or replace function public.completar_invitacion(
  p_token   text,
  p_user_id uuid,
  p_email   text,
  p_nombre  text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  -- Revalida el token (cascada + expiración) dentro de la misma transacción
  v_rol := public.validar_invitacion(p_token);

  insert into public.usuarios (id, email, nombre, rol, activo)
  values (p_user_id, lower(p_email), p_nombre, v_rol, true);

  -- Un solo uso: se borra al completarse el alta
  delete from public.invitaciones where token = p_token;

  return v_rol;
end;
$$;

grant execute on function public.validar_invitacion(text)                     to anon, authenticated;
grant execute on function public.completar_invitacion(text, uuid, text, text) to anon, authenticated;

-- Crea la invitación (sustituye al INSERT directo desde el cliente, bloqueado
-- por RLS para 'authenticated'). Comprueba el rol del autor por email, igual
-- que ya hace index.html, porque usuarios.id no tiene por qué coincidir con
-- auth.uid() para las cuentas creadas antes de este flujo.
create or replace function public.crear_invitacion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol   text;
  v_id    uuid;
  v_token text;
begin
  select id, rol into v_id, v_rol from public.usuarios where lower(trim(email)) = lower(trim(auth.email()));

  if v_id is null or v_rol not in ('superadmin', 'admin') then
    raise exception 'No tienes permisos para generar invitaciones.';
  end if;

  v_token := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);

  insert into public.invitaciones (token, creado_por, expira_en)
  values (v_token, v_id, now() + interval '5 minutes');

  return v_token;
end;
$$;

grant execute on function public.crear_invitacion() to authenticated;
