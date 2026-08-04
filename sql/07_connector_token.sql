-- Domoconector MVP — migración de esquema
-- EJECUTAR en Supabase SQL Editor después de 05 y 06.
--
-- MODELO: heartbeats es una tabla de ESTADO ACTUAL, no de histórico.
--         Exactamente 1 fila por hw_id, actualizada con cada heartbeat.
--         No usar para analytics o tendencias — solo para estado online/offline.
--
-- Es seguro ejecutar varias veces (idempotente).

-- ============================================================
-- VERIFICACIÓN PREVIA (ejecutar aparte, solo lectura)
-- Debe devolver 0 filas antes de continuar.
-- ============================================================
-- SELECT hw_id, count(*) n
--   FROM public.heartbeats
--   WHERE hw_id IS NOT NULL
--   GROUP BY hw_id
--   HAVING count(*) > 1;

-- ============================================================
-- 1. Token por instalación en hardware_devices
-- ============================================================
ALTER TABLE public.hardware_devices
  ADD COLUMN IF NOT EXISTS connector_token text UNIQUE;

-- ============================================================
-- 2. Versión del conector en heartbeats
-- ============================================================
ALTER TABLE public.heartbeats
  ADD COLUMN IF NOT EXISTS connector_version text;

-- ============================================================
-- 3. Eliminar duplicados en heartbeats.hw_id (si existen)
--    Conserva el heartbeat con recibido_en más reciente.
--    Si recibido_en es NULL, conserva una fila arbitraria y borra las demás.
--    Seguro ejecutar aunque no haya duplicados (DELETE = 0 filas).
-- ============================================================
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY hw_id
      ORDER BY recibido_en DESC NULLS LAST
    ) AS rn
  FROM public.heartbeats
  WHERE hw_id IS NOT NULL
)
DELETE FROM public.heartbeats
WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

-- ============================================================
-- 4. Eliminar el índice parcial antiguo si existe
--    (PostgREST no acepta índices parciales para upsert)
-- ============================================================
DROP INDEX IF EXISTS heartbeats_hw_id_unique;

-- ============================================================
-- 5. UNIQUE CONSTRAINT en heartbeats.hw_id
--    PostgREST exige constraint completo (no parcial) para que
--    "Prefer: resolution=merge-duplicates" + "?on_conflict=hw_id" funcionen.
--    PostgreSQL permite múltiples NULL en UNIQUE — filas legacy sin hw_id quedan intactas.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.heartbeats'::regclass
      AND conname   = 'heartbeats_hw_id_unique'
  ) THEN
    ALTER TABLE public.heartbeats
      ADD CONSTRAINT heartbeats_hw_id_unique UNIQUE (hw_id);
  END IF;
END $$;

-- ============================================================
-- VERIFICACIÓN FINAL (ejecutar después de la migración)
-- ============================================================
-- SELECT column_name
--   FROM information_schema.columns
--   WHERE table_name = 'hardware_devices' AND column_name = 'connector_token';
-- SELECT column_name
--   FROM information_schema.columns
--   WHERE table_name = 'heartbeats' AND column_name = 'connector_version';
-- SELECT conname
--   FROM pg_constraint
--   WHERE conrelid = 'public.heartbeats'::regclass
--     AND conname = 'heartbeats_hw_id_unique';
