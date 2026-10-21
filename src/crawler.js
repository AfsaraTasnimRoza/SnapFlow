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
  exploreControls = true,
  defaultLogin = {},
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
    exploreControls,
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
    const approvedLoginHost = String(defaultLogin.host || '').trim().toLowerCase();
    const canUseDefaultLogin = Boolean(
      resolved.githubInfo &&
      approvedLoginHost &&
      baseUrlObj.hostname.toLowerCase() === approvedLoginHost &&
      defaultLogin.email &&
      defaultLogin.password
    );
    if (canUseDefaultLogin) addLog(`🔐 Default sign-in is enabled for this Git project on ${approvedLoginHost} only.`);

    const finishSignIn = async (targetPage) => {
      const passwordInput = targetPage.locator('input[type="password"]').first();
      if (!(await passwordInput.count()) || !(await passwordInput.isVisible().catch(() => false))) return true;

      const currentHost = new URL(targetPage.url()).hostname.toLowerCase();
      const canSubmitDefault = canUseDefaultLogin && currentHost === approvedLoginHost;
      if (canSubmitDefault) {
        const emailInput = targetPage.locator('input[type="email"], input[autocomplete="username"], input[name*="email" i], input[name*="user" i]').first();
        if (await emailInput.count() && await passwordInput.count()) {
          addLog('Filling the locally configured Git-project sign-in on the approved host.');
          await emailInput.fill(defaultLogin.email);
          await passwordInput.fill(defaultLogin.password);
          const submit = targetPage.locator('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")').first();
          if (await submit.count()) await submit.click({ timeout: 5000 }).catch(() => {});
          else await passwordInput.press('Enter').catch(() => {});
        } else {
          addLog('No recognizable email/password form found. Complete sign-in manually in Chromium.');
        }
      } else {
        addLog('Sign-in required. Credentials are not sent to this URL. Complete sign-in (and any CAPTCHA/MFA) in Chromium.');
      }

      addLog('Waiting up to 5 minutes for sign-in to finish...');
      try {
        await targetPage.waitForFunction(() => !Array.from(document.querySelectorAll('input[type="password"]')).some((el) => el.getClientRects().length), null, { timeout: 5 * 60 * 1000 });
        addLog('Sign-in form is no longer visible; continuing capture.');
        return true;
      } catch {
        addLog('Sign-in was not completed before timeout; skipping this page/state.');
        return false;
      }
    };

    addLog(`🚀 Launching visible Chromium browser (${viewport} viewport)...`);
    browser = await chromium.launch({ headless: false });

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
    const renderedPageFingerprints = new Set();

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

        if (!(await finishSignIn(page))) continue;

        const renderedText = await page.locator('body').innerText().catch(() => '');
        const renderFingerprint = renderedText.replace(/\s+/g, ' ').trim();
        if (renderFingerprint && renderedPageFingerprints.has(renderFingerprint)) {
          addLog(`⏭ Skipping duplicate-rendered route ${displayPath}; its page content was already captured.`);
          continue;
        }
        if (renderFingerprint) renderedPageFingerprints.add(renderFingerprint);

        const pageTitle = (await page.title()) || displayPath || 'Untitled Page';

        // Extract internal links on this page to build the sequence flow
        const extractedLinks = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          return anchors.map((a) => ({
            href: a.href,
            text: (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').trim().slice(0, 60)
          }));
        });

        const controls = exploreControls ? await page.evaluate(() => Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]'))
          .map((el, index) => ({ index, label: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').trim().slice(0, 80), disabled: el.disabled || el.getAttribute('aria-disabled') === 'true', type: (el.getAttribute('type') || '').toLowerCase() }))
          .filter((el) => !el.disabled && el.type !== 'submit' && el.label && !/\b(delete|remove|purchase|checkout|pay|confirm|send|submit|save|create|register|sign\s?in|log\s?in|log\s?out|add\s+to\s+cart|place\s+order|buy\s+now|wishlist|favorite)\b/i.test(el.label))
          .slice(0, 50)) : [];

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

        pageRecord.controls = controls.map(({ label, index }) => ({ label, index, screenshotFile: null, result: 'listed' }));
        for (const control of controls) {
          try {
            const probe = await context.newPage();
            await probe.goto(currentItem.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            try { await probe.waitForLoadState('networkidle', { timeout: 3000 }); } catch {}
            await probe.waitForTimeout(700);
            const button = probe.locator('button, [role="button"], [role="tab"]').nth(control.index);
            if (!(await button.count()) || !(await button.isVisible())) {
              const controlRecord = pageRecord.controls.find((item) => item.index === control.index);
              if (controlRecord) controlRecord.result = 'not available';
              await probe.close();
              continue;
            }
            await button.click({ timeout: 2500 });
            await probe.waitForTimeout(350);
            if (!(await finishSignIn(probe))) {
              const controlRecord = pageRecord.controls.find((item) => item.index === control.index);
              if (controlRecord) controlRecord.result = 'sign-in not completed';
              await probe.close();
              continue;
            }
            const after = new URL(probe.url());
            if (after.origin !== baseOrigin) {
              const controlRecord = pageRecord.controls.find((item) => item.index === control.index);
              if (controlRecord) controlRecord.result = 'external navigation skipped';
              await probe.close();
              continue;
            }
            const stateFile = `${String(currentStep).padStart(2, '0')}_${slug}_control-${String(control.index + 1).padStart(2, '0')}.png`;
            const statePath = path.join(jobDir, stateFile);
            await probe.screenshot({ path: statePath, fullPage });
            const controlRecord = pageRecord.controls.find((item) => item.index === control.index);
            if (controlRecord) {
              controlRecord.result = 'captured';
              controlRecord.screenshotFile = stateFile;
              controlRecord.resultUrl = probe.url();
              controlRecord.dialog = await probe.locator('[role="dialog"], dialog[open]').first().count().then((n) => n > 0);
              controlRecord.localFilePath = statePath;
            }
            await probe.close();
          } catch (controlErr) {
            const controlRecord = pageRecord.controls.find((item) => item.index === control.index);
            if (controlRecord) controlRecord.result = `skipped: ${controlErr.message}`;
          }
        }

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

    jobState.completedAt = new Date().toISOString();
    if (jobState.pages.length === 0) {
      jobState.status = 'failed';
      jobState.error = 'No screenshots were captured. The crawler could not access the target website; check network access and try again.';
      addLog(`❌ ${jobState.error}`);
    } else {
      jobState.status = 'completed';
      addLog(`🎉 Completed! Captured ${jobState.pages.length} page(s) in sequence.`);
    }
  } catch (err) {
    console.error('Crawl job failed:', err);
    jobState.status = 'failed';
    jobState.error = /ERR_NETWORK_ACCESS_DENIED|net::ERR_BLOCKED_BY_CLIENT/i.test(err.message || '')
      ? 'Chromium could not reach the target site because network access is blocked for the crawler process. Open the site in your regular browser to confirm it is reachable, then allow network access for the SnapFlow Chromium process and retry.'
      : err.message || 'Unknown error occurred during crawling.';
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
