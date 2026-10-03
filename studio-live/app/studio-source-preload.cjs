const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studioSource',{command:p=>ipcRenderer.invoke('studio-source:command',p)});
