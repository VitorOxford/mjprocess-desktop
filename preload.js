// preload.js (Para a Janela Principal - Sem mudanças nesta atualização)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApi', {
  /**
   * Envia o ID do usuário logado (ou null) para o processo principal.
   * @param {string | null} userId - O UUID do usuário do Supabase ou null ao deslogar.
   */
  setUserId: (userId) => ipcRenderer.send('set-user-id', userId),

  /**
   * Dispara a lógica automática para atualizar o arquivo hosts e a lista interna de notificação.
   * @param {string[]} sites - Um array com os domínios a serem bloqueados.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  updateBlockedSites: (sites) => ipcRenderer.invoke('update-blocked-sites', sites),

  /**
   * Busca o conteúdo atual do arquivo hosts (para o editor manual).
   * @returns {Promise<string>} O conteúdo do arquivo.
   */
  getHostsContent: () => ipcRenderer.invoke('get-hosts-content'),

  /**
   * Salva um novo conteúdo diretamente no arquivo hosts (do editor manual).
   * @param {string} newContent - O conteúdo completo a ser salvo.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  saveHostsContent: (newContent) => ipcRenderer.invoke('save-hosts-content'),

});

console.log('[Preload] API Principal exposta em window.electronApi');