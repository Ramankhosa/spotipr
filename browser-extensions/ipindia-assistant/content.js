(function () {
  const IP_INDIA_HOST = 'iprsearch.ipindia.gov.in'
  const PANEL_ID = 'patentnest-ipindia-assistant'
  const MAX_FIELDS = 16

  function isPatentNestApp() {
    return (
      location.hostname === 'localhost' ||
      location.hostname.endsWith('.patentnest.ai')
    )
  }

  function isIpIndia() {
    return location.hostname === IP_INDIA_HOST
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function normalizeLabel(value) {
    return cleanText(value).replace(/:$/, '').toLowerCase()
  }

  function dispatchValue(element, value) {
    if (!element) return
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function parsePayloadFromHash() {
    const match = location.hash.match(/(?:^|#|&)patentnest=([^&]+)/)
    if (!match) return null
    try {
      const payload = JSON.parse(decodeURIComponent(match[1]))
      if (!Array.isArray(payload.applicationNumbers)) return null
      return {
        ...payload,
        applicationNumbers: payload.applicationNumbers
          .map(value => cleanText(value).replace(/\D/g, ''))
          .filter(Boolean)
          .slice(0, MAX_FIELDS),
      }
    } catch {
      return null
    }
  }

  function installPanel(html) {
    document.getElementById(PANEL_ID)?.remove()
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.innerHTML = html
    document.body.appendChild(panel)
    return panel
  }

  function panelShell(title, body) {
    return `
      <style>
        #${PANEL_ID} {
          position: fixed;
          right: 18px;
          top: 88px;
          z-index: 2147483647;
          width: min(360px, calc(100vw - 36px));
          border: 1px solid #bfdbfe;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
          color: #0f172a;
          font-family: Arial, sans-serif;
          font-size: 13px;
        }
        #${PANEL_ID} .pn-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid #dbeafe;
          background: #eff6ff;
          font-weight: 700;
        }
        #${PANEL_ID} .pn-body { padding: 12px; }
        #${PANEL_ID} .pn-row { margin-top: 8px; }
        #${PANEL_ID} button {
          border: 1px solid #1d4ed8;
          border-radius: 5px;
          background: #1d4ed8;
          color: #fff;
          cursor: pointer;
          font-size: 12px;
          font-weight: 700;
          padding: 7px 9px;
        }
        #${PANEL_ID} button.secondary {
          border-color: #cbd5e1;
          background: #fff;
          color: #334155;
        }
        #${PANEL_ID} .pn-muted { color: #64748b; font-size: 12px; line-height: 1.45; }
        #${PANEL_ID} .pn-status { margin-top: 8px; font-size: 12px; line-height: 1.45; }
        #${PANEL_ID} .pn-error { color: #b91c1c; }
        #${PANEL_ID} .pn-success { color: #047857; }
        #${PANEL_ID} textarea {
          width: 100%;
          min-height: 80px;
          box-sizing: border-box;
          border: 1px solid #cbd5e1;
          border-radius: 5px;
          font-size: 12px;
          padding: 6px;
        }
      </style>
      <div class="pn-header">
        <span>${title}</span>
        <button type="button" class="secondary" data-pn-close>Close</button>
      </div>
      <div class="pn-body">${body}</div>
    `
  }

  function bindClose(panel) {
    panel.querySelector('[data-pn-close]')?.addEventListener('click', () => panel.remove())
  }

  function currentSearchRows() {
    return Array.from(document.querySelectorAll('#dynamic-fields-container .search-row'))
  }

  function ensureSearchRows(count) {
    const addButton = document.getElementById('btnAddRow')
    let rows = currentSearchRows()
    while (rows.length < count && rows.length < MAX_FIELDS && addButton) {
      addButton.click()
      rows = currentSearchRows()
    }
    return rows
  }

  function fillSearchFields(payload) {
    const numbers = payload.applicationNumbers.slice(0, MAX_FIELDS)
    if (!numbers.length) return { ok: false, message: 'No application numbers found in PatentNest payload.' }

    const published = document.getElementById('Published')
    const granted = document.getElementById('Granted')
    if (published) {
      published.checked = true
      published.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (granted) {
      granted.checked = false
      granted.dispatchEvent(new Event('change', { bubbles: true }))
    }

    const rows = ensureSearchRows(numbers.length)
    numbers.forEach((number, index) => {
      const rowNumber = index + 1
      const row = rows[index] || document
      dispatchValue(row.querySelector(`select[name="ItemField${rowNumber}"]`), 'AP')
      dispatchValue(row.querySelector(`input[name="TextField${rowNumber}"]`), number)
      dispatchValue(row.querySelector(`select[name="LogicField${rowNumber}"]`), 'OR')
    })

    document.getElementById('CaptchaText')?.focus()
    return { ok: true, message: `Loaded ${numbers.length} application number(s). Solve captcha, then click Search.` }
  }

  function injectSearchAssistant(payload) {
    const numbersText = payload.applicationNumbers.join('\n')
    const panel = installPanel(panelShell('PatentNest IP India Search', `
      <div class="pn-muted">Application numbers are prepared from PatentNest references. Captcha and search submission stay under your control.</div>
      <div class="pn-row"><textarea readonly>${numbersText}</textarea></div>
      <div class="pn-row">
        <button type="button" data-pn-fill>Fill Search Fields</button>
        <button type="button" class="secondary" data-pn-copy>Copy</button>
      </div>
      <div class="pn-status" data-pn-status></div>
    `))
    bindClose(panel)

    const status = panel.querySelector('[data-pn-status]')
    const runFill = () => {
      const result = fillSearchFields(payload)
      status.textContent = result.message
      status.className = `pn-status ${result.ok ? 'pn-success' : 'pn-error'}`
    }

    panel.querySelector('[data-pn-fill]')?.addEventListener('click', runFill)
    panel.querySelector('[data-pn-copy]')?.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(numbersText)
      status.textContent = 'Application numbers copied.'
      status.className = 'pn-status pn-success'
    })

    window.setTimeout(runFill, 500)
  }

  function rowValueMap() {
    const map = new Map()
    document.querySelectorAll('tr').forEach(row => {
      const cells = Array.from(row.children)
      if (cells.length < 2) return
      const label = normalizeLabel(cells[0].innerText || cells[0].textContent)
      const value = cleanText(cells.slice(1).map(cell => cell.innerText || cell.textContent).join(' '))
      if (label && value && value !== label) map.set(label, value)
    })
    return map
  }

  function pickLabel(map, labels) {
    for (const label of labels) {
      const normalized = normalizeLabel(label)
      for (const [key, value] of map.entries()) {
        if (key === normalized || key.includes(normalized)) return value
      }
    }
    return ''
  }

  function textBetween(haystack, startPattern, endPattern) {
    const startMatch = haystack.match(startPattern)
    if (!startMatch) return ''
    const start = startMatch.index + startMatch[0].length
    const rest = haystack.slice(start)
    const endMatch = rest.match(endPattern)
    return cleanText(endMatch ? rest.slice(0, endMatch.index) : rest)
  }

  function iframeTexts() {
    return Array.from(document.querySelectorAll('iframe')).map(frame => {
      try {
        return cleanText(frame.contentDocument?.body?.innerText || '')
      } catch {
        return ''
      }
    }).filter(Boolean)
  }

  function extractCompleteSpecificationText() {
    const candidates = [
      ...iframeTexts(),
      ...Array.from(document.querySelectorAll('textarea, pre, [style*="overflow"], div, td'))
        .map(element => cleanText(element.innerText || element.textContent))
        .filter(text => /claims?|i\/we claim|complete specification/i.test(text)),
    ]
    const best = candidates.sort((a, b) => b.length - a.length)[0]
    if (best && best.length > 100) return best

    return textBetween(
      cleanText(document.body.innerText),
      /complete specification/i,
      /terms\s*&\s*conditions|copyright|page last updated/i
    )
  }

  function splitSpecification(completeSpecificationText) {
    const marker = completeSpecificationText.search(/(?:^|\n)\s*(claims?|i\/we claim|we claim|i claim)\b/i)
    if (marker < 0) {
      return {
        descriptionText: cleanText(completeSpecificationText),
        claimsText: '',
      }
    }
    return {
      descriptionText: cleanText(completeSpecificationText.slice(0, marker)),
      claimsText: cleanText(completeSpecificationText.slice(marker)),
    }
  }

  function parsePatentDetails() {
    const map = rowValueMap()
    const bodyText = cleanText(document.body.innerText)
    const completeSpecificationText = extractCompleteSpecificationText()
    const split = splitSpecification(completeSpecificationText)
    const abstractFromBody = textBetween(bodyText, /abstract\s*:?/i, /complete specification/i)

    return {
      sourceUrl: location.href,
      title: pickLabel(map, ['Invention Title']),
      publicationNumber: pickLabel(map, ['Publication Number']),
      publicationDate: pickLabel(map, ['Publication Date']),
      publicationType: pickLabel(map, ['Publication Type']),
      applicationNumber: pickLabel(map, ['Application Number']),
      applicationFilingDate: pickLabel(map, ['Application Filing Date']),
      fieldOfInvention: pickLabel(map, ['Field Of Invention', 'Field of Invention']),
      classifications: pickLabel(map, ['Classification (IPC)', 'International Patent Classification']),
      abstract: pickLabel(map, ['Abstract']) || abstractFromBody,
      completeSpecificationText,
      descriptionText: split.descriptionText,
      claimsText: split.claimsText,
      capturedAt: new Date().toISOString(),
    }
  }

  function injectDetailsCaptureAssistant() {
    const panel = installPanel(panelShell('PatentNest Detail Capture', `
      <div class="pn-muted">Open one patent details page, review it, then save the visible claims/specification to PatentNest.</div>
      <div class="pn-row">
        <button type="button" data-pn-capture>Capture This Patent</button>
      </div>
      <div class="pn-status" data-pn-status></div>
    `))
    bindClose(panel)

    const status = panel.querySelector('[data-pn-status]')
    panel.querySelector('[data-pn-capture]')?.addEventListener('click', () => {
      const payload = parsePatentDetails()
      status.textContent = 'Saving to PatentNest...'
      status.className = 'pn-status'
      chrome.runtime.sendMessage({
        type: 'PATENTNEST_CAPTURE_IPINDIA_DETAILS',
        payload,
      }, response => {
        if (!response?.ok) {
          status.textContent = response?.error || 'Capture failed.'
          status.className = 'pn-status pn-error'
          return
        }
        const saved = response.body?.patent?.publicationNumber || payload.applicationNumber || 'patent'
        status.textContent = `Saved ${saved} to PatentNest.`
        status.className = 'pn-status pn-success'
      })
    })
  }

  function injectResultsAssistant() {
    const panel = installPanel(panelShell('PatentNest Result Review', `
      <div class="pn-muted">Open result links one by one. On each patent details page, click Capture This Patent when you want to save claims/specification.</div>
    `))
    bindClose(panel)
  }

  if (isPatentNestApp()) {
    window.addEventListener('message', event => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.type !== 'PATENTNEST_IPINDIA_SESSION') return
      chrome.runtime.sendMessage({
        type: 'PATENTNEST_STORE_SESSION',
        token: data.token,
        appOrigin: data.appOrigin || location.origin,
      })
    })
    return
  }

  if (!isIpIndia()) return

  const path = location.pathname.toLowerCase()
  const payload = parsePayloadFromHash()
  if (path.includes('/publicationsearch/patentdetails')) {
    injectDetailsCaptureAssistant()
    return
  }
  if (path.includes('/publicationsearch/search')) {
    injectResultsAssistant()
    return
  }
  if (payload && (path.endsWith('/publicsearch/') || path.endsWith('/publicsearch'))) {
    injectSearchAssistant(payload)
  }
})()
