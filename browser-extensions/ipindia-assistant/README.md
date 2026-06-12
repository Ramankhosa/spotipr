# PatentNest IP India Assistant

User-controlled browser helper for IP India Public Search.

It does three things:

1. Receives the PatentNest session when the user clicks `IP India Search`.
2. Fills IP India Public Search with application numbers using `Application Number` + `OR`.
3. Saves the currently open patent detail page back to PatentNest only when the user clicks `Capture This Patent`.

It does not solve captcha, submit searches automatically, open every result, or crawl the IP India site.

## Install Locally

1. Open `chrome://extensions` or `brave://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select `browser-extensions/ipindia-assistant`.

## Workflow

1. In PatentNest novelty search, click `IP India Search`.
2. IP India opens with the application-number rows prefilled.
3. Solve captcha manually and click `Search`.
4. Open one result link.
5. On the patent details page, review the visible page and click `Capture This Patent`.

For production domains other than `*.patentnest.ai`, add that host to `manifest.json` under `host_permissions` and `content_scripts.matches`.
