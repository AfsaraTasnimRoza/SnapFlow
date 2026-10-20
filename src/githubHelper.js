const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Checks if the user provided a GitHub repository link (e.g., https://github.com/owner/repo)
 * and resolves the best live URL AND extracts route hints from the repository tree.
 * Also supports downloading static HTML/CSS/JS files from the GitHub repo and serving them
 * locally if no live deployed site exists!
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Website-Screenshot-Sequencer/1.0',
          'Accept': 'application/vnd.github.v3+json'
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

function fetchRawBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(
      url,
      { headers: { 'User-Agent': 'Website-Screenshot-Sequencer/1.0' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchRawBuffer(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    ).on('error', reject);
  });
}

function checkUrlReachable(targetUrl) {
  return new Promise((resolve) => {
    try {
      const client = targetUrl.startsWith('https') ? https : http;
      const req = client.get(
        targetUrl,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 400);
          res.resume();
        }
      );
      req.on('error', () => resolve(false));
      req.setTimeout(6000, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function parseGitHubRepoUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') {
      return null;
    }
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    return { owner, repo };
  } catch {
    return null;
  }
}

/**
 * Extracts route paths from repository file paths (HTML files, Next.js pages/app router, etc.)
 */
function extractRoutesFromTree(treeItems) {
  const routes = new Set(['/']);
  const htmlFiles = [];

  for (const item of treeItems) {
    if (item.type !== 'blob') continue;
    const filePath = item.path;

    // Track static HTML files
    if (filePath.endsWith('.html')) {
      htmlFiles.push(filePath);
      if (filePath === 'index.html' || filePath === 'public/index.html') {
        routes.add('/');
      } else if (filePath.startsWith('public/')) {
        routes.add('/' + filePath.slice('public/'.length));
      } else if (!filePath.includes('node_modules') && !filePath.startsWith('dist/')) {
        routes.add('/' + filePath);
      }
    }

    // Next.js pages router (e.g. pages/about.tsx, src/pages/contact/index.jsx)
    const pagesMatch = filePath.match(/^(?:src\/)?pages\/(.+)\.(js|jsx|ts|tsx)$/);
    if (pagesMatch) {
      let route = pagesMatch[1];
      if (!route.startsWith('_') && !route.startsWith('api/')) {
        route = route.replace(/\/index$/, '');
        if (route === 'index') route = '';
        if (!route.includes('[')) {
          routes.add('/' + route);
        }
      }
    }

    // Next.js App router (e.g. app/dashboard/page.tsx, src/app/pricing/page.jsx)
    const appMatch = filePath.match(/^(?:src\/)?app\/(.+\/)?page\.(js|jsx|ts|tsx)$/);
    if (appMatch) {
      let route = (appMatch[1] || '').replace(/\/$/, '');
      // Remove route groups like (marketing)
      route = route
        .split('/')
        .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
        .join('/');
      if (!route.includes('[')) {
        routes.add('/' + route);
      }
    }
  }

  return {
    discoveredRoutes: Array.from(routes),
    htmlFiles
  };
}

/**
 * If a GitHub repo is a static HTML/CSS/JS site without a live URL, download its static files
 * and spin up a temporary local HTTP server so Playwright can screenshot all pages cleanly!
 */
async function startLocalStaticServerFromGitHub(owner, repo, branch, treeItems, jobDir) {
  const staticDir = path.join(jobDir, '_repo_static');
  fs.mkdirSync(staticDir, { recursive: true });

  const staticExtensions = new Set([
    '.html', '.htm', '.css', '.js', '.mjs', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.json', '.woff', '.woff2', '.ttf'
  ]);

  const filesToDownload = treeItems.filter((item) => {
    if (item.type !== 'blob') return false;
    const ext = path.extname(item.path).toLowerCase();
    return staticExtensions.has(ext) && (item.size || 0) < 5 * 1024 * 1024;
  }).slice(0, 80); // Cap to 80 static assets for fast setup

  for (const item of filesToDownload) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
    const destPath = path.join(staticDir, item.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try {
      const buf = await fetchRawBuffer(rawUrl);
      fs.writeFileSync(destPath, buf);
    } catch (e) {
      // Ignore individual asset failure
    }
  }

  // Determine root folder (in case index.html is inside a subfolder like public/ or docs/)
  let serveRoot = staticDir;
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
    if (fs.existsSync(path.join(staticDir, 'public', 'index.html'))) {
      serveRoot = path.join(staticDir, 'public');
    } else if (fs.existsSync(path.join(staticDir, 'docs', 'index.html'))) {
      serveRoot = path.join(staticDir, 'docs');
    }
  }

  const express = require('express');
  const tempApp = express();
  tempApp.use(express.static(serveRoot));

  return new Promise((resolve) => {
    const server = tempApp.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        localUrl: `http://127.0.0.1:${port}`
      });
    });
  });
}

