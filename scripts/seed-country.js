const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const u = await p.user.findFirst({ where: { roles: { has: "ANALYST" } } });
  if (!u) { console.log("No analyst user found"); process.exit(1); }

  const baseProfile = {
    meta: { id: "US", code: "US", name: "United States", continent: "North America", office: "USPTO", officeUrl: "https://www.uspto.gov", applicationTypes: ["standard","provisional"], languages: ["en"], version: 1, status: "active" },
    structure: { defaultVariant: "standard", variants: [{ id: "standard", label: "Standard Patent Application", sections: [
      { id: "title", label: "Title", order: 1, canonicalKeys: ["title"], required: true, group: "header" },
      { id: "abstract", label: "Abstract", order: 2, canonicalKeys: ["abstract"], required: true, group: "header" },
      { id: "background", label: "Background", order: 3, canonicalKeys: ["background"], required: true, group: "body" },
      { id: "summary", label: "Summary", order: 4, canonicalKeys: ["summary"], required: true, group: "body" },
      { id: "detailed_description", label: "Detailed Description", order: 5, canonicalKeys: ["detailed_description"], required: true, group: "body" },
      { id: "claims", label: "Claims", order: 6, canonicalKeys: ["claims"], required: true, group: "claims" },
      { id: "figures", label: "Figures", order: 7, canonicalKeys: ["figures"], required: false, group: "figures" }
    ]}] },
    formatting: { numberingSystems: [{ id: "arabic", label: "Arabic Numerals", format: "1, 2, 3" }], referenceNumeralRange: { min: 100, max: 999 }, figurePrefix: "FIG.", claimNumbering: "arabic" },
    rules: { maxClaimsBeforeSurcharge: 20, maxIndependentClaimsBeforeSurcharge: 3, maxPages: null },
    prompts: {}
  };

  const r = await p.countryProfile.upsert({
    where: { countryCode: "US" },
    update: { profileData: baseProfile, name: "United States", status: "ACTIVE" },
    create: { countryCode: "US", name: "United States", profileData: baseProfile, status: "ACTIVE", createdBy: u.id }
  });
  console.log("Seeded US profile:", r.id);

  const inMeta = { ...baseProfile.meta, id: "IN", code: "IN", name: "India", office: "Indian Patent Office", officeUrl: "https://ipindia.gov.in" };
  const inProfile = { ...baseProfile, meta: inMeta };
  const r2 = await p.countryProfile.upsert({
    where: { countryCode: "IN" },
    update: { profileData: inProfile, name: "India", status: "ACTIVE" },
    create: { countryCode: "IN", name: "India", profileData: inProfile, status: "ACTIVE", createdBy: u.id }
  });
  console.log("Seeded IN profile:", r2.id);
  await p.$disconnect();
})();
