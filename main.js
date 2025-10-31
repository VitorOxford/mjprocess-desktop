// main.js (Plano H - Sem Realtime, apenas IPC)
const { app, BrowserWindow, ipcMain, screen, nativeTheme, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const sudo = require('sudo-prompt');
const childProcess = require('child_process');

// --- 1. CONFIGURAÇÃO ---
const APP_URL = 'https://mjprocess.onrender.com/';
const HOSTS_HEADER = '### MJPROCESS-DESKTOP-BLOCKER ###';
const HOSTS_PATH = path.join(process.env.windir || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');

// --- 2. CONFIGURAÇÃO DO SUPABASE ADMIN ---
const SUPABASE_URL = 'https://drprfuinwglmzquqtqzq.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRycHJmdWlud2dsbXpxdXF0cXpxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzY5MzIzOSwiZXhwIjoyMDY5MjY5MjM5fQ.9nH3AK3VRsW6XFigFWJVziEQMv05gFoxDJeQSAOU6Jw';

// --- MODIFICAÇÃO (Plano H): Cliente Admin SIMPLES ---
// Removida a configuração 'realtime'. Este cliente só é usado
// para DB (regras, atividade, screenshots) e Storage (uploads).
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
console.log('[INIT] Supabase Admin Client criado (Sem Realtime).');


// --- 3. VARIÁVEIS GLOBAIS ---
let currentUserId = null;
let mainWindow = null;
let activeWin;
let monitoringInterval = null;
let productivityRules = [];
let currentUserBlockedSites = [];
let lastNotifiedUrl = null;
let notificationTimeout = null;
let notificationWindow = null;
let lockScreenWindow = null;
let workSchedule = [];
let timeCheckInterval = null;
let isScreenLockedBySchedule = false;
let extensionEndTime = null;
let lastUnlockTime = 0;
let captureWindow = null; 
let screenshotInterval = null; 
const SCREENSHOT_INTERVAL_MS = 5 * 60 * 1000;
const SCREENSHOT_BUCKET = 'screenshots';

// --- MODIFICAÇÃO (Plano H) ---
let streamerWindow = null; // Janela para o renderer "trabalhador"
// --- REMOVIDO (Plano H) ---
// let extensionChannel = null; 
// let streamSignalingChannel = null; 
// --- FIM MODIFICAÇÃO ---

console.log('[INIT] Variáveis globais inicializadas.');

// --- 4. LÓGICA DE NOTIFICAÇÃO PERSONALIZADA (Bloqueio de Site) ---
function showBlockedNotification(siteTitle) {
    // ... (código existente sem alterações) ...
    console.log(`[NOTIFY] Chamando showBlockedNotification para: ${siteTitle}`);
    if (notificationWindow) {
        console.log('[NOTIFY] Fechando notificação anterior.');
        notificationWindow.close();
    }
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;
    const notifWidth = 420; const notifHeight = 100;
    console.log('[NOTIFY] Criando nova BrowserWindow de notificação.');
    notificationWindow = new BrowserWindow({
        width: notifWidth, height: notifHeight, x: width - notifWidth - 20, y: height - notifHeight - 40,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false,
        webPreferences: { preload: path.join(__dirname, 'notification-preload.js'), contextIsolation: true }
    });
    notificationWindow.loadFile(path.join(__dirname, 'notification.html'))
        .then(() => console.log('[NOTIFY] Arquivo notification.html carregado.'))
        .catch(err => console.error('[NOTIFY] Erro ao carregar notification.html:', err));

    notificationWindow.webContents.on('did-finish-load', () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        console.log(`[NOTIFY] Enviando dados para notificação (Título: ${siteTitle}, Tema: ${theme})`);
        notificationWindow.webContents.send('set-notification-data', { title: siteTitle, theme: theme });
    });
    notificationWindow.on('closed', () => {
        console.log('[NOTIFY] Janela de notificação fechada.');
        notificationWindow = null;
    });
}

// --- 5. LÓGICA DE MONITORAMENTO (Atividade + Notificação Site) ---
async function fetchProductivityRules() {
    // ... (código existente sem alterações) ...
    console.log('[RULES] Buscando regras de produtividade...');
     try {
        const { data, error, status } = await supabaseAdmin.from('productivity_rules').select('term, classification');
        if (error) {
            console.error(`[RULES] Erro ao buscar regras (Status: ${status}):`, error.message);
            productivityRules = [];
        } else {
            productivityRules = data;
            console.log(`[RULES] Regras carregadas: ${data.length}`);
        }
      } catch (e) {
          console.error('[RULES] Erro fatal ao buscar regras:', e);
          productivityRules = [];
      }
}

function classifyActivity(win) {
    // ... (código existente sem alterações) ...
     if (!win) return 'neutro';
      const appName = (win.owner?.name || '').toLowerCase();
      const windowTitle = (win.title || '').toLowerCase();
      for (const rule of productivityRules) {
        if (windowTitle.includes(rule.term.toLowerCase())) return rule.classification;
      }
      for (const rule of productivityRules) {
        if (appName.includes(rule.term.toLowerCase())) return rule.classification;
      }
      return 'neutro';
}

async function triggerScreenshot() {
    // ... (código existente sem alterações) ...
    if (!currentUserId || !captureWindow || captureWindow.isDestroyed()) {
        console.warn(`[SCREENSHOT][${currentUserId || 'NO_USER'}] Não é possível capturar: sem usuário ou janela de captura inválida.`);
        return;
    }

    try {
        console.log(`[SCREENSHOT][${currentUserId}] Iniciando captura...`);
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        const primaryDisplay = screen.getPrimaryDisplay();
        const primaryScreenSource = sources.find(source =>
            source.display_id === primaryDisplay.id.toString() || source.id.startsWith('screen:')
        );

        if (primaryScreenSource) {
            console.log(`[SCREENSHOT][${currentUserId}] Encontrada fonte da tela principal: ${primaryScreenSource.id}. Enviando para renderer...`);
            captureWindow.webContents.send('capture-screen', primaryScreenSource.id);
        } else {
            console.warn(`[SCREENSHOT][${currentUserId}] Fonte da tela principal não encontrada.`);
        }
    } catch (err) {
        console.error(`[SCREENSHOT][${currentUserId}] Erro ao obter fontes de tela:`, err);
    }
}


async function startMonitoring() {
    // ... (código existente sem alterações) ...
    console.log(`[MONITOR] Tentando iniciar monitoramento para: ${currentUserId}`);
    if (monitoringInterval || screenshotInterval) {
        console.log('[MONITOR] Limpando intervalos anteriores (monitoramento/screenshot).');
        clearInterval(monitoringInterval);
        clearInterval(screenshotInterval);
        monitoringInterval = null;
        screenshotInterval = null;
    }
    if (!currentUserId) {
        console.log('[MONITOR] Usuário não definido, monitoramento não iniciado.');
        return;
    }
    if (!captureWindow || captureWindow.isDestroyed()) {
         createCaptureWindow();
    }
    console.log(`[MONITOR] Iniciando monitoramento de atividade para: ${currentUserId}`);
    await fetchProductivityRules();

    if (!activeWin) {
        try {
            console.log("[MONITOR] Carregando módulo 'active-win'...");
            activeWin = (await import('active-win')).default;
            console.log("[MONITOR] Módulo 'active-win' carregado com sucesso.");
        } catch (e) {
            console.error("[MONITOR] FALHA CRÍTICA ao carregar 'active-win':", e);
            return;
        }
    }
    monitoringInterval = setInterval(async () => {
        if (!currentUserId) {
            console.log(`[MONITOR][ACTIVITY_LOOP][${currentUserId}] Usuário deslogado durante o loop, parando monitoramento.`);
            stopMonitoring();
            return;
        }
        try {
            const win = await activeWin();
            if (win) {
                const classification = classifyActivity(win);
                const activityData = {
                    user_id: currentUserId,
                    created_at: new Date().toISOString(),
                    application_name: win.owner.name,
                    window_title: win.title,
                    classification: classification,
                    path: win.owner.path,
                    pid: win.owner.processId,
                };
                const { error } = await supabaseAdmin.from('user_activity').insert(activityData);
                if (error) {
                    console.error(`[MONITOR][${currentUserId}][ACTIVITY_DB] Erro ao salvar atividade:`, error.message);
                }
                if (currentUserBlockedSites.length > 0) {
                    const textToCheck = (win.url || win.title || '').toLowerCase();
                    if (textToCheck) {
                        const isBlocked = currentUserBlockedSites.some(blockedSite => textToCheck.includes(blockedSite.trim().toLowerCase()));
                        if (isBlocked && lastNotifiedUrl !== textToCheck) {
                            console.log(`[MONITOR][${currentUserId}][NOTIFY] Site bloqueado detectado: ${win.title}.`);
                            showBlockedNotification(win.title);
                            lastNotifiedUrl = textToCheck;
                            clearTimeout(notificationTimeout);
                            notificationTimeout = setTimeout(() => { lastNotifiedUrl = null; }, 60 * 1000);
                        }
                    }
                }
            }
        } catch (err) {
            if (err && err.message && !err.message.includes('Failed to get text') && !err.message.includes('could not find the window')) {
                console.error(`[MONITOR][${currentUserId}][ACTIVITY_LOOP] Erro:`, err.message);
            }
        }
    }, 30000); 
    console.log(`[MONITOR][${currentUserId}] Configurando intervalo de screenshots para cada ${SCREENSHOT_INTERVAL_MS / 1000} segundos.`);
    triggerScreenshot(); 
    screenshotInterval = setInterval(triggerScreenshot, SCREENSHOT_INTERVAL_MS);
    console.log(`[MONITOR] Intervalos de monitoramento e screenshot configurados para ${currentUserId}.`);
}

function stopMonitoring() {
    // ... (código existente sem alterações) ...
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
        console.log('[MONITOR] Monitoramento de atividade parado.');
    }
    if (screenshotInterval) {
         clearInterval(screenshotInterval);
         screenshotInterval = null;
         console.log('[MONITOR] Captura de screenshots parada.');
    }
    if (captureWindow && !captureWindow.isDestroyed()) {
        console.log('[MONITOR] Fechando janela de captura...');
        captureWindow.close(); 
    }
    if (streamerWindow && !streamerWindow.isDestroyed()) {
        console.log('[MONITOR] Fechando janela de streaming...');
        streamerWindow.close(); 
    }
    console.log('[MONITOR] Processo stopMonitoring concluído.');
}

