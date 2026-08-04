-- RLS para hardware_devices: políticas de escritura.
-- Añadir DESPUÉS de haber ejecutado 05_rls_hardware_devices.sql.
--
-- Sin estas policies, el UPDATE desde el navegador (asignar empresa,
-- editar datos) falla en silencio cuando RLS está activo — PostgreSQL
-- no lanza error, simplemente afecta 0 filas.
--
-- EJECUTAR en Supabase SQL Editor.

-- UPDATE: solo superadmin puede modificar cualquier device
CREATE POLICY "hw_superadmin_actualiza_todo" ON public.hardware_devices
  FOR UPDATE TO authenticated
  USING (
    (SELECT rol FROM public.usuarios
     WHERE lower(trim(email)) = lower(trim(auth.email()))) = 'superadmin'
  );

-- DELETE: solo superadmin puede eliminar (por si se usa alguna vez desde cliente)
CREATE POLICY "hw_superadmin_borra_todo" ON public.hardware_devices
  FOR DELETE TO authenticated
  USING (
    (SELECT rol FROM public.usuarios
     WHERE lower(trim(email)) = lower(trim(auth.email()))) = 'superadmin'
  );

-- Verificación rápida tras ejecutar:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'hardware_devices' ORDER BY cmd;
-- Debe aparecer: hw_superadmin_lee_todo (SELECT), hw_empresa_lee_propios (SELECT),
--                hw_superadmin_actualiza_todo (UPDATE), hw_superadmin_borra_todo (DELETE)
