-- Migración única: crea una empresa por cada admin/instalador EXISTENTE
-- que aún no tenga empresa_id, y le asigna esa empresa.
--
-- NOTA IMPORTANTE: hardware_devices NO tiene ninguna columna que indique
-- qué instalador/admin es responsable de cada dispositivo (no existe
-- "assigned_by" ni equivalente — se comprobó directamente contra la BD).
-- Por tanto este script NO puede backfillear hardware_devices.empresa_id
-- automáticamente: no hay ningún dato del que partir, y no voy a inventar
-- una asignación. Todo el hardware existente queda con empresa_id = null
-- (visible solo para superadmin) hasta que se asigne a mano — ver la
-- consulta de listado al final de este script.
--
-- Idempotente: si se ejecuta más de una vez, los usuarios que ya tienen
-- empresa_id (por una ejecución anterior) se omiten — no se duplican
-- empresas.

do $$
declare
  r record;
  v_empresa_id uuid;
begin
  for r in
    select id, email, nombre
    from public.usuarios
    where rol in ('admin', 'instalador')
      and empresa_id is null
  loop
    insert into public.empresas (nombre)
    values (coalesce(r.nombre, r.email) || ' (empresa)')
    returning id into v_empresa_id;

    update public.usuarios
      set empresa_id = v_empresa_id
      where id = r.id;
  end loop;
end $$;

-- ── Verificación — revisar antes de desplegar el frontend nuevo ──────────

-- (a) admins/instaladores sin empresa_id → debería devolver 0 filas
select id, email, nombre, rol
from public.usuarios
where rol in ('admin', 'instalador') and empresa_id is null;

-- (b) Listado de TODO el hardware existente, para que decidas a mano a
--     qué empresa pertenece cada uno (si pertenece a alguna). Usa el
--     resultado de (a) para ver el id de empresa de cada instalador, y
--     luego ejecuta un UPDATE manual por dispositivo, por ejemplo:
--       update public.hardware_devices set empresa_id = '<uuid-empresa>' where hw_id = '<hw_id>';
select id, hw_id, client_name, alias, status
from public.hardware_devices
order by created_at;