// --- 6. LÓGICA DO ARQUIVO HOSTS ---
async function saveHostsContentInternal(contentToSave) {
    // ... (código existente sem alterações) ...
    console.log('[HOSTS] Iniciando saveHostsContentInternal...');
     return new Promise((resolve, reject) => {
        const tempFilePath = path.join(app.getPath('temp'), `mjprocess_hosts_temp_${Date.now()}.txt`);
        console.log(`[HOSTS] Criando arquivo temporário em: ${tempFilePath}`);
        try {
            if (!contentToSave.endsWith('\r\n') && !contentToSave.endsWith('\n')) { contentToSave += '\r\n'; }
            fs.writeFileSync(tempFilePath, contentToSave, { encoding: 'utf8' });
            console.log('[HOSTS] Arquivo temporário escrito com sucesso.');
        } catch(writeTempErr) {
            console.error('[HOSTS] Falha ao escrever arquivo temporário:', writeTempErr);
            return reject('Falha ao preparar atualização do hosts (temp file).');
        }
        const command = `copy /Y "${tempFilePath}" "${HOSTS_PATH}"`;
        console.log(`[HOSTS] Executando comando com sudo: ${command}`);
        sudo.exec(command, { name: 'MJ Process Hosts Editor' }, (error, stdout, stderr) => {
            console.log('[HOSTS] Resultado do sudo.exec:', { error, stdout, stderr });
            try { fs.unlinkSync(tempFilePath); console.log('[HOSTS] Arquivo temporário removido.');} catch (e) { console.warn('[HOSTS] Falha ao remover arquivo temporário:', e);}
            if (error || (stderr && !/copiado\(s\)/.test(stderr.toString()))) {
                console.error('[HOSTS] Erro ao executar comando copy:', error || stderr);
                return reject('Permissão negada ou falha ao escrever hosts.');
            }
            console.log('[HOSTS] Comando copy executado com sucesso.');
            resolve('Arquivo hosts foi atualizado com sucesso.');
        });
    });
}
async function setBlockedSites(sitesToBlock) {
    // ... (código existente sem alterações) ...
    console.log(`[HOSTS] Iniciando setBlockedSites com ${sitesToBlock?.length || 0} sites.`);
     return new Promise(async (resolve, reject) => {
        let originalContent = ''; let hasBOM = false;
        try {
          console.log(`[HOSTS] Lendo arquivo hosts de: ${HOSTS_PATH}`);
          const buffer = fs.readFileSync(HOSTS_PATH);
          originalContent = buffer.toString('utf8');
          if (originalContent.charCodeAt(0) === 0xFEFF) { hasBOM = true; originalContent = originalContent.substring(1); console.log('[HOSTS] BOM detectado.'); }
          console.log(`[HOSTS] Leitura do hosts concluída (${originalContent.length} chars).`);
        } catch (readErr) {
            console.error('[HOSTS] Erro ao ler arquivo hosts:', readErr);
            return reject('Não foi possível ler o arquivo hosts.');
        }
        const lines = originalContent.split(/\r?\n/); let inBlock = false; const cleanLines = [];
        console.log(`[HOSTS] Processando ${lines.length} linhas do hosts original.`);
        for (const line of lines) {
          if (line.includes(HOSTS_HEADER) && line.trim().startsWith('#')) { inBlock = !line.includes('END'); continue; }
          if (!inBlock) { cleanLines.push(line); }
        }
        while (cleanLines.length > 0 && cleanLines[cleanLines.length - 1].trim() === '') { cleanLines.pop(); }
        console.log(`[HOSTS] ${cleanLines.length} linhas mantidas após limpeza.`);
        let newContent = (hasBOM ? '\ufeff' : '') + cleanLines.join('\r\n');
        if (sitesToBlock && sitesToBlock.length > 0) {
          console.log('[HOSTS] Adicionando novas regras de bloqueio.');
          newContent += `\r\n\r\n# ${HOSTS_HEADER}\r\n`;
          sitesToBlock.forEach(site => {
            const cleanSite = site.trim();
            if (cleanSite) {
              newContent += `127.0.0.1 ${cleanSite}\r\n`;
              if (!cleanSite.startsWith('www.')) newContent += `127.0.0.1 www.${cleanSite}\r\n`;
            }
          });
          newContent += `# END ${HOSTS_HEADER}\r\n`;
        } else {
            console.log('[HOSTS] Nenhuma regra de bloqueio a ser adicionada.');
            newContent += '\r\n';
        }
        console.log(`[HOSTS] Novo conteúdo do hosts pronto (${newContent.length} chars). Chamando saveHostsContentInternal...`);
        try { const saveResult = await saveHostsContentInternal(newContent); resolve(saveResult); }
        catch (saveError) { reject(saveError); }
      });
}

