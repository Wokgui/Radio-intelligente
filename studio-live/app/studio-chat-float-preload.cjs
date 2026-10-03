const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('StudioFloatingChat',{command:p=>ipcRenderer.invoke('chatgpt:floating-command',p)});