async function resolveGitHubTarget(rawInputUrl, jobDir, onLog) {
  let normalizedUrl = rawInputUrl.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  const ghParsed = parseGitHubRepoUrl(normalizedUrl);
  if (!ghParsed) {
    return {
      isGitHubRepo: false,
      targetUrl: normalizedUrl,
      seedRoutes: ['/'],
      githubInfo: null,
      tempServer: null
    };
  }

  const { owner, repo } = ghParsed;
  onLog(`🔍 Detected GitHub Repository: ${owner}/${repo}. Checking repository details & routes...`);

  let repoData = null;
  let defaultBranch = 'main';
  let homepageUrl = '';

  try {
    repoData = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
    defaultBranch = repoData.default_branch || 'main';
    homepageUrl = (repoData.homepage || '').trim();
  } catch (err) {
    onLog(`⚠️ Could not fetch GitHub API metadata (${err.message}). Will check standard GitHub Pages URL...`);
  }

  // Fetch git tree to discover routes and static HTML files
  let discoveredRoutes = ['/'];
  let htmlFiles = [];
  let treeItems = [];

  try {
    const treeData = await fetchJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
    );
    if (treeData && Array.isArray(treeData.tree)) {
      treeItems = treeData.tree;
      const extracted = extractRoutesFromTree(treeItems);
      discoveredRoutes = extracted.discoveredRoutes;
      htmlFiles = extracted.htmlFiles;
      onLog(`📂 Analyzed repository code: found ${discoveredRoutes.length} route(s)/page(s) (${discoveredRoutes.slice(0, 6).join(', ')})...`);
    }
  } catch (err) {
    // Non-fatal
  }

  // 1. Check if repo has a valid live homepage URL configured on GitHub
  if (homepageUrl && /^https?:\/\//i.test(homepageUrl)) {
    const ok = await checkUrlReachable(homepageUrl);
    if (ok) {
      onLog(`🌐 Found live deployment URL from GitHub repo homepage: ${homepageUrl}`);
      return {
        isGitHubRepo: true,
        targetUrl: homepageUrl,
        seedRoutes: discoveredRoutes,
        githubInfo: {
          owner,
          repo,
          branch: defaultBranch,
          mode: 'Live Homepage Deployment',
          liveUrl: homepageUrl,
          discoveredRoutes
        },
        tempServer: null
      };
    }
  }

  // 2. Check GitHub Pages URL: https://{owner}.github.io/{repo}/
  const ghPagesUrl = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner}.github.io/`
    : `https://${owner}.github.io/${repo}/`;

  const ghPagesOk = await checkUrlReachable(ghPagesUrl);
  if (ghPagesOk) {
    onLog(`🌐 Found active GitHub Pages deployment: ${ghPagesUrl}`);
    return {
      isGitHubRepo: true,
      targetUrl: ghPagesUrl,
      seedRoutes: discoveredRoutes,
      githubInfo: {
        owner,
        repo,
        branch: defaultBranch,
        mode: 'GitHub Pages Live Site',
        liveUrl: ghPagesUrl,
        discoveredRoutes
      },
      tempServer: null
    };
  }

  // 3. If the repo contains static .html files, download & serve locally automatically!
  if (htmlFiles.length > 0 && treeItems.length > 0) {
    onLog(`⚡ No live deployment found, but found ${htmlFiles.length} HTML file(s) in repo! Spinning up local preview server to capture all pages...`);
    const { server, localUrl } = await startLocalStaticServerFromGitHub(
      owner,
      repo,
      defaultBranch,
      treeItems,
      jobDir
    );
    return {
      isGitHubRepo: true,
      targetUrl: localUrl,
      seedRoutes: discoveredRoutes,
      githubInfo: {
        owner,
        repo,
        branch: defaultBranch,
        mode: 'Auto-Hosted Static HTML from GitHub Repo',
        liveUrl: `https://github.com/${owner}/${repo}`,
        discoveredRoutes
      },
      tempServer: server
    };
  }

  // 4. Fallback: crawl the GitHub repository pages themselves if it has no web app or HTML
  onLog(`ℹ️ Repo does not have a live deployment or static HTML files; capturing GitHub repo pages directly.`);
  return {
    isGitHubRepo: true,
    targetUrl: normalizedUrl,
    seedRoutes: ['/'],
    githubInfo: {
      owner,
      repo,
      branch: defaultBranch,
      mode: 'GitHub Repository Page',
      liveUrl: normalizedUrl,
      discoveredRoutes
    },
    tempServer: null
  };
}

function cleanupTempServer(server) {
  if (server && typeof server.close === 'function') {
    try {
      server.close();
    } catch {}
  }
}

module.exports = {
  resolveGitHubTarget,
  cleanupTempServer
};
