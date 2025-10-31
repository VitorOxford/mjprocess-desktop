// notification-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Expõe um listener seguro para o HTML receber dados
  onSetData: (callback) => ipcRenderer.on('set-notification-data', callback),

  // Expõe uma função para o HTML pedir para fechar a janela
  closeNotification: () => ipcRenderer.send('notification-closed')
});