// --- 7. LÓGICA DE BLOQUEIO DE TELA POR HORÁRIO ---
async function fetchWorkSchedule(userId) {
    // ... (código existente sem alterações) ...
    // Esta função ainda usa o supabaseAdmin, o que é PERFEITO.
    // Ela faz uma query simples, não uma conexão persistente.
    console.log(`[SCHEDULE][${userId}] Iniciando fetchWorkSchedule (Query Simplificada)...`);
    try {
        const { data, error, status } = await supabaseAdmin
            .from('work_schedules')
            .select('day_of_week, start_time, end_time, is_general')
            .eq('user_id', userId);

        if (error) {
            console.error(`[SCHEDULE][${userId}] Erro ao buscar horários (Query Simplificada) (Status: ${status}):`, error.message);
            workSchedule = [];
            return [];
        }
        console.log(`[SCHEDULE][${userId}] Horários brutos recebidos do DB (Query Simplificada): ${JSON.stringify(data)}`);

        const finalSchedule = data.map(item => ({
          day_of_week: item.day_of_week,
          start_time: item.start_time,
          end_time: item.end_time
        }));

        console.log(`[SCHEDULE][${userId}] Horários processados (Query Simplificada): ${JSON.stringify(finalSchedule)}`);
        workSchedule = finalSchedule; // Atualiza a variável global
        return finalSchedule;

    } catch (e) {
        console.error(`[SCHEDULE][${userId}] Erro fatal no fetchWorkSchedule (Query Simplificada):`, e);
        workSchedule = [];
        return [];
    }
}

let isPollingForApproval = false;

