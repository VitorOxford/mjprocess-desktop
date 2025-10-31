// captureWindow-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronCaptureAPI', {
  /**
   * Registra um listener para receber o pedido de captura do main process.
   * @param {function} callback - Função chamada com (event, sourceId).
   */
  onCaptureScreenRequest: (callback) => ipcRenderer.on('capture-screen', callback),

  /**
   * Envia o resultado da captura (imagem base64 ou erro) de volta para o main process.
   * @param {string | null} base64Image - A imagem em formato Data URL, ou null se erro.
   * @param {string | null} [errorMsg] - Mensagem de erro, se houver.
   */
  sendScreenshotResult: (base64Image, errorMsg = null) => {
    ipcRenderer.send('screenshot-result', base64Image, errorMsg);
  }
});

console.log('[Capture Preload] API de Captura exposta em window.electronCaptureAPI');