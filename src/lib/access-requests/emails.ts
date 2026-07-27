/**
 * Email bodies for the access-request pipeline.
 *
 * Four moments generate mail:
 *   1. Someone submits a form          -> acknowledgement to them, alert to the admin inbox
 *   2. A super admin approves a trial  -> invite mail carrying the registration link
 *   3. A super admin declines a trial  -> a short, non-generic refusal
 *
 * Everything is inline-styled: mail clients strip <style> blocks.
 */

const BRAND = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  green: '#1d4ed8',
  greenSoft: '#eef2fe',
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function nl2br(input: string): string {
  return escapeHtml(input).replace(/\n/g, '<br/>')
}

function shell(inner: string): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BRAND.ink};max-width:560px;margin:0 auto;padding:8px 4px;">
${inner}
<p style="margin-top:28px;padding-top:16px;border-top:1px solid ${BRAND.line};font-size:12px;color:${BRAND.muted};">
PatentNest.ai — AI-assisted patent drafting, search and prosecution.
</p>
</div>`
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
<a href="${href}" style="display:inline-block;background:${BRAND.green};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a>
</p>
<p style="font-size:12px;color:${BRAND.muted};word-break:break-all;">If the button does not work, paste this into your browser:<br/>${escapeHtml(href)}</p>`
}

function detailRows(rows: Array<[string, string | null | undefined]>): string {
  return rows
    .filter(([, value]) => value && String(value).trim())
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:${BRAND.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;vertical-align:top;">${nl2br(String(value))}</td></tr>`
    )
    .join('')
}

// ---------------------------------------------------------------------------
// 1. Acknowledgement to the person who submitted
// ---------------------------------------------------------------------------

export function contactAcknowledgement(params: { name: string; topic?: string | null }) {
  const firstName = params.name.split(' ')[0] || params.name
  return {
    subject: 'We got your message — PatentNest.ai',
    html: shell(`
<p>Hi ${escapeHtml(firstName)},</p>
<p>Thanks for reaching out about <strong>${escapeHtml(params.topic || 'PatentNest.ai')}</strong>. Your message is with our team and a human will reply to this address, usually within one business day.</p>
<p>If anything changes in the meantime, just reply to this email and it will be attached to the same conversation.</p>
<p style="margin-top:20px;">— The PatentNest team</p>`),
    text: `Hi ${firstName},\n\nThanks for reaching out about ${params.topic || 'PatentNest.ai'}. Your message is with our team and a human will reply to this address, usually within one business day.\n\nIf anything changes in the meantime, just reply to this email.\n\n— The PatentNest team`,
  }
}

export function trialAcknowledgement(params: { name: string }) {
  const firstName = params.name.split(' ')[0] || params.name
  return {
    subject: 'Your free trial request is in review — PatentNest.ai',
    html: shell(`
<p>Hi ${escapeHtml(firstName)},</p>
<p>Your request for a free PatentNest.ai trial has been received.</p>
<p>We review every trial request by hand so we can set up the right jurisdictions and limits for your work. You will hear back at this address — normally within one business day — with either your activation link or a question or two.</p>
<p style="margin-top:20px;">— The PatentNest team</p>`),
    text: `Hi ${firstName},\n\nYour request for a free PatentNest.ai trial has been received.\n\nWe review every trial request by hand so we can set up the right jurisdictions and limits for your work. You will hear back at this address — normally within one business day — with either your activation link or a question or two.\n\n— The PatentNest team`,
  }
}

// ---------------------------------------------------------------------------
// 2. Alert to the admin inbox
// ---------------------------------------------------------------------------

