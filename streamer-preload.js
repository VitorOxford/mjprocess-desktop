// streamer-preload.js (Plano H)
const { contextBridge, ipcRenderer } = require('electron');

console.log('[STREAMER-PRELOAD] Carregado (Plano H).');

// Expondo a nova API de comunicação baseada no "Plano H"
contextBridge.exposeInMainWorld('streamerApi', {
  
  // --- Comunicação: Main -> Renderer ---

  /**
   * (RECEBE DO MAIN) O processo 'main' envia o ID do usuário (ou null no logout).
   * Este é o ponto de entrada para inicialização.
   */
  onUserSet: (callback) => {
    console.log('[STREAMER-PRELOAD] Registrando onUserSet');
    ipcRenderer.on('set-colaborador-id', (event, userId) => {
      console.log('[STREAMER-PRELOAD] Recebido evento set-colaborador-id', userId);
      callback(userId);
    });
  },

  /**
   * (RECEBE DO MAIN) O processo 'main' envia um comando forçado de parada (logout/quit).
   */
  onStopRequest: (callback) => {
    console.log('[STREAMER-PRELOAD] Registrando onStopRequest');
    ipcRenderer.on('stop-stream-request', () => {
      console.log('[STREAMER-PRELOAD] Recebido evento stop-stream-request');
      callback();
    });
  },

  // --- Comunicação: Renderer -> Main ---

  /**
   * (ENVIA PARA O MAIN) Pede as credenciais do Supabase ao processo principal.
   * @returns {Promise<{url: string, key: string}>}
   */
  getConfig: () => {
    console.log('[STREAMER-PRELOAD] Invocando get-supabase-config');
    return ipcRenderer.invoke('get-supabase-config');
  },

  /**
   * (ENVIA PARA O MAIN) Pede o ID da fonte de tela ao processo principal.
   * @returns {Promise<{sourceId: string, error: string | null}>}
   */
  getScreenSource: () => {
    console.log('[STREAMER-PRELOAD] Invocando get-screen-source');
    return ipcRenderer.invoke('get-screen-source');
  },

  /**
   * (ENVIA PARA O MAIN) Notifica o main.js que uma extensão de horário foi APROVADA.
   * O main.js DEVE chamar unlockScreen() e atualizar seu estado.
   */
  notifyMainOfUnlock: (approvedUntil) => {
     console.log('[STREAMER-PRELOAD] Enviando notify-main-of-unlock');
     ipcRenderer.send('notify-main-of-unlock', approvedUntil);
  },
  
  /**
   * (ENVIA PARA O MAIN) Notifica o main.js que uma extensão de horário foi REJEITADA.
   * O main.js deve encaminhar isso para a lockScreenWindow (se existir).
   */
  notifyMainOfRejection: () => {
      console.log('[STREAMER-PRELOAD] Enviando notify-main-of-rejection');
      ipcRenderer.send('notify-main-of-rejection');
  }

  // --- REMOVIDO (Plano H) ---
  // sendSignalToMain: (obsoleto, streamer.js agora envia sinais diretamente)
});

console.log("[STREAMER-PRELOAD] API 'streamerApi' (Plano H) exposta.");