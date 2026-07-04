-- Lead profile: company and postal/contact address (optional).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "address" TEXT;
