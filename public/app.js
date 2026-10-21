const crawlForm = document.getElementById('crawlForm');
const inputUrlEl = document.getElementById('inputUrl');
const maxPagesEl = document.getElementById('maxPages');
const viewportEl = document.getElementById('viewport');
const fullPageEl = document.getElementById('fullPage');
const exploreControlsEl = document.getElementById('exploreControls');
const startBtn = document.getElementById('startBtn');
const demoBtn = document.getElementById('demoBtn');

const statusSection = document.getElementById('statusSection');
const statusSpinner = document.getElementById('statusSpinner');
const statusHeading = document.getElementById('statusHeading');
const pageCountBadge = document.getElementById('pageCountBadge');
const currentActionText = document.getElementById('currentActionText');
const githubInfoBanner = document.getElementById('githubInfoBanner');
const logsBox = document.getElementById('logsBox');

const resultsSection = document.getElementById('resultsSection');
const pipelineContainer = document.getElementById('pipelineContainer');
const viewSequence = document.getElementById('view-sequence');
const viewTree = document.getElementById('view-tree');
const viewGrid = document.getElementById('view-grid');
const downloadZipBtn = document.getElementById('downloadZipBtn');

const lightboxModal = document.getElementById('lightboxModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalStepBadge = document.getElementById('modalStepBadge');
const modalTitle = document.getElementById('modalTitle');
const modalUrl = document.getElementById('modalUrl');
const modalFlowMeta = document.getElementById('modalFlowMeta');
const modalImage = document.getElementById('modalImage');

let pollInterval = null;
let currentJobData = null;

// Quick preset chips
document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    inputUrlEl.value = btn.getAttribute('data-url');
  });
});

// View switcher tabs
document.querySelectorAll('.tab-btn').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const selectedView = tab.getAttribute('data-view');
    viewSequence.classList.toggle('hidden', selectedView !== 'sequence');
    viewTree.classList.toggle('hidden', selectedView !== 'tree');
    viewGrid.classList.toggle('hidden', selectedView !== 'grid');
  });
});

// Start a real crawl job
crawlForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputUrl = inputUrlEl.value.trim();
  if (!inputUrl) return;

  if (pollInterval) clearInterval(pollInterval);

  startBtn.disabled = true;
  startBtn.textContent = '⏳ Capturing Pages...';
  statusSection.classList.remove('hidden');
  statusSpinner.classList.remove('hidden');
  githubInfoBanner.classList.add('hidden');

  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputUrl,
        maxPages: Number(maxPagesEl.value),
        viewport: viewportEl.value,
        fullPage: fullPageEl.checked,
        exploreControls: exploreControlsEl.checked
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start job');
    }

    const jobId = data.jobId;
    downloadZipBtn.classList.add('hidden');

    pollJobStatus(jobId);
    pollInterval = setInterval(() => pollJobStatus(jobId), 1500);
  } catch (err) {
    statusSpinner.classList.add('hidden');
    statusHeading.textContent = 'Error Starting Capture';
    currentActionText.textContent = err.message;
    startBtn.disabled = false;
    startBtn.textContent = '🚀 Capture All Pages & Sequence';
  }
});

async function pollJobStatus(jobId) {
  try {
    const res = await fetch(`/api/status/${jobId}`);
    if (!res.ok) return;
    const job = await res.json();
    currentJobData = job;

    pageCountBadge.textContent = `${job.pages.length} page(s) captured`;
    currentActionText.textContent = job.currentAction || '';
    logsBox.textContent = (job.logs || []).join('\n');
    logsBox.scrollTop = logsBox.scrollHeight;

    if (job.githubInfo) {
      githubInfoBanner.classList.remove('hidden');
      githubInfoBanner.innerHTML = `
        <strong>🐙 GitHub Repository Detected:</strong> <code>${escapeHtml(job.githubInfo.owner)}/${escapeHtml(job.githubInfo.repo)}</code>
        &nbsp;|&nbsp; <strong>Mode:</strong> ${escapeHtml(job.githubInfo.mode)}
        &nbsp;|&nbsp; <strong>Code Routes Found:</strong> ${job.githubInfo.discoveredRoutes.length}
      `;
    }

    if (job.pages.length > 0) {
      resultsSection.classList.remove('hidden');
      renderAllViews(job);
    }

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(pollInterval);
      statusSpinner.classList.add('hidden');
      statusHeading.textContent =
        job.status === 'completed'
          ? `✅ Completed! ${job.pages.length} Pages Sequenced`
          : '❌ Capture Stopped with Error';
      if (job.status === 'completed' && job.pages.length > 0) {
        downloadZipBtn.href = `/api/download/${jobId}`;
        downloadZipBtn.classList.remove('hidden');
      }
      if (job.status === 'failed' && job.error) currentActionText.textContent = job.error;
      startBtn.disabled = false;
      startBtn.textContent = '🚀 Capture All Pages & Sequence';
    }
  } catch (err) {
    console.error('Polling error:', err);
  }
}

