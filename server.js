const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { crawlAndScreenshot, getJobStatus, getAllJobs } = require('./src/crawler');
const { resolveGitHubTarget, cleanupTempServer } = require('./src/githubHelper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));

// Ensure screenshots directory exists
const screenshotsRoot = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsRoot)) {
  fs.mkdirSync(screenshotsRoot, { recursive: true });
}

// Start a new crawl + screenshot job
app.post('/api/start', async (req, res) => {
  try {
    const {
      inputUrl,
      maxPages = 15,
      viewport = 'desktop',
      fullPage = true
    } = req.body;

    if (!inputUrl || !inputUrl.trim()) {
      return res.status(400).json({ error: 'Please provide a GitHub link or Website URL.' });
    }

    const jobId = 'job_' + Date.now();
    const jobDir = path.join(screenshotsRoot, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    // Start async job and return jobId immediately so UI can poll progress
    crawlAndScreenshot({
      jobId,
      rawInputUrl: inputUrl.trim(),
      maxPages: Math.min(Math.max(parseInt(maxPages, 10) || 15, 1), 100),
      viewport,
      fullPage: Boolean(fullPage),
      jobDir
    });

    return res.json({
      jobId,
      message: 'Crawl and screenshot sequence started!'
    });
  } catch (err) {
    console.error('Error starting job:', err);
    return res.status(500).json({ error: err.message || 'Failed to start screenshot job' });
  }
});

// Check status of a running or completed job
app.get('/api/status/:jobId', (req, res) => {
  const job = getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json(job);
});

// Get recent jobs history
app.get('/api/jobs', (req, res) => {
  return res.json(getAllJobs());
});

// Download all screenshots + sequence report as a numbered ZIP
app.get('/api/download/:jobId', (req, res) => {
  const job = getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const zipFilename = `screenshots_sequence_${req.params.jobId}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) res.status(500).send({ error: err.message });
  });

  archive.pipe(res);

  // Add each screenshot in sequence order
  job.pages.forEach((p) => {
    if (p.localFilePath && fs.existsSync(p.localFilePath)) {
      archive.file(p.localFilePath, { name: `screenshots/${p.fileName}` });
    }
  });

  // Add sequence metadata JSON
  const sequenceSummary = {
    inputUrl: job.rawInputUrl,
    resolvedBaseUrl: job.resolvedBaseUrl,
    githubInfo: job.githubInfo || null,
    capturedAt: job.startedAt,
    totalPages: job.pages.length,
    sequence: job.pages.map((p) => ({
      step: p.step,
      title: p.title,
      url: p.url,
      path: p.path,
      depth: p.depth,
      parentStep: p.parentStep,
      parentUrl: p.parentUrl,
      viaLinkText: p.viaLinkText,
      nextSteps: p.childrenSteps,
      screenshotFile: `screenshots/${p.fileName}`
    }))
  };
  archive.append(JSON.stringify(sequenceSummary, null, 2), { name: 'sequence-map.json' });

  // Add standalone HTML visual sequence report inside the ZIP
  const htmlReport = generateStandaloneHtmlReport(job);
  archive.append(htmlReport, { name: 'sequence-flow-report.html' });

  archive.finalize();
});

function generateStandaloneHtmlReport(job) {
  const cardsHtml = job.pages.map((p, idx) => {
    const nextArrow = idx < job.pages.length - 1
      ? `<div class="arrow-down">⬇ Next in Sequence: Step #${idx + 2}</div>`
      : '';
    return `
      <div class="card">
        <div class="card-header">
          <span class="badge">STEP #${String(p.step).padStart(2, '0')}</span>
          <span class="depth">Level ${p.depth}</span>
          <div class="title-wrap">
            <h2>${escapeHtml(p.title || p.path)}</h2>
            <a href="${escapeHtml(p.url)}" target="_blank">${escapeHtml(p.url)}</a>
          </div>
        </div>
        <div class="meta-bar">
          <div><strong>From Page:</strong> ${p.parentStep ? `Step #${p.parentStep} (${escapeHtml(p.parentPath || '/')}) via "${escapeHtml(p.viaLinkText || 'link')}"` : 'Entry Page (Start)'}</div>
          <div><strong>Leads To Steps:</strong> ${p.childrenSteps && p.childrenSteps.length ? p.childrenSteps.map(s => '#' + s).join(', ') : 'End node / No new internal pages'}</div>
        </div>
        <div class="img-wrap">
          <img src="screenshots/${escapeHtml(p.fileName)}" alt="Step ${p.step}" />
        </div>
      </div>
      ${nextArrow}
    `;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Website Screenshot Sequence Report - ${escapeHtml(job.rawInputUrl)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 32px; }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { margin-bottom: 8px; color: #38bdf8; }
    .sub { color: #94a3b8; margin-bottom: 32px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge { background: #2563eb; color: #fff; font-weight: 700; padding: 6px 14px; border-radius: 999px; font-size: 14px; }
    .depth { background: #334155; color: #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 12px; }
    .title-wrap h2 { margin: 0; font-size: 18px; }
    .title-wrap a { color: #38bdf8; font-size: 13px; text-decoration: none; }
    .meta-bar { background: #0f172a; padding: 10px 14px; border-radius: 8px; font-size: 13px; color: #cbd5e1; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .img-wrap img { width: 100%; border-radius: 8px; border: 1px solid #334155; }
    .arrow-down { text-align: center; color: #38bdf8; font-weight: 700; padding: 10px 0 22px; font-size: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Website Page Sequence & Screenshot Report</h1>
    <div class="sub">Source Input: <strong>${escapeHtml(job.rawInputUrl)}</strong> | Total Pages Captured: <strong>${job.pages.length}</strong></div>
    ${cardsHtml}
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.listen(PORT, () => {
  console.log('==========================================================');
  console.log('🚀 Website & GitHub Screenshot Sequencer is running!');
  console.log(`👉 Open in your browser: http://localhost:${PORT}`);
  console.log('==========================================================');
});
