const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const log = require('electron-log');

// 配置日志
log.transports.file.level = 'info';
log.info('Claw Dashboard 启动...');

let mainWindow = null;

// 获取资源路径
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  return path.join(__dirname, '..', relativePath);
}

function createWindow() {
  // 优先使用本地 dashboard，否则尝试 Rog 的
  const localDashboard = 'http://localhost:3000';
  const remoteDashboard = 'http://100.124.216.19:3000';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: '小龙虾舰队控制面板',
    backgroundColor: '#f5f5f7'
  });

  // 尝试加载本地，失败则用远程
  mainWindow.loadURL(localDashboard).catch(() => {
    log.info('本地 Dashboard 不可用，尝试远程...');
    mainWindow.loadURL(remoteDashboard);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log.info('Electron 就绪');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  log.error('未处理的异常:', error);
});
