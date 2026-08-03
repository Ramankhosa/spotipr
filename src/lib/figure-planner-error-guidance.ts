export type FigurePlannerErrorArea =
  | 'diagram'
  | 'render'
  | 'sketch'
  | 'suggestion'
  | 'arrange'
  | 'general'

export type FigurePlannerErrorGuidance = {
  title: string
  whatHappened: string
  actions: string[]
  autoRecovery?: string
}

function includesAny(value: string, patterns: string[]): boolean {
  return patterns.some(pattern => value.includes(pattern))
}

/**
 * Converts server/provider errors into stable, user-facing recovery guidance.
 * The original error is still shown separately under "Technical details" so
 * support information is not discarded.
 */
export function explainFigurePlannerError(
  message: string,
  area: FigurePlannerErrorArea = 'general'
): FigurePlannerErrorGuidance {
  const normalized = String(message || '').toLowerCase()

  if (includesAny(normalized, [
    'invalid structured data',
    'invalid json',
    'couldn\'t read the model',
    'could not read the model',
    'unreadable',
    'missing their titles',
    'missing title',
    'missing description'
  ])) {
    return {
      title: area === 'suggestion' ? 'The suggested views could not be read' : 'The AI reply could not be validated',
      whatHappened: 'The AI answered, but its reply did not match the structured format the Figure Planner needs.',
      actions: [
        'Try again; a fresh reply usually resolves formatting failures.',
        area === 'suggestion'
          ? 'If it repeats, add or select clearer reference figures and try again.'
          : 'If it repeats, simplify the requested figure or return to the Component Plan and confirm the invention facts.',
        'If every retry fails, ask an administrator to check this stage\'s model and output-token limit.'
      ],
      autoRecovery: area === 'suggestion'
        ? 'The server already made one correction attempt before showing this message.'
        : 'Diagram generation already retries malformed structured replies and applies safe normalization before failing.'
    }
  }

  if (includesAny(normalized, ['plantuml', 'render failed', 'syntax error', 'processing failed'])) {
    return {
      title: 'The diagram could not be rendered',
      whatHappened: 'The diagram source was created, but the renderer could not turn it into a viewable figure.',
      actions: [
        'Use Retry Render on the affected figure.',
        'If it still fails, open the advanced PlantUML editor and remove unsupported syntax, or use Modify to simplify the figure.',
        'Your saved source and other figures have not been removed.'
      ],
      autoRecovery: 'The Figure Planner automatically tried to validate, repair, and render the source once before stopping.'
    }
  }

  if (includesAny(normalized, ['timeout', 'timed out', 'network', 'failed to fetch', 'connection', 'couldn\'t reach', 'could not reach'])) {
    return {
      title: 'The request did not finish',
      whatHappened: 'The browser lost contact with the service or the operation took longer than the available request window.',
      actions: [
        'Check your connection and try the action again.',
        'For a large figure set, retry with fewer or simpler figures.',
        'If it keeps happening, ask an administrator to check the application and model-provider logs.'
      ]
    }
  }

  if (includesAny(normalized, ['model', 'provider']) && includesAny(normalized, [
    'not configured',
    'configuration',
    'unsupported',
    'no image',
    'output limit',
    'not available'
  ])) {
    return {
      title: 'This AI stage needs configuration',
      whatHappened: 'The configured model could not complete the type or size of output required by this operation.',
      actions: [
        'Ask an administrator to verify the Figure Planner model and its output-token limit.',
        area === 'sketch'
          ? 'For sketch images, the configured provider must support image generation.'
          : 'After the model configuration is updated, try the action again.'
      ]
    }
  }

  if (includesAny(normalized, ['quota', 'rate limit', 'too many requests', 'billing', 'credits', 'usage limit'])) {
    return {
      title: 'The AI service is temporarily unavailable',
      whatHappened: 'The request reached a usage, billing, or provider rate limit.',
      actions: [
        'Wait a short time and try again.',
        'If the message continues, ask an administrator to check plan usage and provider billing.'
      ]
    }
  }

  if (includesAny(normalized, ['access denied', 'unauthorized', 'forbidden', 'session not found', 'sign in', 'token'])) {
    return {
      title: 'Your session or access could not be verified',
      whatHappened: 'The operation could not confirm that this drafting session is available to your account.',
      actions: [
        'Refresh the page and sign in again if requested.',
        'Confirm that you still have access to this patent project, then retry.'
      ]
    }
  }

  if (includesAny(normalized, [
    'component plan',
    'reference map',
    'unknown component',
    'stale component',
    'invention facts',
    'at least 10 characters',
    'please upload',
    'less than 10mb',
    'at least 2 figures',
    'at least 20 description words',
    'choose at least one image',
    'no external images are ready'
  ])) {
    return {
      title: 'More input is needed',
      whatHappened: 'The Figure Planner stopped before sending an incomplete or inconsistent request.',
      actions: area === 'arrange'
        ? ['Add at least two figures before asking AI to arrange the drawing set.']
        : area === 'sketch'
          ? ['Follow the requirement in the technical details below, then try again.']
          : [
              'Complete or re-save the Component Plan so its names and reference numerals are current.',
              'Return here and retry the operation.'
            ]
    }
  }

  const areaDefaults: Record<FigurePlannerErrorArea, FigurePlannerErrorGuidance> = {
    diagram: {
      title: 'Figure generation did not complete',
      whatHappened: 'The Figure Planner stopped before it could produce a valid, saved figure set.',
      actions: [
        'Try generation again; existing figures are left unchanged after a failed run.',
        'If it repeats, request fewer figures or simplify the figure plan.',
        'Open the technical details below when reporting the problem to an administrator.'
      ]
    },
    render: {
      title: 'The figure could not be displayed',
      whatHappened: 'The saved figure source could not be converted into an image.',
      actions: ['Retry the render.', 'If it repeats, edit or simplify the source and try again.']
    },
    sketch: {
      title: 'The sketch action did not complete',
      whatHappened: 'The requested sketch operation stopped before a usable image or saved change was produced.',
      actions: [
        'Review the technical detail below and correct any prompt or file issue.',
        'Try the action again; existing sketches are not removed by a failed generation.'
      ]
    },
    suggestion: {
      title: 'Suggested views could not be generated',
      whatHappened: 'The Figure Planner could not produce a usable set of new illustration ideas.',
      actions: [
        'Try Suggest views again.',
        'Optionally select existing figures as context so the next suggestions can fill missing views.',
        'Saved suggestions and generated sketches remain available.'
      ]
    },
    arrange: {
      title: 'The drawing order could not be updated',
      whatHappened: 'The requested ordering change was not saved.',
      actions: [
        'Reload the drawing set and try again.',
        'If the order is finalized, unlock it before making changes.'
      ]
    },
    general: {
      title: 'The action did not complete',
      whatHappened: 'The Figure Planner could not finish the requested operation.',
      actions: [
        'Review the technical detail below and try the action again.',
        'If it repeats, refresh the page and report the technical detail to an administrator.'
      ]
    }
  }

  return areaDefaults[area]
}