function renderAllViews(job) {
  renderPipelineBar(job.pages);
  renderSequenceFlowView(job.pages);
  renderDepthTreeView(job.pages);
  renderGridGalleryView(job.pages);
}

// Horizontal Pipeline Bar
function renderPipelineBar(pages) {
  pipelineContainer.innerHTML = pages
    .map((p, idx) => {
      const arrow = idx < pages.length - 1 ? `<span class="pipe-arrow">──►</span>` : '';
      return `
        <a href="#step-card-${p.step}" class="pipe-node">
          <span class="pipe-num">#${p.step}</span>
          <span>${escapeHtml(p.path === '/' ? 'Home (/)' : p.path)}</span>
        </a>
        ${arrow}
      `;
    })
    .join('');
}

// VIEW 1: Detailed Sequence Flow (Kontar Por Kon Page)
function renderSequenceFlowView(pages) {
  viewSequence.innerHTML = pages
    .map((p, idx) => {
      const parentHtml = p.parentStep
        ? `<a href="#step-card-${p.parentStep}" class="rel-pill from-pill">⬅ From Step #${p.parentStep} (${escapeHtml(p.parentPath || '/')}) via "${escapeHtml(p.viaLinkText || 'Link')}"</a>`
        : `<span class="rel-pill from-pill">🏁 Starting Entry Page (Root)</span>`;

      const nextStepsHtml =
        p.childrenSteps && p.childrenSteps.length > 0
          ? p.childrenSteps
              .map((childStep) => {
                const childObj = pages.find((x) => x.step === childStep);
                const label = childObj ? childObj.path : `Step #${childStep}`;
                return `<a href="#step-card-${childStep}" class="rel-pill to-pill">➡ Step #${childStep} (${escapeHtml(label)})</a>`;
              })
              .join('')
          : `<span class="rel-pill">End of branch / No new unvisited sub-pages</span>`;

      const downConnector =
        idx < pages.length - 1
          ? `<div class="connector-arrow">⬇ Next in Sequence: <strong>Step #${pages[idx + 1].step} — ${escapeHtml(pages[idx + 1].title || pages[idx + 1].path)}</strong></div>`
          : '';

      return `
        <div class="seq-step-wrapper" id="step-card-${p.step}">
          <div class="seq-card">
            <div class="seq-info">
              <div>
                <div class="seq-badge-row">
                  <span class="step-badge">STEP #${String(p.step).padStart(2, '0')}</span>
                  <span class="depth-tag">Depth Level ${p.depth}</span>
                </div>
                <h3 class="seq-title">${escapeHtml(p.title || p.path)}</h3>
                <a href="${escapeHtml(p.url)}" target="_blank" class="seq-url">${escapeHtml(p.url)} ↗</a>
              </div>

              <div class="flow-relations">
                <div class="rel-block">
                  <strong>1. Kon Page Theke Esheche (Previous / Parent Page):</strong>
                  ${parentHtml}
                </div>
                <div class="rel-block">
                  <strong>2. Ei Page Theke Kon Kon Page-e Yay (Next Connected Pages):</strong>
                  ${nextStepsHtml}
                </div>
              </div>

              <div>
                <button type="button" class="btn btn-secondary" style="width:100%" onclick="openLightbox(${p.step})">
                  🔍 Inspect Full Screenshot
                </button>
              </div>
            </div>

            <div class="seq-preview">
              <div class="screenshot-frame" onclick="openLightbox(${p.step})">
                <img src="${escapeHtml(p.screenshotUrl)}" alt="Step ${p.step} Screenshot" loading="lazy" />
              </div>
            </div>
          </div>
          ${downConnector}
        </div>
      `;
    })
    .join('');
}

