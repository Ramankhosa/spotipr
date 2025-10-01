const { PrismaClient } = require('@prisma/client')

async function checkData() {
  const prisma = new PrismaClient()

  try {
    console.log('=== TENANTS ===')
    const tenants = await prisma.tenant.findMany()
    tenants.forEach(tenant => {
      console.log(`- ${tenant.name} (${tenant.atiId}) - ID: ${tenant.id}`)
    })

    console.log('\n=== USERS ===')
    const users = await prisma.user.findMany({
      include: { tenant: true }
    })
    users.forEach(user => {
      console.log(`- ${user.email} (${user.role}) - Tenant: ${user.tenant?.name || 'No tenant'} (${user.tenant?.atiId || 'N/A'})`)
    })

    console.log('\n=== ATI TOKENS ===')
    const tokens = await prisma.aTIToken.findMany({
      include: { tenant: true }
    })
    tokens.forEach(token => {
      console.log(`- ID: ${token.id}`)
      console.log(`  Fingerprint: ${token.fingerprint}`)
      console.log(`  Status: ${token.status}`)
      console.log(`  Tenant: ${token.tenant.name} (${token.tenant.atiId})`)
      console.log(`  Expires: ${token.expiresAt}`)
      console.log(`  Max Uses: ${token.maxUses}`)
      console.log('---')
    })

    if (tokens.length === 0) {
      console.log('No ATI tokens found in database')
    }

  } catch (error) {
    console.error('Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

checkData()
