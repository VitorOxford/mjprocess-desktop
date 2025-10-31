// timerNotification-preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Registra uma função de callback para receber dados (mensagem, tempo restante) do processo principal.
   * @param {function} callback - Função que será chamada com (event, data).
   * data = { message: string, remainingMs?: number, totalMs?: number }
   */
  onSetTimerData: (callback) => ipcRenderer.on('set-timer-notification-data', callback),

  /**
   * Envia uma mensagem para o processo principal pedindo para fechar esta janela de notificação.
   */
  closeTimerNotification: () => ipcRenderer.send('timer-notification-closed')
});

console.log('[Timer Preload] API de Notificação de Tempo exposta em window.electronAPI');