#!/usr/bin/env node

/**
 * Database Seed Data Restore Script
 *
 * This script imports seed data from the exported JSON file to restore database state.
 * Use with caution - this will overwrite existing data.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function restoreTableData(tableName, modelName, data) {
  if (!data || data.length === 0) {
    console.log(`Skipping ${tableName} - no data to restore`);
    return;
  }

  console.log(`Restoring ${tableName} (${data.length} records)...`);

  try {
    // Clear existing data first (optional - uncomment if needed)
    // await prisma[modelName].deleteMany({});

    // Insert data in batches to avoid memory issues
    const batchSize = 100;
    let processed = 0;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      // Transform data for Prisma createMany
      const createData = batch.map(item => transformForPrisma(modelName, item));

      try {
        await prisma[modelName].createMany({
          data: createData,
          skipDuplicates: true // Skip if record already exists
        });
        processed += batch.length;
        console.log(`  Processed ${processed}/${data.length} records for ${tableName}`);
      } catch (batchError) {
        console.error(`Error in batch ${Math.floor(i/batchSize) + 1} for ${tableName}:`, batchError.message);
        // Continue with next batch
      }
    }

    console.log(`✅ Restored ${processed} records to ${tableName}`);
  } catch (error) {
    console.error(`❌ Error restoring ${tableName}:`, error.message);
  }
}

function transformForPrisma(modelName, item) {
  // Remove Prisma-managed fields and transform data as needed
  const transformed = { ...item };

  // Remove auto-generated fields
  delete transformed.createdAt;
  delete transformed.updatedAt;
  delete transformed.id; // Let Prisma auto-generate IDs unless they're truly needed

  // Handle specific model transformations
  switch (modelName) {
    case 'user':
      // Keep essential fields, remove computed ones
      delete transformed.tenant;
      delete transformed.projects;
      delete transformed.collaborations;
      delete transformed.patents;
      break;

    case 'patent':
      delete transformed.project;
      delete transformed.creator;
      delete transformed.annexureVersions;
      delete transformed.jobs;
      delete transformed.priorArtBundles;
      delete transformed.noveltyAssessments;
      break;

    case 'priorArtSearchBundle':
      delete transformed.patent;
      delete transformed.creator;
      delete transformed.approver;
      delete transformed.history;
      delete transformed.queryVariants;
      delete transformed.runs;
      break;

    case 'priorArtRun':
      delete transformed.bundle;
      delete transformed.user;
      delete transformed.queryVariants;
      delete transformed.rawResults;
      delete transformed.variantHits;
      delete transformed.unifiedResults;
      break;

    case 'noveltyAssessmentRun':
      delete transformed.patent;
      delete transformed.user;
      delete transformed.llmCalls;
      break;

    case 'tenant':
      delete transformed.users;
      delete transformed.atiTokens;
      delete transformed.tenantPlans;
      break;

    case 'project':
      delete transformed.user;
      delete transformed.applicantProfile;
      delete transformed.collaborators;
      delete transformed.patents;
      break;

    // Add more transformations as needed for other models
    default:
      // Remove relation fields for other models
      Object.keys(transformed).forEach(key => {
        if (transformed[key] && typeof transformed[key] === 'object' && !Array.isArray(transformed[key])) {
          // Remove nested objects (relations)
          delete transformed[key];
        }
      });
  }

  return transformed;
}

async function restoreSeedData() {
  console.log('Starting database seed data restoration...\n');

  try {
    const seedFilePath = path.join(__dirname, '..', 'prisma', 'seed-data.json');

    if (!fs.existsSync(seedFilePath)) {
      console.error(`❌ Seed file not found: ${seedFilePath}`);
      console.log('Please run create-seed-data.js first to export current data.');
      process.exit(1);
    }

    const seedData = JSON.parse(fs.readFileSync(seedFilePath, 'utf8'));
    console.log(`Loaded seed data from ${seedData.exportedAt}`);
    console.log(`Version: ${seedData.version}\n`);

    // Define the order of restoration (respecting foreign key constraints)
    const restoreOrder = [
      // Core system first
      { table: 'tenants', model: 'tenant' },
      { table: 'users', model: 'user' },
      { table: 'atiTokens', model: 'aTIToken' },
      { table: 'auditLogs', model: 'auditLog' },

      // Plans and metering
      { table: 'plans', model: 'plan' },
      { table: 'features', model: 'feature' },
      { table: 'tasks', model: 'task' },
      { table: 'llmModelClasses', model: 'lLMModelClass' },
      { table: 'planFeatures', model: 'planFeature' },
      { table: 'planLLMAccess', model: 'planLLMAccess' },
      { table: 'policyRules', model: 'policyRule' },
      { table: 'tenantPlans', model: 'tenantPlan' },

      // Projects and patents
      { table: 'projects', model: 'project' },
      { table: 'applicantProfiles', model: 'applicantProfile' },
      { table: 'projectCollaborators', model: 'projectCollaborator' },
      { table: 'patents', model: 'patent' },
      { table: 'annexureVersions', model: 'annexureVersion' },
      { table: 'jobs', model: 'job' },

      // Metering usage data
      { table: 'usageReservations', model: 'usageReservation' },
      { table: 'usageMeters', model: 'usageMeter' },
      { table: 'usageLogs', model: 'usageLog' },
      { table: 'quotaAlerts', model: 'quotaAlert' },

      // Prior art search data
      { table: 'priorArtSearchBundles', model: 'priorArtSearchBundle' },
      { table: 'priorArtSearchHistory', model: 'priorArtSearchHistory' },
      { table: 'priorArtQueryVariants', model: 'priorArtQueryVariant' },
      { table: 'priorArtRuns', model: 'priorArtRun' },
      { table: 'priorArtQueryVariantExecutions', model: 'priorArtQueryVariantExecution' },
      { table: 'priorArtRawResults', model: 'priorArtRawResult' },
      { table: 'priorArtRawDetails', model: 'priorArtRawDetail' },
      { table: 'priorArtPatents', model: 'priorArtPatent' },
      { table: 'priorArtVariantHits', model: 'priorArtVariantHit' },
      { table: 'priorArtPatentDetails', model: 'priorArtPatentDetail' },
      { table: 'priorArtUnifiedResults', model: 'priorArtUnifiedResult' },
      { table: 'priorArtScholarContent', model: 'priorArtScholarContent' },

      // Local patent data
      { table: 'localPatents', model: 'localPatent' },

      // Novelty assessment
      { table: 'noveltyAssessmentRuns', model: 'noveltyAssessmentRun' },
      { table: 'noveltyAssessmentLLMCalls', model: 'noveltyAssessmentLLMCall' },

      // User credits and notifications
      { table: 'userCredits', model: 'userCredit' },
      { table: 'tokenNotifications', model: 'tokenNotification' }
    ];

    // Restore data in the correct order
    for (const { table, model } of restoreOrder) {
      const tableData = seedData.tables[table];
      if (tableData) {
        await restoreTableData(table, model, tableData);
      }
    }

    console.log('\n✅ Database restoration completed successfully!');
    console.log('Note: Some records may have been skipped if they already exist (skipDuplicates=true)');

  } catch (error) {
    console.error('❌ Error during seed data restoration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Add warning prompt
console.log('⚠️  WARNING: This script will restore seed data to the database.');
console.log('⚠️  Existing data may be overwritten or duplicated.');
console.log('⚠️  Make sure you have a backup before proceeding.\n');

// Run the restoration
restoreSeedData().catch(console.error);