async function checkWorkHours() {
    // --- MODIFICAÇÃO (Plano H): Removido o Fallback Polling ---
    // Por quê? Porque o `streamer.js` agora é o listener *confiável*.
    // O fallback polling era uma gambiarra para o listener que falhava.
    // Agora o `extensionEndTime` será atualizado pelo IPC 'notify-main-of-unlock'.
    // Manter o polling aqui só adiciona complexidade e queries desnecessárias.
    // A lógica de `isPollingForApproval` foi removida.
    
    const userIdForLog = currentUserId || 'NO_USER';
    const extensionIsActiveLog = extensionEndTime && new Date() < extensionEndTime;
    console.log(`[SCHEDULE_CHECK][${userIdForLog}] Executando verificação... (Bloqueado=${isScreenLockedBySchedule}, Extensão Ativa=${extensionIsActiveLog}, Fim Extensão=${extensionEndTime?.toLocaleString('pt-BR') || 'N/A'})`);

    if (!currentUserId) {
        if (isScreenLockedBySchedule) {
            console.log(`[SCHEDULE_CHECK][${userIdForLog}] Sem usuário logado. Garantindo desbloqueio.`);
            unlockScreen();
        }
        return;
    }

    if (workSchedule.length === 0 && !isScreenLockedBySchedule) {
        console.log(`[SCHEDULE_CHECK][${userIdForLog}] Nenhum horário carregado e tela não bloqueada. Nenhuma ação necessária.`);
        return;
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    const scheduleForToday = workSchedule.find(s => s.day_of_week === currentDay);
    let isOutsideWorkHours = !scheduleForToday || currentTime < scheduleForToday.start_time || currentTime > scheduleForToday.end_time;

    // A variável global `extensionEndTime` agora é ATUALIZADA PELO IPC
    let hasValidExtension = extensionEndTime && now < extensionEndTime;

    // --- REMOVIDO (Plano H): Bloco 'Fallback Polling' ---

    // Condição 4: Bloquear se estiver fora do horário E sem extensão válida
    if (isOutsideWorkHours && !hasValidExtension) {
        if (!isScreenLockedBySchedule) {
            console.log(`[SCHEDULE_CHECK][${userIdForLog}] DECISÃO FINAL: Bloquear tela.`);
            lockScreen();
        }
    }
    // Condição 5: Desbloquear se estiver dentro do horário OU com extensão válida
    else { 
        if (isScreenLockedBySchedule) {
            const reason = hasValidExtension ? 'Extensão Válida' : 'Dentro do Horário';
            console.log(`[SCHEDULE_CHECK][${userIdForLog}] DECISÃO FINAL: Desbloquear tela (${reason}).`);
            unlockScreen();
        }
    }
}

function lockScreen() {
    // ... (código existente sem alterações) ...
    const now = Date.now();
    if (now - lastUnlockTime < 3000) { 
        console.warn(`[LOCK] Tentativa de bloquear logo após desbloquear (dentro de 3s). Ignorando ciclo.`);
        return;
    }
    if (lockScreenWindow) {
        console.warn('[LOCK] Tentativa de bloquear tela, mas a janela lockScreenWindow já existe. Ignorando.');
        return;
    }
    console.log('[LOCK] Iniciando processo lockScreen...');
    isScreenLockedBySchedule = true;
    console.log(`[LOCK] Estado definido: isScreenLockedBySchedule=${isScreenLockedBySchedule}`);
    try {
        console.log('[LOCK] Executando comando: rundll32.exe user32.dll,LockWorkStation');
        const lockProcess = childProcess.spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true, stdio: 'ignore' });
        lockProcess.on('error', (err) => console.error('[LOCK] Erro ao tentar iniciar LockWorkStation:', err));
        lockProcess.unref();
        console.log('[LOCK] Comando LockWorkStation disparado.');
    } catch (err) { console.error('[LOCK] Exceção ao tentar disparar LockWorkStation:', err); }
    console.log('[LOCK] Criando BrowserWindow para lockScreenWindow com opções aprimoradas...');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size; 
    lockScreenWindow = new BrowserWindow({
        width: width, height: height, x: 0, y: 0,
        frame: false, transparent: false, skipTaskbar: true, resizable: false,
        movable: false, fullscreen: true, kiosk: true, focusable: true, 
        webPreferences: {
            preload: path.join(__dirname, 'lockScreen-preload.js'),
            contextIsolation: true,
            devTools: false 
        },
    });
    console.log('[LOCK] BrowserWindow criada.');
    lockScreenWindow.setAlwaysOnTop(true, 'screen-saver');
    console.log("[LOCK] Nível 'AlwaysOnTop' definido como 'screen-saver'.");
    lockScreenWindow.focus();
    console.log("[LOCK] Foco inicial solicitado.");
    console.log('[LOCK] Carregando lockScreen.html...');
    lockScreenWindow.loadFile(path.join(__dirname, 'lockScreen.html'))
        .then(() => console.log('[LOCK] Arquivo lockScreen.html carregado com sucesso.'))
        .catch(err => console.error('[LOCK] ERRO ao carregar lockScreen.html:', err));
    lockScreenWindow.setMenu(null);
    const focusInterval = setInterval(() => {
        if (lockScreenWindow && !lockScreenWindow.isDestroyed()) {
             lockScreenWindow.focus(); 
             if (!lockScreenWindow.isFullScreen()) {
                 lockScreenWindow.setFullScreen(true);
             }
             if (!lockScreenWindow.isKiosk()) { 
                lockScreenWindow.setKiosk(true);
             }
        } else {
            clearInterval(focusInterval);
        }
    }, 500); 
    lockScreenWindow.on('closed', () => {
        console.log('[LOCK] Evento "closed" da lockScreenWindow disparado.');
        if (focusInterval) clearInterval(focusInterval);
        lockScreenWindow = null;
        console.log('[LOCK] Variáveis lockScreenWindow e focusInterval limpas.');
    });
     lockScreenWindow.on('close', (event) => {
        if (isScreenLockedBySchedule) { 
             console.warn('[LOCK] Tentativa de fechar a janela de bloqueio detectada enquanto ainda bloqueado. Prevenindo...');
             event.preventDefault();
             lockScreenWindow.focus();
             lockScreenWindow.setAlwaysOnTop(true, 'screen-saver');
             lockScreenWindow.setFullScreen(true);
             lockScreenWindow.setKiosk(true);
        } else {
             console.log('[LOCK] Fechamento permitido pois não está mais no estado bloqueado.');
        }
    });
     console.log('[LOCK] Processo lockScreen concluído (janela deve estar aparecendo e na frente).');
}

