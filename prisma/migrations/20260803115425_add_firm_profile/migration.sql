-- CreateTable
CREATE TABLE "firm_profiles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "logoDataUri" TEXT,
    "tagline" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "countryCode" TEXT,
    "postalCode" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "accentColor" TEXT,
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firm_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_profiles_tenantId_key" ON "firm_profiles"("tenantId");

-- AddForeignKey
ALTER TABLE "firm_profiles" ADD CONSTRAINT "firm_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
