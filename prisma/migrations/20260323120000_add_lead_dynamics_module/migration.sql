-- CreateTable
CREATE TABLE "lead_dynamic_fields" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "inputType" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "workspaceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lead_dynamic_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_dynamic_options" (
  "id" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,

  CONSTRAINT "lead_dynamic_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_dynamic_values" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_dynamic_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_dynamic_fields_name_workspaceId_key" ON "lead_dynamic_fields"("name", "workspaceId");

-- CreateIndex
CREATE INDEX "lead_dynamic_fields_workspaceId_sortOrder_idx" ON "lead_dynamic_fields"("workspaceId", "sortOrder");

-- CreateIndex
CREATE INDEX "lead_dynamic_options_fieldId_idx" ON "lead_dynamic_options"("fieldId");

-- CreateIndex
CREATE INDEX "lead_dynamic_values_leadId_idx" ON "lead_dynamic_values"("leadId");

-- CreateIndex
CREATE INDEX "lead_dynamic_values_fieldId_idx" ON "lead_dynamic_values"("fieldId");

-- AddForeignKey
ALTER TABLE "lead_dynamic_fields" ADD CONSTRAINT "lead_dynamic_fields_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_dynamic_options" ADD CONSTRAINT "lead_dynamic_options_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "lead_dynamic_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_dynamic_values" ADD CONSTRAINT "lead_dynamic_values_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "lead_dynamic_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