function unlockScreen() {
    // ... (código existente sem alterações) ...
     const userIdForLog = currentUserId || 'NO_USER';
     console.log(`[UNLOCK][${userIdForLog}] Iniciando unlockScreen... Estado ANTES: isScreenLockedBySchedule=${isScreenLockedBySchedule}`);
     isScreenLockedBySchedule = false;
     lastUnlockTime = Date.now(); 
     console.log(`[UNLOCK][${userIdForLog}] Estado DEPOIS: isScreenLockedBySchedule=${isScreenLockedBySchedule}. lastUnlockTime=${new Date(lastUnlockTime).toLocaleTimeString('pt-BR')}`);
     if (lockScreenWindow && !lockScreenWindow.isDestroyed()) {
        console.log('[UNLOCK] Janela lockScreenWindow encontrada e não destruída. Removendo listeners e chamando destroy()...');
        try {
            lockScreenWindow.removeAllListeners();
            lockScreenWindow.destroy();
            console.log('[UNLOCK] lockScreenWindow.destroy() chamado.');
        } catch (error) {
            console.error('[UNLOCK] Erro ao chamar lockScreenWindow.destroy():', error);
        } finally {
             lockScreenWindow = null;
             console.log('[UNLOCK] Referência lockScreenWindow definida como null.');
        }
     } else {
        console.log('[UNLOCK] Nenhuma janela lockScreenWindow encontrada/válida para fechar.');
     }
     console.log(`[UNLOCK][${userIdForLog}] Processo unlockScreen concluído.`);
}


function startWorkHoursCheck() {
    // ... (código existente sem alterações) ...
    stopWorkHoursCheck();
    if (!currentUserId) {
        console.log('[SCHEDULE] Não iniciando verificação de horário: usuário não logado.');
        return;
    }
    console.log(`[SCHEDULE][${currentUserId}] Iniciando verificação de horário de trabalho (intervalo de 60s).`);
    checkWorkHours(); 
    timeCheckInterval = setInterval(() => { 
        console.log(`[SCHEDULE][INTERVAL] Disparado checkWorkHours para ${currentUserId || 'NO_USER'}`);
        checkWorkHours();
    }, 60 * 1000);
}

function stopWorkHoursCheck() {
    // ... (código existente sem alterações) ...
    if (timeCheckInterval) {
        clearInterval(timeCheckInterval);
        timeCheckInterval = null;
        console.log('[SCHEDULE] Verificação de horário de trabalho parada.');
    }
}

// --- ADIÇÃO (Plano G/H): Função para encaminhar 'stop' para o renderer ---
function forwardStopStreamToRenderer() {
  if (streamerWindow && !streamerWindow.isDestroyed()) {
    console.log('[IPC] Enviando comando stop-stream-request para streamerWindow');
    streamerWindow.webContents.send('stop-stream-request');
  }
}

// --- 8. HANDLERS DE COMUNICAÇÃO (IPC) ---
ipcMain.on('set-user-id', async (event, userId) => {
    // --- MODIFICAÇÃO (Plano H): Removidos listeners de Realtime ---
    console.log(`[AUTH][IPC] Recebido 'set-user-id' com userId: ${userId} (currentUserId era: ${currentUserId})`);
    
    // Notifica a streamerWindow SOBRE A MUDANÇA DE ID
    if (streamerWindow && !streamerWindow.isDestroyed()) {
        console.log(`[AUTH][IPC] Enviando 'set-colaborador-id' (${userId}) para a streamerWindow.`);
        streamerWindow.webContents.send('set-colaborador-id', userId);
    }

    if (userId && userId !== currentUserId) {
        console.log(`[AUTH][IPC] Novo login detectado para ${userId}.`);
        currentUserId = userId;
        workSchedule = await fetchWorkSchedule(userId);
        startMonitoring();
        startWorkHoursCheck();
        // REMOVIDO (Plano H): setupExtensionListener(userId);
        // REMOVIDO (Plano G): setupStreamSignalingListener(userId);

    } else if (!userId && currentUserId) {
        console.log(`[AUTH][IPC] Logout detectado para ${currentUserId}. Limpando estado...`);
        const oldUserId = currentUserId;
        stopMonitoring();
        stopWorkHoursCheck();
        unlockScreen(); 
        // REMOVIDO (Plano H): removeExtensionListener();
        forwardStopStreamToRenderer(); // Manda o renderer parar seus canais
        // REMOVIDO (Plano G): removeStreamSignalingListener();
        currentUserId = null;
        currentUserBlockedSites = [];
        workSchedule = [];
        extensionEndTime = null;
        isScreenLockedBySchedule = false; 
        console.log(`[AUTH][IPC] Estado limpo para usuário ${oldUserId}.`);
    } else if (userId && userId === currentUserId) {
         console.log(`[AUTH][IPC] Recebido 'set-user-id' para o usuário já logado (${userId}). Nenhuma ação necessária.`);
    } else if (!userId && !currentUserId) {
         console.log("[AUTH][IPC] Recebido 'set-user-id' com null, mas nenhum usuário estava logado. Nenhuma ação necessária.");
    }
});