export function adminAlert(params: {
  kind: 'CONTACT' | 'TRIAL'
  requestId: string
  siteUrl: string
  name: string
  email: string
  phone?: string | null
  organization?: string | null
  jobTitle?: string | null
  country?: string | null
  topic?: string | null
  message?: string | null
  useCase?: string | null
  teamSize?: string | null
  expectedVolume?: string | null
  jurisdictions?: string[]
  sourcePage?: string | null
}) {
  const isTrial = params.kind === 'TRIAL'
  const heading = isTrial ? 'New free-trial request' : 'New contact enquiry'
  const inboxUrl = `${params.siteUrl}/super-admin/requests?request=${params.requestId}`

  const rows = detailRows([
    ['Name', params.name],
    ['Email', params.email],
    ['Phone', params.phone],
    ['Organisation', params.organization],
    ['Role', params.jobTitle],
    ['Country', params.country],
    ['Topic', params.topic],
    ['Team size', params.teamSize],
    ['Expected volume', params.expectedVolume],
    ['Jurisdictions', params.jurisdictions?.length ? params.jurisdictions.join(', ') : null],
    ['Source page', params.sourcePage],
    [isTrial ? 'What they want to do' : 'Message', isTrial ? params.useCase : params.message],
  ])

  return {
    subject: `${heading}: ${params.name}${params.organization ? ` (${params.organization})` : ''}`,
    html: shell(`
<p style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:${BRAND.green};font-weight:700;margin:0 0 6px;">${escapeHtml(heading)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
${button(inboxUrl, 'Open in the request inbox')}`),
    text: `${heading}\n\n${params.name} <${params.email}>\n${params.organization || ''}\n\n${
      (isTrial ? params.useCase : params.message) || ''
    }\n\nTriage: ${inboxUrl}`,
  }
}

// ---------------------------------------------------------------------------
// 3. Trial approved — carries the email-locked invite link
// ---------------------------------------------------------------------------

export function trialApproved(params: {
  name: string
  inviteUrl: string
  trialDays: number
  expiresAt: Date | null
  note?: string | null
}) {
  const firstName = params.name.split(' ')[0] || params.name
  const expiry = params.expiresAt
    ? params.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null

  return {
    subject: `Your PatentNest.ai trial is ready (${params.trialDays} days)`,
    html: shell(`
<p>Hi ${escapeHtml(firstName)},</p>
<p>Your free trial has been approved. It runs for <strong>${params.trialDays} days</strong> from the moment you activate it.</p>
${params.note ? `<div style="background:${BRAND.greenSoft};border-left:3px solid ${BRAND.green};padding:12px 14px;border-radius:6px;margin:16px 0;">${nl2br(params.note)}</div>` : ''}
${button(params.inviteUrl, 'Activate my trial')}
<p style="font-size:13px;color:${BRAND.muted};">This link is tied to your email address and cannot be shared.${
      expiry ? ` Please activate it before <strong>${escapeHtml(expiry)}</strong>.` : ''
    }</p>`),
    text: `Hi ${firstName},\n\nYour free trial has been approved. It runs for ${params.trialDays} days from activation.\n${
      params.note ? `\n${params.note}\n` : ''
    }\nActivate here: ${params.inviteUrl}\n\nThis link is tied to your email address and cannot be shared.${
      expiry ? ` Please activate it before ${expiry}.` : ''
    }`,
  }
}

// ---------------------------------------------------------------------------
// 4. Trial declined
// ---------------------------------------------------------------------------

export function trialDeclined(params: { name: string; reason?: string | null; siteUrl: string }) {
  const firstName = params.name.split(' ')[0] || params.name
  return {
    subject: 'About your PatentNest.ai trial request',
    html: shell(`
<p>Hi ${escapeHtml(firstName)},</p>
<p>Thank you for your interest in PatentNest.ai. We are not able to open a free trial for you at this time.</p>
${params.reason ? `<div style="background:#f8fafc;border-left:3px solid ${BRAND.line};padding:12px 14px;border-radius:6px;margin:16px 0;">${nl2br(params.reason)}</div>` : ''}
<p>If your circumstances change, or you would like to talk to us about a paid plan, we would be glad to hear from you at <a href="${params.siteUrl}/contact" style="color:${BRAND.green};">${escapeHtml(params.siteUrl)}/contact</a>.</p>
<p style="margin-top:20px;">— The PatentNest team</p>`),
    text: `Hi ${firstName},\n\nThank you for your interest in PatentNest.ai. We are not able to open a free trial for you at this time.\n${
      params.reason ? `\n${params.reason}\n` : ''
    }\nIf your circumstances change, or you would like to talk about a paid plan, reach us at ${params.siteUrl}/contact.\n\n— The PatentNest team`,
  }
}
