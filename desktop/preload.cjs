const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('RadioDesktop', {
  isDesktop: true,
  saveProject: project => ipcRenderer.invoke('layout:save-project', project),
  openProject: () => ipcRenderer.invoke('layout:open-project'),
  saveChatGPTExport: payload => ipcRenderer.invoke('layout:save-chatgpt', payload),
  copyText: text => ipcRenderer.invoke('layout:copy-text', String(text || '')),
  appInfo: () => ipcRenderer.invoke('layout:app-info')
});
