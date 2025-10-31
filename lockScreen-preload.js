// lockScreen-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Envia uma solicitação de extensão de tempo para o processo principal.
   * @param {number} durationMinutes - A duração solicitada em minutos.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  requestTimeExtension: (durationMinutes) => ipcRenderer.invoke('request-time-extension', durationMinutes),

  /**
    * Expõe um listener para o HTML receber notificação de rejeição do main.js.
    * @param {function} callback - Função a ser chamada quando uma rejeição for recebida.
    */
  onRequestRejected: (callback) => ipcRenderer.on('request-rejected', callback),

});

console.log('[Lock Preload] API de Bloqueio exposta em window.electronAPI');