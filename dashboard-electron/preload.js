const { contextBridge, ipcRenderer } = require('electron');

// 暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => {
    require('electron').shell.openExternal(url);
  },
  platform: process.platform
});
