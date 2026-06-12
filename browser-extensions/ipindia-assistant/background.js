const SESSION_KEY = 'patentnest_ipindia_session'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false

  if (message.type === 'PATENTNEST_STORE_SESSION') {
    const token = typeof message.token === 'string' ? message.token : ''
    const appOrigin = typeof message.appOrigin === 'string' ? message.appOrigin : ''
    if (!token || !/^https?:\/\//.test(appOrigin)) {
      sendResponse({ ok: false, error: 'Invalid PatentNest session payload.' })
      return false
    }

    chrome.storage.session.set({
      [SESSION_KEY]: {
        token,
        appOrigin: appOrigin.replace(/\/$/, ''),
        storedAt: new Date().toISOString(),
      },
    }).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: error?.message || String(error) })
    )
    return true
  }

  if (message.type === 'PATENTNEST_CAPTURE_IPINDIA_DETAILS') {
    chrome.storage.session.get(SESSION_KEY).then(async result => {
      const session = result[SESSION_KEY]
      if (!session?.token || !session?.appOrigin) {
        sendResponse({
          ok: false,
          error: 'PatentNest session not found. Go back to PatentNest and click IP India Search again.',
        })
        return
      }

      try {
        const response = await fetch(`${session.appOrigin}/api/patent-corpus/ipindia-captures`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message.payload || {}),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status, error: body.error || 'PatentNest save failed.' })
          return
        }
        sendResponse({ ok: true, body })
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) })
      }
    })
    return true
  }

  return false
})
