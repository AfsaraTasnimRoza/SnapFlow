# 📸 SnapFlow — GitHub & Website Auto Screenshot + Page Sequence Flow

Ei project-ti diye apni jekono **GitHub Repository Link**, **GitHub Pages Link**, othoba **Jekono Live Website-er URL** dile automatic puro website-er shob page scan kore **Full-Page Screenshot** nibe ebong **kontar por kon page ashe (Page Sequence Flow)** sheta step-by-step arrow সহ dekhabe!

---

## ✨ Key Features (Ki Ki Thakche)

1. **GitHub Link & Any Website Link Support**:
   - **Live Website / GitHub Pages / Vercel / Netlify Link** dile automatic internal link crawl kore shob page-er screenshot ney.
   - **GitHub Repository Link** (`https://github.com/user/repo`) dile automatic:
     - Repo-r live deployment link ba GitHub Pages khuje ber kore.
     - Code tree scan kore (`index.html`, Next.js `pages/` ba `app/` routes) shob page-er list ber kore.
     - Jodi repo-ti shudhu raw HTML/CSS/JS hoy (deploy kora na thake), taholeo automatic local preview server on kore protita HTML page-er screenshot tule dey!
2. **Page Sequence Flow (`Kontar Por Kon Page`)**:
   - Protita screenshot-er sathe **Step Number (`Step #01` -> `Step #02` -> `Step #03`)** thakbe.
   - **Kon page theke kon link click kore ei page-e esheche** (`From Page`) ebong **ei page theke poroborti kon kon page-e jawa jay** (`Next Pages`) sheta clearly dekhabe.
3. **3 Interactive Views**:
   - **Step-by-Step Sequence Flow View** (with directional connectors)
   - **Depth Level Architecture Map** (Level 0 Home -> Level 1 Main Pages -> Level 2 Sub-pages)
   - **Compact Screenshot Grid Gallery** + Full-Screen Lightbox Zoom
4. **One-Click Numbered ZIP Download**:
   - Shob screenshot sequence onujayi rename hoye (`01_home.png`, `02_about.png`, ...) sathe `sequence-map.json` ebong `sequence-flow-report.html` shoho ekta `.zip` file hishebe download kora jabe.

---

## 🚀 VS Code-e Kivabe Run Korben (Step-by-Step)

### Prerequisites
- Apnar computer-e **Node.js** (v18 ba tar upore) install thakte hobe (`https://nodejs.org`).

### Step 1: Folder Open Korun
1. `website-screenshot-sequencer.zip` file-ti **Extract (Unzip)** korun.
2. **VS Code** open kore extracted `website-screenshot-sequencer` folder-ti open korun (`File -> Open Folder`).

### Step 2: Terminal-e Command Run Korun
VS Code-er terminal (`Ctrl + ~` ba `Terminal -> New Terminal`) open kore নিচের ৩টি কমান্ড দিন:

```bash
npm install
npx playwright install chromium
npm start
```

*(অথবা Windows ব্যবহার করলে সরাসরি ফোল্ডারের ভেতরে থাকা **`start.bat`** ফাইলে ডাবল-ক্লিক করলেই সব অটোমেটিক ইনস্টল হয়ে ব্রাউজারে ওপেন হয়ে যাবে!)*

### Step 3: Browser-e Use Korun
Terminal-e মেসেজ আসলে আপনার ব্রাউজারে যান:
👉 **http://localhost:3000**

সেখানে যেকোনো GitHub লিংক বা Website লিংক বসিয়ে **"Capture All Pages & Sequence"** বাটনে ক্লিক করলেই কাজ শুরু হয়ে যাবে!
