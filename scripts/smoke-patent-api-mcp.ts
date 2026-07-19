import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { createPatentApiKeySecret } from '../src/lib/patent-api-auth'
import { POST as mcpPost } from '../src/app/api/v1/mcp/route'

function rpc(body: unknown, key?: string) {
  return new NextRequest('http://local/api/v1/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  })
}

async function main() {
  process.env.PATENT_PUBLIC_API_ENABLED = 'true'

  const init = await mcpPost(rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } }))
  const initJson = await init.json()
  if (initJson.result?.protocolVersion !== '2025-06-18' || !initJson.result?.serverInfo?.name) {
    throw new Error(`initialize failed: ${JSON.stringify(initJson)}`)
  }

  const list = await mcpPost(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const listJson = await list.json()
  const toolNames = (listJson.result?.tools || []).map((tool: any) => tool.name)
  const expectedTools = ['search_patents', 'get_patent', 'extract_invention_features', 'map_features_to_patent']
  if (expectedTools.some(name => !toolNames.includes(name))) {
    throw new Error(`tools/list is missing tools: ${JSON.stringify(toolNames)}`)
  }

  const note = await mcpPost(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))
  if (note.status !== 202) throw new Error(`Expected 202 for notification, got ${note.status}`)

  const unauth = await mcpPost(rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_patent', arguments: { publicationNumber: 'IN1A' } } }))
  if (unauth.status !== 401) throw new Error(`Expected 401 for unauthenticated tools/call, got ${unauth.status}`)

  const generated = createPatentApiKeySecret()
  const client = await prisma.patentApiClient.create({
    data: {
      name: 'Patent API MCP Smoke Test',
      slug: `patent-api-mcp-smoke-${Date.now()}`,
      rateLimitPerMinute: 10,
      dailyRequestLimit: 10,
      monthlyRequestLimit: 10,
    },
  })
  try {
    await prisma.patentApiKey.create({
      data: {
        clientId: client.id,
        name: 'MCP smoke',
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        keyLastFour: generated.keyLastFour,
      },
    })
    const sample = await prisma.localPatent.findFirst({
      where: { corpusSources: { has: 'indian-corpus' }, publicationNumberKey: { not: null } },
      select: { publicationNumber: true },
    })
    if (!sample) throw new Error('No normalized Indian patent is available for the MCP smoke test.')

    const call = await mcpPost(rpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_patent', arguments: { publicationNumber: sample.publicationNumber } } },
      generated.secret
    ))
    const callJson = await call.json()
    if (call.status !== 200 || callJson.result?.isError || callJson.result?.structuredContent?.publicationNumber !== sample.publicationNumber) {
      throw new Error(`tools/call get_patent failed: ${JSON.stringify(callJson).slice(0, 600)}`)
    }
    if (!call.headers.get('RateLimit-Limit')) throw new Error('tools/call response is missing rate-limit headers.')

    const badTool = await mcpPost(rpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } },
      generated.secret
    ))
    const badToolJson = await badTool.json()
    if (badToolJson.result?.isError !== true) throw new Error('Expected isError result for an unknown tool.')

    console.log(JSON.stringify({
      protocolVersion: initJson.result.protocolVersion,
      tools: toolNames,
      notificationStatus: note.status,
      unauthenticatedStatus: unauth.status,
      getPatent: callJson.result.structuredContent.publicationNumber,
      rateLimitHeader: call.headers.get('RateLimit-Limit'),
      unknownToolIsError: true,
    }))
  } finally {
    await prisma.patentApiClient.delete({ where: { id: client.id } }).catch(() => undefined)
  }
}

main().catch(error => {
  console.error('[PatentApiMcpSmoke] Failed:', error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
