// ScrapCRM — Electron main process
const { app, BrowserWindow } = require('electron');
const path = require('path');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'ScrapCRM',
    backgroundColor: '#0d1117',
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true },
  });
  if (process.env.SCRAPCRM_DEBUG === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  // The Express server (embedded) serves the UI + API
  const { createServer } = require(path.join(__dirname, '..', 'server.js'));
  createServer(8899);
  require(path.join(__dirname, '..', 'orchestrator')).startWatcher();
  require(path.join(__dirname, '..', 'agents', 'scraper')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'email_auditor')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'website_analyzer')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'seo_expert')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'social_ads')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'google_ranking')).startWorker();
  require(path.join(__dirname, '..', 'agents', 'discovery')).startDiscovery();

  setTimeout(() => win.loadURL('http://localhost:8899'), 800);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