ipcMain.handle('update-blocked-sites', async (event, sites) => {
    // ... (código existente sem alterações) ...
    console.log('[HOSTS][IPC] Recebido handle "update-blocked-sites".');
     currentUserBlockedSites = sites || [];
      console.log('[HOSTS][IPC] Lista interna de sites atualizada:', currentUserBlockedSites);
      try {
        const result = await setBlockedSites(sites);
        console.log('[HOSTS][IPC] Resultado da atualização do arquivo hosts:', result);
        return { success: true, message: result };
      } catch (error) {
        console.error('[HOSTS][IPC] Erro ao atualizar arquivo hosts:', error);
        currentUserBlockedSites = [];
        return { success: false, message: error.toString() };
      }
});

ipcMain.on('notification-closed', () => {
    // ... (código existente sem alterações) ...
    console.log('[NOTIFY][IPC] Recebido "notification-closed".');
     if (notificationWindow) {
        console.log('[NOTIFY][IPC] Fechando janela de notificação.');
        notificationWindow.close();
      } else {
         console.log('[NOTIFY][IPC] Janela de notificação já estava fechada.');
      }
});

ipcMain.handle('get-hosts-content', async () => {
    // ... (código existente sem alterações) ...
     console.log('[HOSTS][IPC] Recebido handle "get-hosts-content".');
     try {
         const content = fs.readFileSync(HOSTS_PATH, 'utf8');
         console.log(`[HOSTS][IPC] Conteúdo do hosts lido com sucesso (${content.length} chars).`);
         return content;
     }
      catch (error) {
         console.error('[HOSTS][IPC] Erro ao ler arquivo hosts:', error);
         return `ERRO AO LER O ARQUIVO HOSTS:\n${error.message}`;
      }
});
ipcMain.handle('save-hosts-content', async (event, newContent) => {
    // ... (código existente sem alterações) ...
   console.log('[HOSTS][IPC] Recebido handle "save-hosts-content".');
   try {
       const result = await saveHostsContentInternal(newContent);
       console.log('[HOSTS][IPC] Conteúdo do hosts salvo com sucesso.');
       return { success: true, message: result };
   }
   catch (error) {
       console.error('[HOSTS][IPC] Erro ao salvar hosts:', error);
       return { success: false, message: error.toString() };
   }
});

ipcMain.handle('request-time-extension', async (event, durationMinutes) => {
    // ... (código existente sem alterações) ...
    // Esta query INSERT também usa o supabaseAdmin, o que é PERFEITO.
    console.log(`[SCHEDULE][IPC] Recebido handle "request-time-extension" para ${durationMinutes} min (Usuário: ${currentUserId}).`);
    if (!currentUserId) {
        console.error('[SCHEDULE][IPC] Erro: Solicitação recebida sem usuário logado.');
        return { success: false, message: 'Usuário não logado.' };
    }
    try {
        console.log(`[SCHEDULE][IPC] Inserindo solicitação no DB para ${currentUserId}...`);
        const { data, error } = await supabaseAdmin
            .from('time_extension_requests')
            .insert({ user_id: currentUserId, duration_minutes: durationMinutes, status: 'pending' })
            .select()
            .single();
        if (error) {
            console.error('[SCHEDULE][IPC] Erro do Supabase ao inserir solicitação:', error.message);
            return { success: false, message: 'Erro ao registrar solicitação no banco de dados.' };
        }
        console.log(`[SCHEDULE][IPC] Solicitação registrada com sucesso no DB. ID: ${data?.id}`);
        return { success: true, message: 'Solicitação enviada para aprovação.' };
    } catch (e) {
        console.error('[SCHEDULE][IPC] Erro inesperado ao registrar solicitação:', e);
        return { success: false, message: 'Erro inesperado no servidor do aplicativo.' };
    }
});

ipcMain.on('screenshot-result', async (event, base64Image, errorMsg) => {
    // ... (código existente sem alterações) ...
    const userIdForLog = currentUserId || 'UNKNOWN_USER'; 
    if (errorMsg) {
        console.error(`[SCREENSHOT][${userIdForLog}][IPC_RESULT] Erro recebido do renderer:`, errorMsg);
        return;
    }
    if (base64Image && currentUserId) { 
        const base64Data = base64Image.split(',')[1];
        if (!base64Data) {
             console.error(`[SCREENSHOT][${currentUserId}][IPC_RESULT] Formato base64 inválido recebido.`);
             return;
        }
        const buffer = Buffer.from(base64Data, 'base64');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `screenshot-${timestamp}.png`;
        const storagePath = `user_screenshots/${currentUserId}/${fileName}`; 
        console.log(`[SCREENSHOT][${currentUserId}][IPC_RESULT] Recebido screenshot (${(buffer.length / 1024).toFixed(1)} KB). Fazendo upload para ${storagePath}...`);
        try {
            const { data: storageData, error: storageError } = await supabaseAdmin.storage
                .from(SCREENSHOT_BUCKET)
                .upload(storagePath, buffer, { contentType: 'image/png', upsert: false });
            if (storageError) {
                console.error(`[SCREENSHOT][${currentUserId}][UPLOAD_STORAGE] Erro no upload do arquivo:`, storageError.message);
                return;
            }
            console.log(`[SCREENSHOT][${currentUserId}][UPLOAD_STORAGE] Upload do arquivo concluído: ${storageData?.path}`);
            const { data: metaData, error: metaError } = await supabaseAdmin
                .from('user_screenshots')
                .insert({ user_id: currentUserId, storage_path: storagePath });
             if (metaError) {
                 console.error(`[SCREENSHOT][${currentUserId}][UPLOAD_META] Erro ao inserir metadados:`, metaError.message);
             } else {
                  console.log(`[SCREENSHOT][${currentUserId}][UPLOAD_META] Metadados inseridos com sucesso.`);
             }
        } catch (uploadError) {
             console.error(`[SCREENSHOT][${currentUserId}][UPLOAD_GENERAL] Erro GERAL durante upload/registro:`, uploadError);
        }
    } else if (!currentUserId) {
         console.warn(`[SCREENSHOT][IPC_RESULT] Screenshot recebido, mas usuário deslogou antes do upload.`);
    }
});

