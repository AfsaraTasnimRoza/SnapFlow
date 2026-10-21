# 📸 SnapFlow — GitHub & Website Auto Screenshot + Page Sequence Flow

With this project, you can enter any **GitHub Repository Link, GitHub Pages Link, or Live Website URL** to automatically scan website pages, capture **full-page screenshots**, and visualize **which page comes before or after another page** using a step-by-step flow with directional arrows.



##  Key Features

### 1. GitHub Links & Any Website URL Support

- Enter a **Live Website, GitHub Pages, Vercel, or Netlify URL** to automatically crawl internal links and capture screenshots of discovered pages.
- Enter a **GitHub Repository URL** (e.g., `https://github.com/user/repo`) to automatically:
  - Search for the live deployment URL or GitHub Pages website.
  - Scan the code tree and discover pages from `index.html`, Next.js `pages/`, or `app/` routes.
  - If the repository contains only raw HTML, CSS, and JavaScript files without a deployment, attempt to start a local preview server and capture screenshots of individual HTML pages.

### 2. Page Sequence Flow — See Which Page Comes Next

- Each screenshot includes a **Step Number**, such as `Step #01 → Step #02 → Step #03`.
- Clearly identify **which page a user came from** (`From Page`) and **which pages can be accessed next** (`Next Pages`).
- Visualize the discovered navigation paths to understand the website's structure and page relationships.

### 3. Three Interactive Views

- **Step-by-Step Sequence Flow View:** Follow the page sequence using directional connectors and arrows.
- **Depth-Level Architecture Map:** Explore the website hierarchy, from Level 0 (Home) to Level 1 (Main Pages) and Level 2 (Subpages).
- **Compact Screenshot Grid Gallery:** Browse screenshots in a grid layout and open them in a full-screen lightbox for zooming.

### 4. Button-State Screenshots

SnapFlow opens a fresh copy of each page and clicks up to 50 visible, labeled, non-submit buttons or tabs, saving a screenshot after each interaction. It skips form submissions and labels that indicate account, purchase, delete, or other risky actions. The ZIP manifest lists each control and its capture result.

### 5. One-Click Numbered ZIP Download

Download all screenshots in a single ZIP file, numbered according to their discovered sequence, for example:

- `01_home.png`
- `02_about.png`
- `03_contact.png`

The ZIP also includes:

- `sequence-map.json`
- `sequence-flow-report.html`

This makes it easier to review, share, and document the captured website structure.

### Sign-In for Authorized Testing

SnapFlow opens a visible Chromium window. Other sites require manual sign-in in that window; CAPTCHA and MFA must also be completed by you. SnapFlow does not expose credentials through job status, logs, screenshots metadata, or ZIP exports.

For the approved Carewell Git project only, default sign-in is configured locally in `.env`. Auto-submit is limited to the exact host in `SNAPFLOW_DEFAULT_LOGIN_HOST`, and is enabled only when the input is a GitHub repository. Direct website URLs and all other hosts use manual sign-in. `.env` is ignored by Git and excluded from screenshots and ZIPs. Complete CAPTCHA/MFA manually.



##  How to Run SnapFlow in VS Code

### Prerequisites

Make sure **Node.js v18 or later** is installed on your computer.

Download it from: https://nodejs.org

### Step 1: Open the Project Folder

1. Extract the `website-screenshot-sequencer.zip` file.
2. Open VS Code.
3. Select **File → Open Folder**.
4. Choose the extracted `website-screenshot-sequencer` folder.

### Step 2: Run the Commands in the Terminal

Open the VS Code terminal by pressing `Ctrl + ~` or selecting **Terminal → New Terminal**.

Run these three commands one by one:

```bash
npm install
npx playwright install chromium
npm start
```

**Alternative for Windows:** Double-click the `start.bat` file inside the project folder to start the setup and launch process automatically, if the script is configured to do so.

### Step 3: Open the Application in Your Browser

Once the application starts, open:

**http://localhost:3000**

Enter any supported GitHub repository link or website URL, then click **“Capture All Pages & Sequence”** to begin scanning the website and capturing screenshots.



##  Project Goal

SnapFlow aims to simplify website documentation by combining automated page discovery, full-page screenshots, numbered page sequences, navigation-flow visualization, and one-click ZIP export in a single workflow.

**Important:** Page discovery depends on the website's accessibility, routing, and navigation structure. Private pages, authentication-protected content, dynamically generated routes, and unavailable deployments may require additional configuration. Repository scanning and automatic local previews also depend on the project's framework and setup.
