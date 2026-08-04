-- RLS para hardware_devices: aislamiento por empresa.
-- Superadmin ve todo. Admin/user ven solo su empresa_id.
--
-- EJECUTAR en Supabase SQL Editor (una sola vez).
-- Es idempotente: borra las policies SELECT existentes antes de crear las nuevas.

-- 1. Asegurar que RLS está activo
ALTER TABLE public.hardware_devices ENABLE ROW LEVEL SECURITY;

-- 2. Eliminar todas las policies SELECT existentes (sean las que sean)
DO $$
DECLARE pol_name text;
BEGIN
  FOR pol_name IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'hardware_devices'
      AND cmd        = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.hardware_devices', pol_name);
  END LOOP;
END;
$$;

-- 3. Superadmin: acceso total
CREATE POLICY "hw_superadmin_lee_todo" ON public.hardware_devices
  FOR SELECT TO authenticated
  USING (
    (SELECT rol FROM public.usuarios
     WHERE lower(trim(email)) = lower(trim(auth.email()))) = 'superadmin'
  );

-- 4. Admin / user: solo los devices de su empresa
CREATE POLICY "hw_empresa_lee_propios" ON public.hardware_devices
  FOR SELECT TO authenticated
  USING (
    empresa_id = (
      SELECT empresa_id FROM public.usuarios
      WHERE lower(trim(email)) = lower(trim(auth.email()))
    )
  );

-- Verificación rápida (copia y pega esto tras ejecutar lo anterior):
-- SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'hardware_devices';
