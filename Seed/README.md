# 🌱 Seed Scripts for Production Deployment

This folder contains utility scripts for the multi-country patent filing system.

## Master Seed Script

**All country-specific seeding is now consolidated into a single script:**

```bash
# Location: Countries/MasterSeed.js

# Run all production seeds
node Seed/production-master-seed.js
```

# Run with force (overwrite existing)
node Countries/MasterSeed.js --force

# Dry run (preview without changes)
node Countries/MasterSeed.js --dry-run

# Seed specific country only
node Countries/MasterSeed.js --country=IN

# Skip jurisdiction styles (diagram/export configs)
node Countries/MasterSeed.js --skip-styles
```

## What MasterSeed.js Does

The master seed script handles all country-specific data in the correct order:

1. **Superset Sections** - 17 universal patent sections (title, background, claims, etc.)
2. **Country Names** - 28+ countries with continents
3. **Country Section Mappings** - Which sections apply to each jurisdiction
4. **Country Section Prompts** - Top-up prompts for jurisdiction-specific drafting
5. **Country Profiles** - Full country configuration from JSON files
6. **Jurisdiction Styles** - Diagram, export, and validation configs

## Database Tables Populated

| Table | Purpose |
|-------|---------|
| `superset_sections` | 17 universal section definitions |
| `country_names` | Country code → name mapping |
| `country_profiles` | Country configurations & metadata |
| `country_section_mappings` | Which sections each country uses |
| `country_section_prompts` | Country-specific prompt top-ups |
| `country_section_prompt_history` | Audit trail for prompt changes |
| `country_diagram_config` | Drawing/diagram rules per country |
| `country_diagram_hint` | Diagram generation hints |
| `country_export_config` | PDF/document export settings |
| `country_export_heading` | Section heading styles |
| `country_section_validation` | Word/char limits, legal requirements |
| `country_cross_validation` | Cross-section consistency checks |

## Superset Sections (17 Universal Sections)

| # | Section Key | Required |
|---|-------------|----------|
| 1 | title | Yes |
| 2 | preamble | No |
| 3 | fieldOfInvention | Yes |
| 4 | background | Yes |
| 5 | objectsOfInvention | No |
| 6 | summary | Yes |
| 7 | technicalProblem | No |
| 8 | technicalSolution | No |
| 9 | advantageousEffects | No |
| 10 | briefDescriptionOfDrawings | Yes |
| 11 | detailedDescription | Yes |
| 12 | bestMode | No |
| 13 | industrialApplicability | No |
| 14 | claims | Yes |
| 15 | abstract | Yes |
| 16 | listOfNumerals | No |
| 17 | crossReference | No |

## Supported Countries

Country configurations are loaded from JSON files in `Countries/`:

- `Countries/IN.json` → India
- `Countries/US.json` → United States
- `Countries/AU.json` → Australia
- `Countries/JP.json` → Japan
- `Countries/pct.json` → PCT (International)
- `Countries/canada.json` → Canada

Additional countries are loaded from `production-seed-backup.json`.

## Prerequisites

1. Database migrations applied:
   ```bash
   npx prisma migrate deploy
   ```

2. At least one user exists (for `createdBy` field):
   ```bash
   node scripts/setup-full-hierarchy.js
   ```

## After Seeding

Verify data in the admin UI:

1. Start server: `npm run dev`
2. Login: `superadmin@spotipr.com` / `SuperSecure123!`
3. Visit: `http://localhost:3000/super-admin/jurisdiction-config`

## Troubleshooting

### "No users found in database"
Run user setup first:
```bash
node scripts/setup-full-hierarchy.js
```

### Foreign key constraint error
Ensure migrations are applied:
```bash
npx prisma migrate deploy
npx prisma generate
```

### JSON parse error
Check JSON syntax in `Countries/*.json` files.

## Adding New Countries

1. Create `Countries/XX.json` (use `Countries/TEMPLATE_COUNTRY.json` as template)
2. Run: `node Countries/MasterSeed.js --country=XX`
3. Or use admin UI: `/super-admin/jurisdiction-config` → Add Country

## Other Utility Scripts in This Folder

| Script | Purpose |
|--------|---------|
| `create-tenant-admin.js` | Create tenant admin users |
| `reset-password.js` | Reset user passwords |