// --- ADIÇÃO (Plano H): Listener para comando de DESBLOQUEIO vindo do streamer ---
ipcMain.on('notify-main-of-unlock', (event, approvedUntil) => {
    const userIdForLog = currentUserId || 'UNKNOWN_USER';
    console.log(`[IPC][Plano H][UNLOCK] Recebido comando 'notify-main-of-unlock' do streamer. Válido até: ${approvedUntil}`);
    
    if (approvedUntil) {
         const approvedUntilDate = new Date(approvedUntil);
         if (!extensionEndTime || approvedUntilDate > extensionEndTime) {
            extensionEndTime = approvedUntilDate;
            console.log(`[IPC][Plano H][UNLOCK][${userIdForLog}] Atualizando extensionEndTime para ${extensionEndTime.toLocaleString('pt-BR')}.`);
             if (isScreenLockedBySchedule) {
                 console.log(`[IPC][Plano H][UNLOCK][${userIdForLog}] Tela estava bloqueada, chamando unlockScreen() agora.`);
                 unlockScreen();
             }
        }
    }
});

// --- ADIÇÃO (Plano H): Listener para comando de REJEIÇÃO vindo do streamer ---
ipcMain.on('notify-main-of-rejection', (event) => {
     const userIdForLog = currentUserId || 'UNKNOWN_USER';
     console.log(`[IPC][Plano H][REJECT][${userIdForLog}] Recebido comando 'notify-main-of-rejection' do streamer.`);
     
     if (lockScreenWindow && !lockScreenWindow.isDestroyed()) {
        console.log(`[IPC][Plano H][REJECT][${userIdForLog}] Enviando evento 'request-rejected' para a janela de bloqueio.`);
        lockScreenWindow.webContents.send('request-rejected');
     }
});

// --- ADIÇÃO (Plano G/H): Handler para pedir config do Supabase ---
ipcMain.handle('get-supabase-config', () => {
  console.log('[IPC][Plano G/H] Fornecendo configuração Supabase para streamerWindow.');
  return {
    url: SUPABASE_URL,
    key: SUPABASE_SERVICE_KEY // O streamer PRECISA da service key para enviar broadcasts
  };
});

// --- ADIÇÃO (Plano G/H): Handler para pedir fonte da tela ---
ipcMain.handle('get-screen-source', async () => {
  console.log('[IPC][Plano G/H] Buscando ID da fonte de ecrã...');
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const primaryDisplay = screen.getPrimaryDisplay();
    const primaryScreenSource = sources.find(source =>
      source.display_id === primaryDisplay.id.toString() || source.id.startsWith('screen:')
    );
    if (primaryScreenSource) {
      console.log('[IPC][Plano G/H] Fonte de ecrã encontrada:', primaryScreenSource.id);
      return { sourceId: primaryScreenSource.id, error: null };
    } else {
      console.error('[IPC][Plano G/H] Fonte de ecrã principal não encontrada.');
      return { sourceId: null, error: 'Fonte de ecrã principal não encontrada.' };
    }
  } catch (err) {
    console.error('[IPC][Plano G/H] Erro ao obter fontes de tela:', err);
    return { sourceId: null, error: err.message };
  }
});


// --- REMOVIDO (Plano H) ---
// ipcMain.on('stream-signal-out', ...);
// Este handler é obsoleto pois o streamer.js agora envia sinais diretamente.


// --- 9. LISTENER REALTIME SUPABASE ---

// --- REMOVIDO (Plano H) ---
// A função setupExtensionListener foi movida para streamer.js
// A função removeExtensionListener foi removida.
// As funções setupStreamSignalingListener e removeStreamSignalingListener já tinham sido removidas.


// --- 10. LÓGICA DA JANELA PRINCIPAL ---
function createWindow() {
    // ... (código existente sem alterações) ...
    console.log('[WINDOW] Iniciando createWindow...');
    if (process.platform === 'win32') {
        console.log('[WINDOW] Definindo AppUserModelId para Windows.');
        app.setAppUserModelId("com.mjprocess.desktop");
    }
    console.log('[WINDOW] Criando BrowserWindow principal...');
    mainWindow = new BrowserWindow({
        width: 1280, height: 720,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: false,
        },
        icon: path.join(__dirname, 'build/icon.png')
    });
    console.log('[WINDOW] BrowserWindow criada.');
    console.log(`[WINDOW] Carregando URL: ${APP_URL}`);
    mainWindow.loadURL(APP_URL)
     .then(() => console.log(`[WINDOW] URL ${APP_URL} carregada com sucesso.`))
     .catch(err => console.error(`[WINDOW] ERRO ao carregar URL ${APP_URL}:`, err));
    mainWindow.setMenu(null);
    console.log('[WINDOW] Menu da janela principal removido.');
    console.log('[WINDOW] Abrindo DevTools da janela principal...');
    mainWindow.webContents.openDevTools();
    mainWindow.on('closed', () => {
        console.log('[WINDOW] Evento "closed" da janela principal.');
        mainWindow = null;
    });
    console.log('[WINDOW] Função createWindow concluída.');
}

