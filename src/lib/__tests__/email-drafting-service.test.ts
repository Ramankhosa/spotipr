import { describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({}))

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/auth', () => ({ generateJWT: vi.fn() }))
vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn(), SITE_URL: 'https://patentnest.ai' }))
vi.mock('@/lib/token-utils', () => ({ generateToken: vi.fn(() => 'token'), hashToken: vi.fn(() => 'hash') }))
vi.mock('@/lib/user-instruction-service', () => ({ upsertUserInstruction: vi.fn() }))
vi.mock('@/lib/org-access-service', () => ({ checkServiceAccess: vi.fn() }))

import {
  buildCanonicalEmailDraftPayload,
  normalizeInboundEmailPayload,
} from '@/lib/email-drafting-service'
import { MAX_DRAFTING_INPUT_CHARS } from '@/lib/drafting-constants'

describe('email drafting parser', () => {
  test('normalizes SES inbound envelope payloads', () => {
    const payload = normalizeInboundEmailPayload({
      Type: 'Notification',
      Message: JSON.stringify({
        mail: {
          source: 'Inventor@Example.com',
          destination: ['draft+acme@patentnest.ai'],
          commonHeaders: { subject: 'Patent draft request' },
          messageId: 'msg_123',
        },
        receipt: {
          dkimVerdict: { status: 'PASS' },
          spfVerdict: { status: 'PASS' },
          spamVerdict: { status: 'PASS' },
        },
      }),
    })

    expect(payload.senderEmail).toBe('inventor@example.com')
    expect(payload.recipientEmail).toBe('draft+acme@patentnest.ai')
    expect(payload.subject).toBe('Patent draft request')
    expect(payload.messageId).toBe('msg_123')
    expect(payload.verdicts).toMatchObject({
      dkim: 'PASS',
      spf: 'PASS',
      spam: 'PASS',
    })
  })

  test('builds a canonical payload from labeled direct content and condenses the normalization brief', async () => {
    const mainBrief = 'A'.repeat(MAX_DRAFTING_INPUT_CHARS + 1200)

    const payload = await buildCanonicalEmailDraftPayload({
      senderEmail: 'inventor@example.com',
      recipientEmail: 'draft+acme@patentnest.ai',
      subject: 'Fallback title',
      parsedPayload: {
        directBodyText: [
          'Title: Smart irrigation controller',
          'Jurisdictions: IN US',
          'Filing Type: utility',
          `Main Brief: ${mainBrief}`,
          'Claims: 1. A system for irrigation control.',
          '2. The system of claim 1, wherein a valve actuator is networked.',
          'Claims Handling: use as is',
          'Claims Notes: Keep one device independent claim broad.',
          'Prior Art: US 1234567 A',
          'EP 7654321 B1',
          'Prior Art Handling: use only',
          'Figure Directions: Include a controller block diagram and a valve assembly diagram.',
          'Illustrative Data: Moisture values collected over 14 days.',
        ].join('\n'),
        directAttachments: [],
      },
    })

    expect(payload.title).toBe('Smart irrigation controller')
    expect(payload.jurisdictions).toEqual(['IN', 'US'])
    expect(payload.filingType).toBe('utility')
    expect(payload.mainBriefText).toBe(mainBrief)
    expect(payload.normalizationBrief.length).toBeLessThanOrEqual(MAX_DRAFTING_INPUT_CHARS)
    expect(payload.claimsHandling).toBe('use as is')
    expect(payload.claimsText).toContain('1. A system for irrigation control.')
    expect(payload.priorArtHandling).toBe('use only')
    expect(payload.figureDirections).toContain('controller block diagram')
    expect(payload.illustrativeData).toContain('14 days')
  })

  test('rejects ambiguous multiple claims attachments', async () => {
    await expect(
      buildCanonicalEmailDraftPayload({
        senderEmail: 'inventor@example.com',
        recipientEmail: 'draft+acme@patentnest.ai',
        subject: 'Ambiguous claims',
        parsedPayload: {
          directBodyText: 'Please prepare a patent draft for the disclosed controller.',
          directAttachments: [
            {
              filename: 'claims-v1.txt',
              mimeType: 'text/plain',
              contentText: '1. A system.\n2. The system of claim 1.',
            },
            {
              filename: 'claims-v2.txt',
              mimeType: 'text/plain',
              contentText: '1. A different system.\n2. The system of claim 1.',
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'REJECTED_AMBIGUOUS' })
  })

  test('rejects image-only submissions', async () => {
    await expect(
      buildCanonicalEmailDraftPayload({
        senderEmail: 'inventor@example.com',
        recipientEmail: 'draft+acme@patentnest.ai',
        subject: 'Image only',
        parsedPayload: {
          directBodyText: '',
          directAttachments: [
            {
              filename: 'figure1.png',
              mimeType: 'image/png',
              contentBase64: Buffer.from('not-a-real-image').toString('base64'),
            },
          ],
        },
      })
    ).rejects.toMatchObject({ code: 'EMPTY_USABLE_CONTENT' })
  })
})
