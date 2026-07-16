-- Convert ApplicantProfile.defaultJurisdiction from the closed Jurisdiction enum
-- (IN/PCT/US/EP) to free text so any active CountryProfile code can be used.
-- Existing values are preserved verbatim as text.

ALTER TABLE "applicant_profiles"
  ALTER COLUMN "defaultJurisdiction" TYPE TEXT
  USING "defaultJurisdiction"::text;

ALTER TABLE "applicant_profiles"
  ALTER COLUMN "defaultJurisdiction" SET DEFAULT 'IN';

DROP TYPE "Jurisdiction";
