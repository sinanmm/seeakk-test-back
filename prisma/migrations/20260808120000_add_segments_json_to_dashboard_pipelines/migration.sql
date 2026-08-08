-- AlterTable
ALTER TABLE "dashboard_pipelines" ADD COLUMN IF NOT EXISTS "segmentsJson" JSONB;