// VIEW 2: Depth Level Tree Map
function renderDepthTreeView(pages) {
  const byDepth = new Map();
  pages.forEach((p) => {
    if (!byDepth.has(p.depth)) byDepth.set(p.depth, []);
    byDepth.get(p.depth).push(p);
  });

  const levelsHtml = Array.from(byDepth.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([depth, levelPages]) => {
      const levelTitle =
        depth === 0
          ? 'Level 0 — Main Entry / Home Page'
          : `Level ${depth} — Pages ${depth} Click(s) Away from Home`;

      const cards = levelPages
        .map(
          (p) => `
          <div class="grid-card" onclick="openLightbox(${p.step})">
            <div class="grid-thumb">
              <img src="${escapeHtml(p.screenshotUrl)}" alt="Step ${p.step}" loading="lazy" />
            </div>
            <div class="grid-body">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span class="step-badge">Step #${p.step}</span>
                <span class="depth-tag">${p.parentStep ? `From #${p.parentStep}` : 'Root'}</span>
              </div>
              <h4 style="font-size:15px; margin-bottom:4px;">${escapeHtml(p.title || p.path)}</h4>
              <div style="font-size:12px; color:#38bdf8;">${escapeHtml(p.path)}</div>
            </div>
          </div>
        `
        )
        .join('');

      return `
        <div class="depth-level-box">
          <div class="depth-level-title">${levelTitle} (${levelPages.length} page${levelPages.length > 1 ? 's' : ''})</div>
          <div class="tree-cards-grid">${cards}</div>
        </div>
      `;
    })
    .join('');

  viewTree.innerHTML = levelsHtml;
}

// VIEW 3: Compact Grid Gallery
function renderGridGalleryView(pages) {
  viewGrid.innerHTML = `
    <div class="gallery-grid">
      ${pages
        .map(
          (p) => `
        <div class="grid-card" onclick="openLightbox(${p.step})">
          <div class="grid-thumb">
            <img src="${escapeHtml(p.screenshotUrl)}" alt="Step ${p.step}" loading="lazy" />
          </div>
          <div class="grid-body">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="step-badge">Step #${String(p.step).padStart(2, '0')}</span>
              <span class="depth-tag">${p.parentStep ? `After Step #${p.parentStep}` : 'Start Page'}</span>
            </div>
            <h4 style="font-size:15px; margin-bottom:4px;">${escapeHtml(p.title || p.path)}</h4>
            <p style="font-size:12px; color:#94a3b8;">Path: ${escapeHtml(p.path)}</p>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
}

// Lightbox Modal
window.openLightbox = function (stepNumber) {
  if (!currentJobData) return;
  const pageObj = currentJobData.pages.find((x) => x.step === stepNumber);
  if (!pageObj) return;

  modalStepBadge.textContent = `STEP #${String(pageObj.step).padStart(2, '0')}`;
  modalTitle.textContent = pageObj.title || pageObj.path;
  modalUrl.textContent = pageObj.url;
  modalUrl.href = pageObj.url;
  modalFlowMeta.innerHTML = `
    <strong>Sequence Position:</strong> Step #${pageObj.step} of ${currentJobData.pages.length}
    &nbsp;|&nbsp;
    <strong>Previous Page:</strong> ${pageObj.parentStep ? `Step #${pageObj.parentStep} (${escapeHtml(pageObj.parentPath)})` : 'Entry Page'}
    &nbsp;|&nbsp;
    <strong>Leads To Steps:</strong> ${pageObj.childrenSteps && pageObj.childrenSteps.length ? pageObj.childrenSteps.map((s) => '#' + s).join(', ') : 'None'}
  `;
  modalImage.src = pageObj.screenshotUrl;
  lightboxModal.classList.remove('hidden');
};

function closeLightbox() {
  lightboxModal.classList.add('hidden');
}

closeModalBtn.addEventListener('click', closeLightbox);
modalBackdrop.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeLightbox();
});

// Built-in Instant Interactive Demo (generates SVG data-URI mock screenshots so user can test UI immediately)
demoBtn.addEventListener('click', () => {
  const makeMockSvg = (step, title, path, bg, accent) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <rect width="1200" height="720" fill="${bg}"/>
      <rect x="0" y="0" width="1200" height="64" fill="#0f172a"/>
      <circle cx="32" cy="32" r="10" fill="#ef4444"/>
      <circle cx="62" cy="32" r="10" fill="#f59e0b"/>
      <circle cx="92" cy="32" r="10" fill="#10b981"/>
      <rect x="140" y="16" width="540" height="32" rx="6" fill="#1e293b"/>
      <text x="160" y="37" fill="#94a3b8" font-family="sans-serif" font-size="15">https://my-portfolio-app.github.io${path}</text>
      <rect x="60" y="110" width="1080" height="220" rx="16" fill="${accent}" opacity="0.18"/>
      <text x="100" y="180" fill="#f8fafc" font-family="sans-serif" font-weight="bold" font-size="38">Step #${step}: ${title}</text>
      <text x="100" y="230" fill="#cbd5e1" font-family="sans-serif" font-size="22">Route Path: ${path} — Automatically Captured Full-Page Preview</text>
      <rect x="60" y="365" width="340" height="280" rx="12" fill="#1e293b"/>
      <rect x="430" y="365" width="340" height="280" rx="12" fill="#1e293b"/>
      <rect x="800" y="365" width="340" height="280" rx="12" fill="#1e293b"/>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  };

  currentJobData = {
    jobId: 'demo_preview',
    rawInputUrl: 'https://github.com/developer/my-portfolio-app',
    status: 'completed',
    githubInfo: {
      owner: 'developer',
      repo: 'my-portfolio-app',
      mode: 'GitHub Pages Live Site + Code Route Discovery',
      discoveredRoutes: ['/', '/projects', '/about', '/blog', '/contact', '/projects/ecommerce-ui']
    },
    currentAction: 'Demo loaded! Click any screenshot or try entering your own GitHub/Website link above.',
    logs: [
      '[Demo] Detected GitHub Repository: developer/my-portfolio-app',
      '[Demo] Found 6 routes from repository tree and internal navigation links',
      '[Demo] Captured all 6 pages in sequence order (#1 -> #6)'
    ],
    pages: [
      {
        step: 1,
        title: 'Home — Developer Portfolio',
        url: 'https://my-portfolio-app.github.io/',
        path: '/',
        depth: 0,
        parentStep: null,
        parentPath: null,
        viaLinkText: 'Entry URL (Start)',
        childrenSteps: [2, 3, 4, 5],
        screenshotUrl: makeMockSvg(1, 'Home — Developer Portfolio', '/', '#0f172a', '#3b82f6')
      },
      {
        step: 2,
        title: 'Featured Projects Showcase',
        url: 'https://my-portfolio-app.github.io/projects',
        path: '/projects',
        depth: 1,
        parentStep: 1,
        parentPath: '/',
        viaLinkText: 'View Projects',
        childrenSteps: [6],
        screenshotUrl: makeMockSvg(2, 'Featured Projects Showcase', '/projects', '#0f172a', '#8b5cf6')
      },
      {
        step: 3,
        title: 'About Me & Skills',
        url: 'https://my-portfolio-app.github.io/about',
        path: '/about',
        depth: 1,
        parentStep: 1,
        parentPath: '/',
        viaLinkText: 'About Me',
        childrenSteps: [],
        screenshotUrl: makeMockSvg(3, 'About Me & Skills', '/about', '#0f172a', '#10b981')
      },
      {
        step: 4,
        title: 'Engineering Blog & Articles',
        url: 'https://my-portfolio-app.github.io/blog',
        path: '/blog',
        depth: 1,
        parentStep: 1,
        parentPath: '/',
        viaLinkText: 'Blog',
        childrenSteps: [],
        screenshotUrl: makeMockSvg(4, 'Engineering Blog & Articles', '/blog', '#0f172a', '#f59e0b')
      },
      {
        step: 5,
        title: 'Contact & Hire Me',
        url: 'https://my-portfolio-app.github.io/contact',
        path: '/contact',
        depth: 1,
        parentStep: 1,
        parentPath: '/',
        viaLinkText: 'Contact',
        childrenSteps: [],
        screenshotUrl: makeMockSvg(5, 'Contact & Hire Me', '/contact', '#0f172a', '#ec4899')
      },
      {
        step: 6,
        title: 'Project Case Study — E-Commerce UI',
        url: 'https://my-portfolio-app.github.io/projects/ecommerce-ui',
        path: '/projects/ecommerce-ui',
        depth: 2,
        parentStep: 2,
        parentPath: '/projects',
        viaLinkText: 'Case Study Details',
        childrenSteps: [],
        screenshotUrl: makeMockSvg(6, 'Project Case Study — E-Commerce UI', '/projects/ecommerce-ui', '#0f172a', '#06b6d4')
      }
    ]
  };

  statusSection.classList.remove('hidden');
  statusSpinner.classList.add('hidden');
  statusHeading.textContent = '✨ Instant Demo Sequence Loaded (6 Pages)';
  pageCountBadge.textContent = '6 pages captured';
  currentActionText.textContent = currentJobData.currentAction;
  githubInfoBanner.classList.remove('hidden');
  githubInfoBanner.innerHTML = `
    <strong>🐙 GitHub Repository Detected:</strong> <code>developer/my-portfolio-app</code>
    &nbsp;|&nbsp; <strong>Mode:</strong> GitHub Pages Live Site + Code Route Discovery
    &nbsp;|&nbsp; <strong>Pages in Sequence:</strong> 6
  `;
  logsBox.textContent = currentJobData.logs.join('\n');
  downloadZipBtn.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  renderAllViews(currentJobData);
});

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
