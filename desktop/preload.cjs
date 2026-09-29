const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AppInterfaceStudio', {
  isDesktop: true,
  openUrl: value => ipcRenderer.invoke('source:open-url', value),
  pickFolder: () => ipcRenderer.invoke('source:pick-folder'),
  pickHtml: () => ipcRenderer.invoke('source:pick-html'),
  openDemo: () => ipcRenderer.invoke('source:open-demo'),
  restoreSource: source => ipcRenderer.invoke('source:restore', source),
  saveProject: project => ipcRenderer.invoke('layout:save-project', project),
  openProject: () => ipcRenderer.invoke('layout:open-project'),
  saveChatGPTExport: payload => ipcRenderer.invoke('layout:save-chatgpt', payload),
  copyText: text => ipcRenderer.invoke('layout:copy-text', String(text || '')),
  appInfo: () => ipcRenderer.invoke('layout:app-info')
});

// Compatibilité avec la v1.
contextBridge.exposeInMainWorld('RadioDesktop', {
  isDesktop: true,
  saveProject: project => ipcRenderer.invoke('layout:save-project', project),
  openProject: () => ipcRenderer.invoke('layout:open-project'),
  saveChatGPTExport: payload => ipcRenderer.invoke('layout:save-chatgpt', payload),
  copyText: text => ipcRenderer.invoke('layout:copy-text', String(text || '')),
  appInfo: () => ipcRenderer.invoke('layout:app-info')
});
