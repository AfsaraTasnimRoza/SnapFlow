const { chromium } = require('playwright');
const path = require('path');
const { resolveGitHubTarget, cleanupTempServer } = require('./githubHelper');

const jobs = new Map();

const VIEWPORT_PRESETS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 }
};

function sanitizeSlug(urlPath) {
  if (!urlPath || urlPath === '/') return 'home';
  return urlPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 50) || 'page';
}

function normalizeUrlForKey(rawUrl, baseOrigin) {
  try {
    const u = new URL(rawUrl, baseOrigin);
    u.hash = '';
    // Keep pathname clean (strip trailing slash except root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Ignore common non-HTML assets
    if (/\.(png|jpg|jpeg|gif|webp|svg|pdf|zip|css|js|ico|mp4|mp3|woff2?)$/i.test(u.pathname)) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

async function crawlAndScreenshot({
  jobId,
  rawInputUrl,
  maxPages,
  viewport,
  fullPage,
  jobDir
}) {
  const jobState = {
    jobId,
    rawInputUrl,
    resolvedBaseUrl: '',
    githubInfo: null,
    status: 'running', // 'running' | 'completed' | 'failed'
    startedAt: new Date().toISOString(),
    completedAt: null,
    maxPages,
    viewport,
    fullPage,
    currentAction: 'Initializing...',
    logs: [],
    pages: [], // Array of captured page objects in sequence order
    edges: [], // { fromStep, toStep, label }
    error: null
  };

  jobs.set(jobId, jobState);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    jobState.currentAction = msg;
    jobState.logs.push(`[${timestamp}] ${msg}`);
  };

  let browser = null;
  let tempServer = null;

  try {
    // Step 1: Resolve GitHub repo or live URL
    const resolved = await resolveGitHubTarget(rawInputUrl, jobDir, addLog);
    tempServer = resolved.tempServer;
    jobState.resolvedBaseUrl = resolved.targetUrl;
    jobState.githubInfo = resolved.githubInfo;

    const baseUrlObj = new URL(resolved.targetUrl);
    const baseOrigin = baseUrlObj.origin;
    const basePathPrefix = baseUrlObj.pathname.replace(/\/$/, '');

    addLog(`🚀 Launching headless Chromium browser (${viewport} viewport)...`);
    browser = await chromium.launch({ headless: true });

    const vpSize = VIEWPORT_PRESETS[viewport] || VIEWPORT_PRESETS.desktop;
    const context = await browser.newContext({
      viewport: vpSize,
      ignoreHTTPSErrors: true,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    // BFS Queue for ordered page sequence discovery
    // Each item: { url, depth, parentStep, parentUrl, parentPath, viaLinkText }
    const queue = [];
    const visited = new Set();
    const urlToStepMap = new Map();

    // Enqueue main entry URL
    const entryNormalized = normalizeUrlForKey(resolved.targetUrl, baseOrigin);
    if (entryNormalized) {
      visited.add(entryNormalized);
      queue.push({
        url: entryNormalized,
        depth: 0,
        parentStep: null,
        parentUrl: null,
        parentPath: null,
        viaLinkText: 'Entry URL (Start)'
      });
    }

    // Also enqueue any extra routes discovered directly from GitHub code tree
    if (resolved.seedRoutes && resolved.seedRoutes.length > 0) {
      for (const route of resolved.seedRoutes) {
        const cleanRoute = route.startsWith('/') ? route : '/' + route;
        const fullSeedUrl = normalizeUrlForKey(
          baseOrigin + basePathPrefix + cleanRoute,
          baseOrigin
        );
        if (fullSeedUrl && !visited.has(fullSeedUrl)) {
          visited.add(fullSeedUrl);
          queue.push({
            url: fullSeedUrl,
            depth: 1,
            parentStep: 1,
            parentUrl: entryNormalized,
            parentPath: '/',
            viaLinkText: 'GitHub Code Route'
          });
        }
      }
    }

    let stepCounter = 0;

    while (queue.length > 0 && stepCounter < maxPages) {
      const currentItem = queue.shift();
      stepCounter += 1;
      const currentStep = stepCounter;

      const currentUrlObj = new URL(currentItem.url);
      const displayPath = currentUrlObj.pathname + (currentUrlObj.search || '');

      addLog(`📸 [Step #${currentStep}/${maxPages}] Navigating to ${displayPath || '/'} ...`);

      try {
        await page.goto(currentItem.url, {
          waitUntil: 'domcontentloaded',
          timeout: 25000
        });

        // Wait briefly for network / animations / fonts to settle
        try {
          await page.waitForLoadState('networkidle', { timeout: 4000 });
        } catch {
          // Networkidle timeout is normal on sites with live sockets/analytics
        }
        await page.waitForTimeout(600);

        const pageTitle = (await page.title()) || displayPath || 'Untitled Page';

        // Extract internal links on this page to build the sequence flow
        const extractedLinks = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          return anchors.map((a) => ({
            href: a.href,
            text: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').trim().slice(0, 60)
          }));
        });

        const slug = sanitizeSlug(currentUrlObj.pathname);
        const fileName = `${String(currentStep).padStart(2, '0')}_${slug}.png`;
        const localFilePath = path.join(jobDir, fileName);

        await page.screenshot({
          path: localFilePath,
          fullPage: fullPage
        });

        urlToStepMap.set(currentItem.url, currentStep);

        const pageRecord = {
          step: currentStep,
          title: pageTitle,
          url: currentItem.url,
          path: displayPath || '/',
          depth: currentItem.depth,
          parentStep: currentItem.parentStep,
          parentUrl: currentItem.parentUrl,
          parentPath: currentItem.parentPath,
          viaLinkText: currentItem.viaLinkText,
          fileName,
          screenshotUrl: `/screenshots/${jobId}/${fileName}`,
          localFilePath,
          childrenSteps: [],
          outgoingInternalUrls: [],
          capturedAt: new Date().toISOString()
        };

        // Link back to parent's childrenSteps
        if (currentItem.parentStep) {
          const parentRecord = jobState.pages.find((p) => p.step === currentItem.parentStep);
          if (parentRecord && !parentRecord.childrenSteps.includes(currentStep)) {
            parentRecord.childrenSteps.push(currentStep);
          }
          jobState.edges.push({
            fromStep: currentItem.parentStep,
            toStep: currentStep,
            label: currentItem.viaLinkText || 'Link'
          });
        }

        // Process extracted internal links
        for (const link of extractedLinks) {
          const norm = normalizeUrlForKey(link.href, baseOrigin);
          if (!norm) continue;

          const normObj = new URL(norm);
          // Stay on the same origin (and within repo subpath if GitHub pages)
          if (normObj.origin !== baseOrigin) continue;
          if (basePathPrefix && !normObj.pathname.startsWith(basePathPrefix)) continue;

          if (!pageRecord.outgoingInternalUrls.includes(norm)) {
            pageRecord.outgoingInternalUrls.push(norm);
          }

          if (!visited.has(norm) && visited.size < maxPages * 2) {
            visited.add(norm);
            queue.push({
              url: norm,
              depth: currentItem.depth + 1,
              parentStep: currentStep,
              parentUrl: currentItem.url,
              parentPath: displayPath || '/',
              viaLinkText: link.text || normObj.pathname
            });
          } else if (urlToStepMap.has(norm)) {
            const existingTargetStep = urlToStepMap.get(norm);
            if (existingTargetStep !== currentStep && !pageRecord.childrenSteps.includes(existingTargetStep)) {
              pageRecord.childrenSteps.push(existingTargetStep);
            }
          }
        }

        jobState.pages.push(pageRecord);
        addLog(`✅ Captured Step #${currentStep}: "${pageTitle}" (${displayPath})`);
      } catch (pageErr) {
        addLog(`⚠️ Skipped ${displayPath}: ${pageErr.message}`);
      }
    }

    jobState.status = 'completed';
    jobState.completedAt = new Date().toISOString();
    addLog(`🎉 Completed! Captured ${jobState.pages.length} page(s) in sequence.`);
  } catch (err) {
    console.error('Crawl job failed:', err);
    jobState.status = 'failed';
    jobState.error = err.message || 'Unknown error occurred during crawling.';
    addLog(`❌ Error: ${jobState.error}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    cleanupTempServer(tempServer);
  }
}

function getJobStatus(jobId) {
  return jobs.get(jobId) || null;
}

function getAllJobs() {
  return Array.from(jobs.values())
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .map((j) => ({
      jobId: j.jobId,
      rawInputUrl: j.rawInputUrl,
      status: j.status,
      totalPages: j.pages.length,
      startedAt: j.startedAt
    }));
}

module.exports = {
  crawlAndScreenshot,
  getJobStatus,
  getAllJobs
};
