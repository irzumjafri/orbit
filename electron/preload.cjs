const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  installStep: (step, data) => ipcRenderer.invoke('install-step', step, data),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});

contextBridge.exposeInMainWorld('electronEnv', {
  platform: process.platform
});
