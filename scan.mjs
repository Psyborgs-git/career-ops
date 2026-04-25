#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches ATS APIs where available and falls back to live Playwright scans
 * for custom careers pages, applies title filters from portals.yml,
 * deduplicates against existing history, and appends new offers to
 * pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + Playwright.
 *
 * Usage:
 *   node scan.mjs                  # scan all enabled companies
 *   node scan.mjs --dry-run        # preview without writing files
 *   node scan.mjs --company Cohere # scan a single company
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;
const PLAYWRIGHT_TIMEOUT_MS = 15_000;
const PLAYWRIGHT_HYDRATE_MS = 2_000;
const MAX_PLAYWRIGHT_LINKS = 300;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  if (company.api_provider && company.api) {
    return { type: company.api_provider, url: company.api };
  }

  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Teamtailor RSS
  const teamtailorMatch = url.match(/([a-z0-9-]+)\.teamtailor\.com(?:\/jobs(?:\.rss)?)?/i);
  if (teamtailorMatch) {
    return {
      type: 'teamtailor',
      url: `https://${teamtailorMatch[1]}.teamtailor.com/jobs.rss`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
    };
  }

  return null;
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
  }));
}

function parseTeamtailor(xml, companyName) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.map(([, item]) => ({
    title: decodeXml(matchTag(item, 'title')),
    url: decodeXml(matchTag(item, 'link')),
    company: companyName,
    location: '',
  })).filter(job => job.title && job.url);
}

const PARSERS = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
  teamtailor: parseTeamtailor,
};

function matchTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function decodeXml(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());

  return (title) => {
    const lower = title.toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

function loadSeenUrls() {
  const seen = new Set();

  // scan-history.tsv
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x!]\] (https?:\/\/\S+)/g)) {
      seen.add(match[1]);
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(match[0]);
    }
  }

  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    // Parse markdown table rows: | # | Date | Company | Role | ...
    for (const match of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) {
      const company = match[1].trim().toLowerCase();
      const role = match[2].trim().toLowerCase();
      if (company && role && company !== 'company') {
        seen.add(`${company}::${role}`);
      }
    }
  }
  return seen;
}

// ── Pipeline writer ─────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

function normalizeText(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

function looksLikeJobLink(url = '') {
  return /\/(jobs?|job-boards|careers?|positions?|openings?|roles?)\b|jobs\.(ashbyhq|lever)\.com|greenhouse\.io|workable\.com|smartrecruiters\.com|teamtailor\.com|myworkdayjobs\.com|workdayjobs\.com/i.test(url);
}

function looksLikeListingsHub(text = '') {
  return /\b(all jobs|view jobs|open roles|open positions|browse jobs|see all jobs|explore roles|join us|careers)\b/i.test(text);
}

async function extractJobLinks(page) {
  return page.evaluate(({ maxLinks }) => {
    const hiddenByTree = (element) =>
      Boolean(element.closest('nav, header, footer, [aria-hidden="true"], [hidden]'));

    const visible = (element) => {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (!element.getClientRects().length) return false;
      return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    };

    return Array.from(document.querySelectorAll('a[href]'))
      .filter((anchor) => !hiddenByTree(anchor) && visible(anchor))
      .map((anchor) => {
        const title = [
          anchor.innerText,
          anchor.getAttribute('aria-label'),
          anchor.getAttribute('title'),
        ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

        return {
          title,
          url: anchor.href,
        };
      })
      .filter((entry) => entry.title.length >= 4 && entry.title.length <= 160)
      .slice(0, maxLinks);
  }, { maxLinks: MAX_PLAYWRIGHT_LINKS });
}

async function collectPageJobs(page, companyName) {
  const candidates = await extractJobLinks(page);
  const jobs = [];
  const hubs = [];

  for (const candidate of candidates) {
    if (!candidate.url || candidate.url.startsWith('mailto:') || candidate.url.startsWith('tel:')) continue;
    if (looksLikeJobLink(candidate.url)) {
      jobs.push({
        title: normalizeText(candidate.title),
        url: candidate.url,
        company: companyName,
        location: '',
      });
      continue;
    }
    if (looksLikeListingsHub(candidate.title) || looksLikeListingsHub(candidate.url)) {
      hubs.push(candidate.url);
    }
  }

  return {
    jobs: dedupeJobs(jobs),
    hubs,
  };
}

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.url}::${job.title}`;
    if (!job.url || !job.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanCareersPage(browser, company) {
  const page = await browser.newPage();

  try {
    await page.goto(company.careers_url, {
      waitUntil: 'domcontentloaded',
      timeout: PLAYWRIGHT_TIMEOUT_MS,
    });
    await page.waitForTimeout(PLAYWRIGHT_HYDRATE_MS);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(500);

    let { jobs, hubs } = await collectPageJobs(page, company.name);

    if (jobs.length === 0 && hubs.length > 0) {
      const nextUrl = hubs.find((url) => {
        try {
          const candidate = new URL(url);
          const current = new URL(company.careers_url);
          return candidate.origin === current.origin || looksLikeJobLink(url);
        } catch {
          return false;
        }
      });

      if (nextUrl) {
        await page.goto(nextUrl, {
          waitUntil: 'domcontentloaded',
          timeout: PLAYWRIGHT_TIMEOUT_MS,
        });
        await page.waitForTimeout(PLAYWRIGHT_HYDRATE_MS);
        ({ jobs } = await collectPageJobs(page, company.name));
      }
    }

    return dedupeJobs(jobs);
  } finally {
    await page.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);

  // 2. Filter to enabled companies
  const enabledCompanies = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany));

  const targets = enabledCompanies.map(c => ({ ...c, _api: detectApi(c) }));
  const apiTargets = targets.filter(c => c._api !== null && c.scan_method !== 'playwright');
  const pageTargets = targets.filter(c => c.careers_url && (c._api === null || c.scan_method === 'playwright'));
  const skippedCount = enabledCompanies.length - new Set([...apiTargets, ...pageTargets]).size;

  console.log(
    `Scanning ${apiTargets.length} companies via API and ${pageTargets.length} via Playwright (${skippedCount} skipped)`
  );
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = apiTargets.map(company => async () => {
    const { type, url } = company._api;
    try {
      const payload = type === 'teamtailor' ? await fetchText(url) : await fetchJson(url);
      const jobs = PARSERS[type](payload, company.name);
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        if (seenUrls.has(job.url)) {
          totalDupes++;
          continue;
        }
        const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
        if (seenCompanyRoles.has(key)) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(job.url);
        seenCompanyRoles.add(key);
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  if (pageTargets.length > 0) {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const company of pageTargets) {
        try {
          const jobs = await scanCareersPage(browser, company);
          totalFound += jobs.length;

          for (const job of jobs) {
            if (!titleFilter(job.title)) {
              totalFiltered++;
              continue;
            }
            if (seenUrls.has(job.url)) {
              totalDupes++;
              continue;
            }
            const key = `${job.company.toLowerCase()}::${job.title.toLowerCase()}`;
            if (seenCompanyRoles.has(key)) {
              totalDupes++;
              continue;
            }
            seenUrls.add(job.url);
            seenCompanyRoles.add(key);
            newOffers.push({ ...job, source: 'playwright-page' });
          }
        } catch (err) {
          errors.push({ company: company.name, error: `Playwright: ${err.message}` });
        }
      }
    } finally {
      await browser.close();
    }
  }

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
  console.log('→ Share results and get help: https://discord.gg/8pRpHETxa4');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
