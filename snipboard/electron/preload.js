const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipNative', {
  loadVault: () => ipcRenderer.invoke('vault:load'),
  saveVault: (obj) => ipcRenderer.invoke('vault:save', obj),
  copy: (c) => ipcRenderer.invoke('clip:write', c),
  clearIf: (text) => ipcRenderer.invoke('clip:clearIf', text),
  saveFile: (name, content) => ipcRenderer.invoke('file:save', name, content),
  setMini: (on) => ipcRenderer.invoke('win:mini', on),
});
