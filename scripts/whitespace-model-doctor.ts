/**
 * Whitespace model doctor — "I assigned a model in Super Admin, so why is it
 * running something else?".
 *
 * Stage-coded resolution (model-resolver.ts getStageConfig) is fail-closed and
 * requires FOUR things to line up. The runtime error names none of them:
 *
 *   1. a PlanStageModelConfig row for THIS exact planId
 *   2. ...whose stage.code matches
 *   3. ...with isActive = true on the config row
 *   4. ...pointing at a model whose OWN isActive is true      <- the quiet one
 *
 * Miss any of them and whitespace falls back to task-only routing, which ends
 * at the system default model — which is how an unrelated model ends up in the
 * logs. This prints every gate per stage, per plan, and names what to fix.
 *
 * Usage:
 *   npx tsx scripts/whitespace-model-doctor.ts              # every active plan
 *   npx tsx scripts/whitespace-model-doctor.ts <planId>     # the plan from the log
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const planIdArg = process.argv[2]

  const stages = await prisma.workflowStage.findMany({
    where: { featureCode: 'WHITESPACE_ANALYSIS' },
    orderBy: { sortOrder: 'asc' },
  })
  if (!stages.length) {
    console.log(
      'No WHITESPACE_ANALYSIS workflow stages exist at all.\n' +
        'Run: npm run ws:seed-stages'
    )
    return
  }

  const plans = planIdArg
    ? await prisma.plan.findMany({ where: { id: planIdArg } })
    : await prisma.plan.findMany({ where: { status: 'ACTIVE' }, orderBy: { code: 'asc' } })

  if (!plans.length) {
    console.log(`\nNo Plan row has id "${planIdArg}".\n`)

    // A planId the gateway resolved but that has no Plan row means EVERY
    // stage-coded call for that tenant fails resolution and silently falls to
    // the system default — platform-wide, not just whitespace. Show what does
    // exist, and who points where, so the mismatch is obvious.
    const all = await prisma.plan.findMany({ orderBy: { code: 'asc' } })
    console.log('Plans that DO exist:')
    for (const plan of all) console.log(`  ${plan.id}  ${plan.code.padEnd(18)} status=${plan.status}`)

    const tenantPlans = await prisma.tenantPlan.findMany({
      include: { tenant: { select: { id: true, name: true, status: true } }, plan: { select: { code: true } } },
      take: 40,
    })
    if (tenantPlans.length) {
      console.log('\nTenant -> plan bindings (this is where the gateway reads planId):')
      for (const binding of tenantPlans) {
        console.log(
          `  tenant ${binding.tenant.id} (${binding.tenant.name ?? 'unnamed'}, ${binding.tenant.status})` +
            ` -> ${binding.planId} ${binding.plan?.code ?? 'MISSING PLAN ROW'}`
        )
      }
    }
    console.log(
      '\nIf no binding above shows the id you passed, the id in your log was most likely\n' +
        'mis-transcribed — re-copy it from the log text rather than a screenshot. If a\n' +
        'binding DOES show it with "MISSING PLAN ROW", that tenant points at a deleted\n' +
        'plan and every stage-coded call it makes falls through to the system default.'
    )
    return
  }

  // The end of the fallback chain — what you actually see in the logs when
  // stage resolution fails. Two rungs, and the second one surprises people:
  // with no model flagged isDefault, getSystemDefault() returns the OLDEST
  // ACTIVE MODEL BY createdAt. That model is typically nobody's choice — it is
  // simply whatever was seeded into the registry first, often a long-retired
  // one — and it is reached without being assigned or flagged anywhere.
  const systemDefault = await prisma.lLMModel.findFirst({ where: { isDefault: true, isActive: true } })
  const oldestActive = await prisma.lLMModel.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log('\n=== END OF THE FALLBACK CHAIN (what runs when stage resolution fails) ===')
  if (systemDefault) {
    console.log(`  system default : ${systemDefault.code}  (${systemDefault.provider})  [isDefault=true]`)
  } else {
    console.log('  system default : NONE FLAGGED — no model has isDefault=true AND isActive=true')
    console.log(
      `  >>> so every unconfigured call falls to the OLDEST ACTIVE MODEL: ` +
        `"${oldestActive?.code ?? 'gemini-2.0-flash'}" (${oldestActive?.provider ?? 'google'}, created ${
          oldestActive?.createdAt.toISOString().slice(0, 10) ?? 'n/a'
        })`
    )
    console.log(
      '      That model is not assigned anywhere and is not marked default — it is\n' +
        '      simply the first row ever added to the registry. Flag the model you\n' +
        '      actually want with isDefault=true (Super Admin > LLM Config > Overview).'
    )
  }
  console.log(
    `  oldest active  : ${oldestActive?.code ?? '(none)'}  ` +
      `(created ${oldestActive?.createdAt.toISOString().slice(0, 10) ?? 'n/a'})`
  )

  // Plan-level fallback maps a ModelClass to a HARDCODED model code in
  // model-resolver.ts MODEL_CLASS_DEFAULTS — not to anything configurable.
  console.log('\n  Note: the plan-default rung (PlanLLMAccess) maps ModelClass -> a hardcoded')
  console.log('  model code in model-resolver.ts (ADVANCED -> claude-3.5-sonnet). No admin')
  console.log('  setting overrides those constants.')

  for (const plan of plans) {
    console.log(`\n=== PLAN ${plan.code}  (${plan.id})  status=${plan.status} ===\n`)
    const problems: string[] = []

    for (const stage of stages) {
      const config = await prisma.planStageModelConfig.findFirst({
        where: { planId: plan.id, stageId: stage.id },
        include: { model: true },
        orderBy: { priority: 'desc' },
      })

      if (!config) {
        console.log(`  ${stage.code.padEnd(30)} NO CONFIG ROW for this plan`)
        problems.push(`${stage.code}: no config row — assign a model for THIS plan in Super Admin`)
        continue
      }

      const gates: string[] = []
      if (!config.isActive) gates.push('config.isActive=false')
      if (!config.model.isActive) gates.push(`model "${config.model.code}".isActive=false`)

      const verdict = gates.length ? `BLOCKED — ${gates.join(', ')}` : 'ok'
      console.log(
        `  ${stage.code.padEnd(30)} ${config.model.code.padEnd(24)} ${verdict}`
      )
      if (gates.length) {
        problems.push(
          `${stage.code}: assigned "${config.model.code}" but ${gates.join(' and ')} — ` +
            `resolution returns null, so this stage silently uses the system default instead.`
        )
      }
    }

    if (problems.length) {
      console.log('\n  WHAT TO FIX:')
      for (const problem of problems) console.log(`   - ${problem}`)
    } else {
      console.log('\n  All whitespace stages resolve cleanly on this plan.')
    }
  }

  // Deactivated models are the least obvious failure, so list them explicitly.
  const dead = await prisma.lLMModel.findMany({ where: { isActive: false }, orderBy: { code: 'asc' } })
  if (dead.length) {
    console.log(`\n=== INACTIVE MODELS (${dead.length}) — any stage pointed at these silently falls back ===`)
    for (const model of dead) console.log(`  ${model.code}  (${model.provider})`)
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
