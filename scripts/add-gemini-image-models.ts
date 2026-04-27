/**
 * Add Gemini Image Generation Models to LLM Control
 * 
 * This script adds the Gemini Nano Banana Pro model for sketch/image generation
 * to the llm_models table so they appear in the admin LLM control panel.
 * 
 * Usage:
 *   npx ts-node scripts/add-gemini-image-models.ts
 *   OR
 *   npx tsx scripts/add-gemini-image-models.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface GeminiImageModel {
  code: string
  displayName: string
  contextWindow: number
  supportsVision: boolean
  supportsStreaming: boolean
  inputCostPer1M: number  // USD cents
  outputCostPer1M: number // USD cents
  description?: string
}

// Gemini image generation model used by Sketches (AI Generated).
// Runtime requests force imageConfig.imageSize = "2K" in src/lib/sketch-service.ts.
const GEMINI_IMAGE_MODELS: GeminiImageModel[] = [
  {
    code: 'gemini-3-pro-image-preview',
    displayName: 'Gemini 3 Pro Image Preview (Nano Banana Pro)',
    contextWindow: 128000,
    supportsVision: true,
    supportsStreaming: false,
    inputCostPer1M: 100,   // $1.00 per 1M
    outputCostPer1M: 400,  // $4.00 per 1M / image generation placeholder
    description: 'Nano Banana Pro model for professional 2K patent sketch generation.'
  }
]

async function main() {
  console.log('🚀 Adding Gemini Image Generation Models to LLM Control...\n')

  let created = 0
  let updated = 0
  let skipped = 0

  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      // Check if model already exists
      const existing = await prisma.lLMModel.findUnique({
        where: { code: model.code }
      })

      if (existing) {
        // Update existing model
        await prisma.lLMModel.update({
          where: { code: model.code },
          data: {
            displayName: model.displayName,
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: true,
            updatedAt: new Date()
          }
        })
        console.log(`✅ Updated: ${model.code} (${model.displayName})`)
        updated++
      } else {
        // Create new model
        await prisma.lLMModel.create({
          data: {
            code: model.code,
            displayName: model.displayName,
            provider: 'google',
            contextWindow: model.contextWindow,
            supportsVision: model.supportsVision,
            supportsStreaming: model.supportsStreaming,
            inputCostPer1M: model.inputCostPer1M,
            outputCostPer1M: model.outputCostPer1M,
            isActive: true,
            isDefault: false
          }
        })
        console.log(`🆕 Created: ${model.code} (${model.displayName})`)
        created++
      }
    } catch (error) {
      console.error(`❌ Error processing ${model.code}:`, error)
      skipped++
    }
  }

  console.log('\n📊 Summary:')
  console.log(`   Created: ${created}`)
  console.log(`   Updated: ${updated}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Total:   ${GEMINI_IMAGE_MODELS.length}`)

  // List all Gemini models now in the database
  console.log('\n📋 All Gemini models in database:')
  const allGeminiModels = await prisma.lLMModel.findMany({
    where: { provider: 'google' },
    orderBy: { code: 'asc' }
  })
  
  console.log('┌────────────────────────────────────┬────────────────────────────────────────────────────┬────────┐')
  console.log('│ Code                               │ Display Name                                       │ Active │')
  console.log('├────────────────────────────────────┼────────────────────────────────────────────────────┼────────┤')
  for (const m of allGeminiModels) {
    const code = m.code.padEnd(34)
    const name = m.displayName.substring(0, 50).padEnd(50)
    const active = m.isActive ? '  ✓   ' : '  ✗   '
    console.log(`│ ${code} │ ${name} │${active}│`)
  }
  console.log('└────────────────────────────────────┴────────────────────────────────────────────────────┴────────┘')

  console.log('\n✅ Done! You can now select these models in the Super Admin LLM Control panel.')
}

main()
  .catch((e) => {
    console.error('Script failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })































