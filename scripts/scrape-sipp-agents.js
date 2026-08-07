#!/usr/bin/env node
/**
 * Scrape the IP India SIPP / IP Mitra patent-agent facilitator directory.
 *
 *   https://iprsearch.ipindia.gov.in/DynamicUtility/Sipp/index
 *
 * The page is fully server-rendered (~1.7 MB, one <table id="SippProcess">,
 * ~940 rows, no AJAX endpoint and no pagination), so a single GET gets
 * everything. We parse it with regexes rather than a DOM library because the
 * markup is machine-generated and rigidly uniform, and this repo has no
 * cheerio dependency.
 *
 * Outputs (into --outdir, default ./data/sipp):
 *   sipp-agents.json  full records incl. derived fields
 *   sipp-agents.csv   flat CSV for CRM / mail-merge import
 *   sipp-firms.csv    email-domain clusters (firm rollup, biggest first)
 *
 * Usage:
 *   node scripts/scrape-sipp-agents.js
 *   node scripts/scrape-sipp-agents.js --outdir ./tmp --html ./cached.html
 *   node scripts/scrape-sipp-agents.js --keep-html      # save the raw page too
 */

const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://iprsearch.ipindia.gov.in/DynamicUtility/Sipp/index';

// ---------------------------------------------------------------- CLI args

function parseArgs(argv) {
  const args = { outdir: path.join(process.cwd(), 'data', 'sipp'), html: null, keepHtml: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--outdir') args.outdir = argv[++i];
    else if (a === '--html') args.html = argv[++i];
    else if (a === '--keep-html') args.keepHtml = true;
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// ---------------------------------------------------------------- fetching

async function fetchPage() {
  // Government host, single request — be polite and identify ourselves.
  const res = await fetch(SOURCE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`GET ${SOURCE_URL} -> HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 100_000) {
    throw new Error(
      `Response is only ${html.length} bytes — expected ~1.7 MB. The page layout may have changed, or we were served an error/block page.`,
    );
  }
  return html;
}

// ---------------------------------------------------------------- parsing

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

function decode(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Strip tags, decode entities, collapse whitespace. */
function cellText(html) {
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** "NOT AVAILABLE", "NA", "-", "" all mean absent. */
function nullIfBlank(v) {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (/^(na|n\/a|not available|nil|-{1,})$/i.test(t)) return null;
  return t;
}

/** dd/mm/yyyy -> yyyy-mm-dd (null if unparseable). */
function toIsoDate(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v || '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function daysBetween(isoFrom, isoTo) {
  if (!isoFrom || !isoTo) return null;
  const ms = Date.parse(`${isoTo}T00:00:00Z`) - Date.parse(`${isoFrom}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/**
 * The contact cell looks like:
 *   "Mobile No:  9210310850,  Email ID:  anu_gupta31@yahoo.com"
 * Some rows carry several numbers or addresses, or "NA" for either.
 */
function parseContact(text) {
  const emails = [
    ...new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) =>
        e.toLowerCase().replace(/[.,;]+$/, ''),
      ),
    ),
  ];

  // Only look for phone digits in the segment before "Email ID" so we never
  // pick up digits that are part of an address or an email local-part.
  const mobileSegment = text.split(/Email\s*ID/i)[0] || '';
  const mobiles = [
    ...new Set(
      (mobileSegment.match(/\d[\d\s-]{7,}\d/g) || [])
        .map((m) => m.replace(/\D/g, ''))
        .map((m) => (m.length === 12 && m.startsWith('91') ? m.slice(2) : m))
        .map((m) => (m.length === 11 && m.startsWith('0') ? m.slice(1) : m))
        .filter((m) => /^[6-9]\d{9}$/.test(m)), // valid Indian mobile
    ),
  ];

  return { emails, mobiles };
}

/** "NEW DELHI/ Delhi" -> { city, state } */
function parseLocation(text) {
  const [cityRaw, ...rest] = text.split('/');
  return {
    city: nullIfBlank(cityRaw),
    state: nullIfBlank(rest.join('/')),
  };
}

function parseRows(html) {
  const table = /<table[^>]*id="SippProcess"[\s\S]*?<\/table>/i.exec(html);
  if (!table) throw new Error('Could not find <table id="SippProcess"> — page layout changed.');

  const tbody = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(table[0]);
  if (!tbody) throw new Error('Could not find <tbody> in the results table — page layout changed.');

  const trs = tbody[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const records = [];
  const skipped = [];

  for (const tr of trs) {
    const tds = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (tds.length < 9) {
      skipped.push(cellText(tr).slice(0, 120));
      continue;
    }
    const c = tds.map(cellText);

    // Column 0 is an <input type="submit" value="IN/PA-1514" />, so the agent
    // number lives in the value attribute, not in the cell text.
    const agentNumber =
      nullIfBlank((/value="([^"]*)"/i.exec(tds[0]) || [])[1] || '') || nullIfBlank(c[0]);
    if (!agentNumber) {
      skipped.push(c.join(' | ').slice(0, 120));
      continue;
    }

    const { emails, mobiles } = parseContact(c[3]);
    const { city, state } = parseLocation(c[4]);

    records.push({
      agentNumber,
      name: nullIfBlank(c[1]),
      principalPlaceOfBusiness: nullIfBlank(c[2]),
      emails,
      mobiles,
      city,
      state,
      specializations: nullIfBlank(c[5])
        ? c[5].split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      registrationDate: toIsoDate(c[6]),
      continuedUpto: toIsoDate(c[7]),
      statusText: nullIfBlank(c[8]),
    });
  }

  return { records, skipped };
}

// ---------------------------------------------------------------- derived fields

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com',
  'rediffmail.com', 'rediff.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'protonmail.com', 'proton.me',
  'mail.com', 'zoho.com', 'zohomail.com', 'sify.com', 'vsnl.net', 'vsnl.com',
  'indiatimes.com', 'in.com', 'gmail.co.in', 'googlemail.com',
]);

// Maps the directory's free-text specializations onto PatentNest's drafting
// verticals. Order matters: first matching pattern wins.
const BUCKETS = [
  [/COMPUTER|SOFTWARE|INFORMATION|IT\b|DATA|ARTIFICIAL/i, 'software'],
  [/ELECTRON|ELECTRIC|COMMUNICAT|TELECOM|INSTRUMENT|SEMICONDUCT/i, 'electronics'],
  [/BIOMEDICAL|BIOTECH|PHARMA|MEDIC|LIFE\s*SCIENCE|MICROBIO|GENET/i, 'life-sciences'],
  [/CHEMI|POLYMER|MATERIAL|METALLURG|PETRO/i, 'chemistry'],
  [/MECHANIC|CIVIL|AUTOMOB|AERO|PRODUCTION|INDUSTRIAL|TEXTILE|AGRI|FOOD/i, 'mechanical'],
  [/DESIGN|TRADE\s*MARK|COPYRIGHT|LAW|LEGAL/i, 'non-patent'],
];

const TIER1_CITIES = [
  /DELHI|GURGAON|GURUGRAM|NOIDA|GHAZIABAD|FARIDABAD/i,
  /MUMBAI|BOMBAY|THANE|NAVI\s*MUMBAI/i,
  /BANGALORE|BENGALURU/i,
  /CHENNAI|MADRAS/i,
  /HYDERABAD|SECUNDERABAD/i,
  /PUNE/i,
  /KOLKATA|CALCUTTA/i,
  /AHMEDABAD/i,
];

// Address segments that are a place or a placeholder rather than a firm name.
// Without this, "BANGALORE" and "NOT APPLICABLE" become the largest "firms".
const NOT_A_FIRM = new Set(
  [
    // placeholders
    'NOT APPLICABLE', 'NOT AVAILABLE', 'NONE', 'NILL', 'SAME AS ABOVE', 'ADDRESS',
    'RESIDENCE', 'HOME', 'OFFICE', 'SELF', 'FREELANCER', 'INDEPENDENT', 'PRACTICE',
    'INDIA', 'PRINCIPAL PLACE OF BUSINESS',
    // cities
    'DELHI', 'NEW DELHI', 'MUMBAI', 'BOMBAY', 'NAVI MUMBAI', 'THANE', 'PUNE',
    'BANGALORE', 'BENGALURU', 'CHENNAI', 'MADRAS', 'HYDERABAD', 'SECUNDERABAD',
    'KOLKATA', 'CALCUTTA', 'AHMEDABAD', 'SURAT', 'VADODARA', 'RAJKOT', 'JAIPUR',
    'LUCKNOW', 'KANPUR', 'NAGPUR', 'INDORE', 'BHOPAL', 'PATNA', 'RANCHI', 'RAIPUR',
    'NOIDA', 'GREATER NOIDA', 'GHAZIABAD', 'GURGAON', 'GURUGRAM', 'FARIDABAD',
    'CHANDIGARH', 'MOHALI', 'PANCHKULA', 'LUDHIANA', 'AMRITSAR', 'JALANDHAR',
    'COIMBATORE', 'MADURAI', 'TRICHY', 'SALEM', 'ERODE', 'VELLORE', 'TIRUPUR',
    'KOCHI', 'COCHIN', 'ERNAKULAM', 'TRIVANDRUM', 'THIRUVANANTHAPURAM', 'KOZHIKODE',
    'THRISSUR', 'KOTTAYAM', 'MYSORE', 'MYSURU', 'MANGALORE', 'HUBLI', 'BELGAUM',
    'VISAKHAPATNAM', 'VIJAYAWADA', 'GUNTUR', 'TIRUPATI', 'WARANGAL', 'NELLORE',
    'BHUBANESWAR', 'CUTTACK', 'GUWAHATI', 'SILIGURI', 'DEHRADUN', 'HARIDWAR',
    'VARANASI', 'ALLAHABAD', 'PRAYAGRAJ', 'AGRA', 'MEERUT', 'BAREILLY', 'ALIGARH',
    'JODHPUR', 'UDAIPUR', 'KOTA', 'AJMER', 'JAMMU', 'SRINAGAR', 'SHIMLA', 'GANDHINAGAR',
    'ANAND', 'BHAVNAGAR', 'JAMNAGAR', 'NASHIK', 'NASIK', 'AURANGABAD', 'KOLHAPUR',
    'SOLAPUR', 'AMRAVATI', 'JABALPUR', 'GWALIOR', 'UJJAIN', 'JAMSHEDPUR', 'DHANBAD',
    // states / UTs
    'MAHARASHTRA', 'KARNATAKA', 'TAMIL NADU', 'TAMILNADU', 'KERALA', 'GUJARAT',
    'RAJASTHAN', 'RAJASTAN', 'PUNJAB', 'HARYANA', 'UTTAR PRADESH', 'MADHYA PRADESH',
    'ANDHRA PRADESH', 'TELANGANA', 'WEST BENGAL', 'BIHAR', 'ODISHA', 'ORISSA',
    'JHARKHAND', 'ASSAM', 'CHHATTISGARH', 'UTTARAKHAND', 'GOA', 'HIMACHAL PRADESH',
    'JAMMU KASHMIR', 'PUDUCHERRY', 'PONDICHERRY',
  ].map((s) => s.toUpperCase()),
);

/**
 * Most facilitators list a gmail/yahoo address even when they work at a firm,
 * so email-domain clustering alone finds almost no firms. The address field
 * usually leads with the firm name ("KRISHNA & SAURASTRI, 74-F, VENUS, ...")
 * — take the first comma-separated segment and normalise it into a join key.
 */
function firmKeyFromAddress(address) {
  if (!address) return null;
  let head = address.split(',')[0];

  // A leading segment that is really a street/unit line, not a firm name.
  if (/^\s*(?:#|\d|flat|plot|door|no\.?\s|h\.?no|room|shop|survey|khasra)/i.test(head)) return null;

  head = head
    .replace(/\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|co\.?)\b/gi, ' ')
    .replace(/\b(ip|intellectual\s*property|patent|patents|trade\s*marks?|attorneys?|advocates?|associates?|partners?|consultants?|services?|solutions?|and|&)\b/gi, ' ')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // After stripping boilerplate, anything too short is noise ("THE", "M S").
  if (head.length < 4) return null;
  if (NOT_A_FIRM.has(head)) return null;

  // Unit/building lines that survived the leading-character check:
  // "A 1304", "B 603", "SCITECH ART PLOT NO 17 22".
  if (/^[A-Z]{1,2}\s*\d/.test(head)) return null;
  if (/\b(PLOT|SURVEY|GALA|WING|BLOCK|SECTOR|PHASE|FLOOR)\b/.test(head)) return null;
  const digits = (head.match(/\d/g) || []).length;
  if (digits / head.length > 0.2) return null;

  // "PUNE MAHARASHTRA" — every token is a place, so it is an address, not a firm.
  const tokens = head.split(' ');
  if (tokens.every((t) => NOT_A_FIRM.has(t))) return null;

  return head;
}

function bucketOf(spec) {
  for (const [re, bucket] of BUCKETS) if (re.test(spec)) return bucket;
  return 'other';
}

function enrich(records, todayIso) {
  // Pass 1: per-record domain, so pass 2 can count firm clusters.
  for (const r of records) {
    const primaryEmail = r.emails[0] || null;
    r.primaryEmail = primaryEmail;
    r.primaryMobile = r.mobiles[0] || null;
    r.emailDomain = primaryEmail ? primaryEmail.split('@')[1] : null;
    r.isPersonalDomain = r.emailDomain ? PERSONAL_DOMAINS.has(r.emailDomain) : null;
    r.contactable = Boolean(primaryEmail);
  }

  const domainCounts = new Map();
  const firmNameCounts = new Map();
  for (const r of records) {
    if (r.emailDomain && !r.isPersonalDomain) {
      domainCounts.set(r.emailDomain, (domainCounts.get(r.emailDomain) || 0) + 1);
    }
    r.firmKey = firmKeyFromAddress(r.principalPlaceOfBusiness);
    if (r.firmKey) firmNameCounts.set(r.firmKey, (firmNameCounts.get(r.firmKey) || 0) + 1);
  }

  for (const r of records) {
    // A firm is evidenced by either a shared corporate mail domain or a shared
    // firm name in the address; take whichever gives the larger cluster.
    const byDomain = r.emailDomain && !r.isPersonalDomain ? domainCounts.get(r.emailDomain) : 1;
    const byName = r.firmKey ? firmNameCounts.get(r.firmKey) : 1;
    r.firmSize = Math.max(byDomain || 1, byName || 1);
    r.firmCluster = (byName || 1) >= (byDomain || 1) ? r.firmKey : r.emailDomain;
    r.isSolo = r.contactable ? r.firmSize === 1 : null;

    const buckets = [...new Set(r.specializations.map(bucketOf))];
    r.specializationBuckets = buckets;
    r.primaryBucket = buckets[0] || null;
    r.isGeneralist = buckets.length > 2;

    r.cityTier = r.city && TIER1_CITIES.some((re) => re.test(r.city)) ? 1 : 2;

    r.yearsRegistered = r.registrationDate
      ? Math.round((daysBetween(r.registrationDate, todayIso) / 365.25) * 10) / 10
      : null;
    r.daysToExpiry = daysBetween(todayIso, r.continuedUpto);
    r.expiryBucket =
      r.daysToExpiry === null ? null
        : r.daysToExpiry < 0 ? 'expired'
        : r.daysToExpiry <= 90 ? 'expiring-90d'
        : r.daysToExpiry <= 365 ? 'expiring-1y'
        : 'current';

    // Outreach priority: solo + high-value vertical + tier-1 ranks first.
    r.outreachTier = !r.contactable ? 4
      : r.isSolo && ['software', 'electronics'].includes(r.primaryBucket) && r.cityTier === 1 ? 1
      : r.firmSize >= 2 ? 2 // this roster is overwhelmingly solo; 2+ is already a firm motion
      : 3;
  }

  return records;
}

// ---------------------------------------------------------------- output

function toCsv(rows, columns) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

const AGENT_COLUMNS = [
  'agentNumber', 'name', 'primaryEmail', 'primaryMobile', 'city', 'state', 'cityTier',
  'emailDomain', 'isPersonalDomain', 'firmCluster', 'firmSize', 'isSolo', 'outreachTier',
  'primaryBucket', 'specializationBuckets', 'specializations', 'isGeneralist',
  'registrationDate', 'yearsRegistered', 'continuedUpto', 'daysToExpiry', 'expiryBucket',
  'principalPlaceOfBusiness', 'emails', 'mobiles', 'statusText',
];

function buildFirms(records) {
  const clusters = new Map();
  for (const r of records) {
    if (!r.firmCluster || r.firmSize < 2) continue;
    if (!clusters.has(r.firmCluster)) {
      clusters.set(r.firmCluster, {
        firmCluster: r.firmCluster, agentCount: 0, cities: new Set(),
        states: new Set(), buckets: new Set(), agents: [],
      });
    }
    const f = clusters.get(r.firmCluster);
    f.agentCount++;
    if (r.city) f.cities.add(r.city);
    if (r.state) f.states.add(r.state);
    for (const b of r.specializationBuckets) f.buckets.add(b);
    f.agents.push(`${r.name} <${r.primaryEmail || 'no-email'}>`);
  }
  return [...clusters.values()]
    .map((f) => ({
      firmCluster: f.firmCluster,
      agentCount: f.agentCount,
      cities: [...f.cities],
      states: [...f.states],
      buckets: [...f.buckets],
      agents: f.agents,
    }))
    .sort((a, b) => b.agentCount - a.agentCount || a.firmCluster.localeCompare(b.firmCluster));
}

function summarize(records) {
  const tally = (fn) =>
    records.reduce((acc, r) => {
      const k = String(fn(r));
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  return {
    total: records.length,
    withEmail: records.filter((r) => r.primaryEmail).length,
    withMobile: records.filter((r) => r.primaryMobile).length,
    solo: records.filter((r) => r.isSolo).length,
    byOutreachTier: tally((r) => r.outreachTier),
    byBucket: tally((r) => r.primaryBucket),
    byExpiry: tally((r) => r.expiryBucket),
    byCityTier: tally((r) => r.cityTier),
    topStates: Object.entries(tally((r) => r.state))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  };
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const todayIso = new Date().toISOString().slice(0, 10);

  const html = args.html
    ? fs.readFileSync(args.html, 'utf8')
    : await fetchPage();
  console.log(`Loaded ${html.length.toLocaleString()} bytes from ${args.html || SOURCE_URL}`);

  const { records, skipped } = parseRows(html);
  if (!records.length) throw new Error('Parsed zero rows — page layout changed.');
  if (skipped.length) console.warn(`Skipped ${skipped.length} malformed row(s).`);

  // The directory has repeated an agent number before; last row wins.
  const byNumber = new Map();
  for (const r of records) byNumber.set(r.agentNumber, r);
  const deduped = [...byNumber.values()];
  if (deduped.length !== records.length) {
    console.warn(`Collapsed ${records.length - deduped.length} duplicate agent number(s).`);
  }

  enrich(deduped, todayIso);
  deduped.sort((a, b) => a.outreachTier - b.outreachTier || a.agentNumber.localeCompare(b.agentNumber));

  fs.mkdirSync(args.outdir, { recursive: true });
  const out = (f) => path.join(args.outdir, f);

  const summary = summarize(deduped);
  fs.writeFileSync(
    out('sipp-agents.json'),
    JSON.stringify({ source: SOURCE_URL, scrapedAt: new Date().toISOString(), summary, agents: deduped }, null, 2),
  );
  fs.writeFileSync(out('sipp-agents.csv'), toCsv(deduped, AGENT_COLUMNS));

  const firms = buildFirms(deduped);
  fs.writeFileSync(
    out('sipp-firms.csv'),
    toCsv(firms, ['firmCluster', 'agentCount', 'cities', 'states', 'buckets', 'agents']),
  );
  if (args.keepHtml && !args.html) fs.writeFileSync(out('sipp-raw.html'), html);

  console.log(`\nWrote ${deduped.length} agents to ${args.outdir}`);
  console.log(`  sipp-agents.json / sipp-agents.csv`);
  console.log(`  sipp-firms.csv (${firms.length} firm domains)`);
  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
