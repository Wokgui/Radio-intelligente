const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('AppInterfaceStudio', {
  isDesktop: true,
  openUrl: value => ipcRenderer.invoke('source:open-url', value),
  pickFolder: () => ipcRenderer.invoke('source:pick-folder'),
  pickHtml: () => ipcRenderer.invoke('source:pick-html'),
  openDemo: () => ipcRenderer.invoke('source:open-demo'),
  restoreSource: source => ipcRenderer.invoke('source:restore', source),
  injectEditor: () => ipcRenderer.invoke('source:inject-editor'),
  setPreviewMode: payload => ipcRenderer.invoke('preview:set-mode', payload),
  openAsApp: payload => ipcRenderer.invoke('preview:open-app', payload),
  adbStatus: () => ipcRenderer.invoke('adb:status'),
  adbScreenshot: payload => ipcRenderer.invoke('adb:screenshot', payload || {}),
  pickReferenceImage: () => ipcRenderer.invoke('reference:pick-image'),
  applyCssToSource: payload => ipcRenderer.invoke('source:apply-css', payload),
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