// --- CICLO DE VIDA DO APP ---
console.log('[APP] Registrando listeners do ciclo de vida...');

function createCaptureWindow() {
    // ... (código existente sem alterações) ...
    console.log('[CAPTURE] Criando janela de captura invisível...');
    if (captureWindow) {
        console.warn('[CAPTURE] Janela de captura já existe.');
        return;
    }
    captureWindow = new BrowserWindow({
        width: 400, 
        height: 300,
        show: false, // MANTENHA INVISÍVEL
        webPreferences: {
            preload: path.join(__dirname, 'captureWindow-preload.js'),
            contextIsolation: true,
            sandbox: false, 
            backgroundThrottling: false 
        }
    });
    captureWindow.loadFile(path.join(__dirname, 'captureWindow.html'))
        .then(() => console.log('[CAPTURE] Arquivo captureWindow.html carregado.'))
        .catch(err => console.error('[CAPTURE] Erro ao carregar captureWindow.html:', err));
    captureWindow.on('closed', () => {
        console.log('[CAPTURE] Janela de captura fechada.');
        captureWindow = null;
    });
}

function createStreamerWindow() {
    // --- MODIFICAÇÃO (Plano H): Voltando a ser invisível ---
    console.log('[STREAMER] Criando janela de streaming (trabalhadora) invisível...');
    if (streamerWindow) {
        console.warn('[STREAMER] Janela de streaming já existe.');
        return;
    }
    streamerWindow = new BrowserWindow({
        width: 400, 
        height: 300,
        show: true, // MANTENHA 'false'. Mude para 'true' APENAS se precisar depurar o streamer.js
        webPreferences: {
            preload: path.join(__dirname, 'streamer-preload.js'), 
            contextIsolation: true,
            sandbox: false, 
            backgroundThrottling: false 
        }
    });
    streamerWindow.loadFile(path.join(__dirname, 'streamer.html')) 
        .then(() => console.log('[STREAMER] Arquivo streamer.html carregado.'))
        .catch(err => console.error('[STREAMER] Erro ao carregar streamer.html:', err));

    // MANTENHA COMENTADO a menos que precise depurar o renderer do streamer
    // streamerWindow.webContents.openDevTools({ mode: 'detach' }); 
    
    streamerWindow.on('closed', () => {
        console.log('[STREAMER] Janela de streaming fechada.');
        streamerWindow = null;
    });
}

app.whenReady().then(() => {
    console.log('[APP] Evento "ready" disparado. Chamando createWindow...');
    createWindow();
    createCaptureWindow();
    createStreamerWindow(); 

    app.on('activate', () => {
        console.log('[APP] Evento "activate" disparado.');
        if (BrowserWindow.getAllWindows().length === 0) {
            console.log('[APP] Nenhuma janela aberta, chamando createWindow...');
            createWindow();
        } else {
            console.log('[APP] Janela(s) já existem, focando a principal se possível.');
            if(mainWindow) mainWindow.focus();
        }
    });
    console.log('[APP] Listener "activate" registrado.');
});

app.on('window-all-closed', () => {
    // --- MODIFICAÇÃO (Plano H): Limpeza de listeners ---
    console.log('[APP] Evento "window-all-closed" disparado.');
    if (process.platform !== 'darwin' && !lockScreenWindow) {
        console.log('[APP] Não é macOS e lockScreenWindow não existe, encerrando o aplicativo...');
        // REMOVIDO (Plano H): removeExtensionListener();
        // REMOVIDO (Plano G): removeStreamSignalingListener();
        app.quit();
    } else if (lockScreenWindow) {
        console.log('[APP] Janela principal fechada, mas lockScreenWindow ainda existe. App continua rodando.');
    } else {
         console.log('[APP] É macOS, aplicativo continua rodando em background.');
    }
});

app.on('before-quit', (event) => {
    // --- MODIFICAÇÃO (Plano H): Limpeza de listeners ---
    console.log('[APP] Evento "before-quit" disparado. Realizando limpeza...');
    stopMonitoring();
    stopWorkHoursCheck();
    // REMOVIDO (Plano H): removeExtensionListener();
    forwardStopStreamToRenderer(); // Manda o renderer parar
    // REMOVIDO (Plano G): removeStreamSignalingListener();
    
    if (lockScreenWindow && !lockScreenWindow.isDestroyed()) {
        console.log('[APP][BEFORE-QUIT] Destruindo janela de bloqueio remanescente...');
        lockScreenWindow.destroy();
    }
    if (streamerWindow && !streamerWindow.isDestroyed()) {
        console.log('[APP][BEFORE-QUIT] Destruindo janela de streaming remanescente...');
        streamerWindow.destroy();
    }
    console.log('[APP][BEFORE-QUIT] Limpeza concluída.');
});

process.on('uncaughtException', (error, origin) => {
    // --- MODIFICAÇÃO (Plano H): Limpeza de listeners ---
    console.error(`[PROCESS] ERRO NÃO CAPTURADO FATAL! Origem: ${origin}`, error);
    try { 
        // REMOVIDO (Plano H): removeExtensionListener();
        // REMOVIDO (Plano G): removeStreamSignalingListener();
    } catch (e) { console.error("Erro ao limpar durante uncaughtException:", e)}
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[PROCESS] PROMISE REJEITADA NÃO TRATADA:', reason, 'Promise:', promise);
});

console.log('[INIT] Fim do script main.js (listeners registrados). Aguardando evento "ready"...');