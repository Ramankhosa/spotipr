import { prisma } from '../prisma'
import { sendEmail, SITE_URL } from '../mailer'

/**
 * Office Action Studio — attorney notifications
 *
 * A prepare run takes minutes and is deliberately backgrounded, so the attorney
 * is expected to leave the case open. Mail the outcome either way: a run that
 * failed silently is worse than one that failed loudly, because the deadline
 * keeps running regardless.
 *
 * Uses the same Mailjet sender as the novelty-search completion mail; when the
 * keys are absent that helper logs instead of sending, so nothing throws in
 * local or CI environments.
 */

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface PrepareOutcome {
  status: 'COMPLETED' | 'FAILED'
  /** From PrepareResult when the run finished. */
  objectionsDrafted?: number
  draftErrors?: number
  judgmentFlags?: number
  /** Present when the run failed outright. */
  error?: string
}

/**
 * Mail the outcome of a prepare run. Never throws — a mail failure must not
 * change the job's recorded state.
 */
export async function notifyPrepareOutcome(job: { id: string; caseId: string; userId: string }, outcome: PrepareOutcome): Promise<boolean> {
  try {
    const [user, oaCase] = await Promise.all([
      prisma.user.findUnique({ where: { id: job.userId }, select: { email: true, name: true } }),
      prisma.officeActionCase.findUnique({
        where: { id: job.caseId },
        select: { applicationNumber: true, title: true, jurisdictionCode: true }
      })
    ])
    if (!user?.email || !oaCase) return false

    const matter = [oaCase.applicationNumber, oaCase.title].filter(Boolean).join(' — ') || 'your matter'
    const caseUrl = `${SITE_URL}/office-actions/${job.caseId}`

    // The soonest deadline still ahead, so the mail carries the urgency the
    // workspace shows rather than just "it is done".
    const docs = await prisma.officeActionDocument.findMany({
      where: { caseId: job.caseId }, select: { deadlinesJson: true }
    })
    const upcoming = docs
      .flatMap(d => (d.deadlinesJson as any[]) || [])
      .filter(d => d?.dueDate && typeof d.daysRemaining === 'number' && d.daysRemaining >= 0)
      .sort((a, b) => a.daysRemaining - b.daysRemaining)[0]
    const deadlineLine = upcoming
      ? `<p style="margin:0 0 12px"><strong>${esc(upcoming.what || 'Reply')}</strong> is due ${esc(String(upcoming.dueDate))} — ${upcoming.daysRemaining} day${upcoming.daysRemaining === 1 ? '' : 's'} left.</p>`
      : ''

    const ok = outcome.status === 'COMPLETED'
    const drafted = outcome.objectionsDrafted ?? 0
    const failed = outcome.draftErrors ?? 0
    const flags = outcome.judgmentFlags ?? 0

    const subject = ok
      ? `FER reply drafted — ${oaCase.applicationNumber}`
      : `FER reply preparation stopped — ${oaCase.applicationNumber}`

    const summary = ok
      ? `<p style="margin:0 0 12px">${drafted} section${drafted === 1 ? '' : 's'} drafted${failed ? `, ${failed} could not be drafted` : ''}${flags ? `, ${flags} need${flags === 1 ? 's' : ''} your judgment` : ''}.</p>`
      : `<p style="margin:0 0 12px">The run stopped before it finished${outcome.error ? `: ${esc(outcome.error)}` : '.'}</p>
         <p style="margin:0 0 12px">Whatever had already been drafted is saved. Open the case and choose <strong>Resume preparation</strong> to continue from where it stopped — the finished sections are kept.</p>`

    const result = await sendEmail({
      to: user.email,
      toName: user.name || undefined,
      subject,
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
          <h2 style="margin:0 0 12px">${ok ? 'Your FER reply draft is ready' : 'Your FER reply run needs attention'}</h2>
          <p style="margin:0 0 12px">Matter: <strong>${esc(matter)}</strong></p>
          ${summary}
          ${deadlineLine}
          <p style="margin:0 0 12px">Every section is a draft for your review — nothing is filed automatically.</p>
          <p><a href="${caseUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px">Open the case</a></p>
        </div>
      `,
      text: ok
        ? `Your FER reply draft is ready for ${matter}. ${drafted} section(s) drafted${failed ? `, ${failed} failed` : ''}${flags ? `, ${flags} need your judgment` : ''}. Review it: ${caseUrl}`
        : `The FER reply run for ${matter} stopped before finishing${outcome.error ? `: ${outcome.error}` : ''}. Drafted sections are saved — open the case and choose "Resume preparation": ${caseUrl}`
    })
    return result?.sent !== false
  } catch (err) {
    console.warn('[OA notify] could not send the prepare outcome email:', err instanceof Error ? err.message : err)
    return false
  }
}
