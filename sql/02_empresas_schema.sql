-- Multi-tenant: tabla empresas + columnas empresa_id en usuarios y hardware_devices.
-- Todo aditivo y nullable: no rompe login/Servidores/Hardware/Instaladores
-- mientras no se despliegue el frontend que los usa.
--
-- Sin grants directos a anon/authenticated sobre 'empresas' (tabla nueva
-- creada por SQL, igual que invitaciones): toda lectura/escritura pasa por
-- las funciones de sql/04_empresas_rpc.sql.

create table if not exists public.empresas (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  creado_en timestamptz not null default now()
);

alter table public.usuarios
  add column if not exists empresa_id uuid references public.empresas(id);

alter table public.hardware_devices
  add column if not exists empresa_id uuid references public.empresas(id);

create index if not exists idx_usuarios_empresa_id         on public.usuarios(empresa_id);
create index if not exists idx_hardware_devices_empresa_id on public.hardware_devices(empresa_id);
