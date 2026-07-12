const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
async function main() {
  const s = await p.draftingSession.findFirst({
    where: { patentId: 'cmrhn0rac0007rs04ofooldg4' },
    orderBy: { createdAt: 'desc' }
  })
  console.log('Session:', s?.id, 'Status:', s?.status)
  if (s) {
    await p.draftingSession.update({
      where: { id: s.id },
      data: { status: 'COMPONENT_PLANNER' }
    })
    console.log('Updated to COMPONENT_PLANNER')
  }
  await p.$disconnect()
}
main()
