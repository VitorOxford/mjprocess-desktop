// streamer.js (Refatorado para "Plano H" + Logs ICE Detalhados v4 + TURN Metered.live)

console.log('[STREAMER] Script renderer (Plano H + Logs ICE + Metered.live) carregado.');

// Acessa o createClient exposto globalmente pelo script CDN
const { createClient } = supabase;

// --- Configuração WebRTC (AGORA É DINÂMICA) ---
const METERED_DOMAIN = 'estudiomj.metered.live';
// CORREÇÃO: Esta é a 'apiKey' da credencial, não a 'secretKey' da conta
const METERED_CREDENTIAL_API_KEY = '332adb7b0fd78cc20c6addea17bc43ec4733';

/**
 * Busca a configuração de ICE (STUN + TURN) dinamicamente do Metered.live
 * @returns {Promise<RTCConfiguration | null>}
 */
async function getDynamicRtcConfig() {
  console.log('[STREAMER][METERED] Buscando configuração ICE da API do Metered.live...');
  try {
    
    // CORREÇÃO FINAL: URL no plural (/credentials) e parâmetro (apiKey)
    const response = await fetch(`https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_CREDENTIAL_API_KEY}`);
    
    if (!response.ok) {
      throw new Error(`[STREAMER][METERED] Falha ao buscar credenciais: ${response.status} ${response.statusText}`);
    }
    
    const iceServers = await response.json();
    
    if (!iceServers || iceServers.length === 0) {
      throw new Error('[STREAMER][METERED] API não retornou servidores ICE.');
    }
    
    // CORREÇÃO: A resposta do Metered já inclui STUN, então usamos ela diretamente.
    const config = {
      iceServers: iceServers
    };
    
    console.log('[STREAMER][METERED] Configuração ICE (TURN) obtida com sucesso.');
    return config;

  } catch (error) {
    console.error(error);
    console.warn('[STREAMER][METERED] FALHA. Usando apenas STUN como fallback.');
    // Fallback apenas com STUN do Google se a API falhar
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
  }
}

// --- Variáveis de Estado Globais ---
let peerConnection;
let localStream;
let currentAdminId = null; // Para saber para quem enviar a resposta
let supabaseClient = null; // Cliente Supabase local
let colaboradorId = null;
let streamChannel = null; // Canal Realtime para streaming
let extensionChannel = null; // Canal Realtime para extensões de horário


// --- INICIALIZAÇÃO E IPC ---

window.streamerApi.onUserSet((userId) => {
  if (userId) {
    console.log('[STREAMER] ID do Colaborador recebido:', userId);
    colaboradorId = userId;
    initializeSupabaseAndChannels();
  } else {
    console.log('[STREAMER] Usuário deslogado. Parando tudo.');
    colaboradorId = null;
    stopStreaming();
    disconnectExtensionListenerChannel();
    supabaseClient = null;
  }
});

async function initializeSupabaseAndChannels() {
  try {
    console.log('[STREAMER] Obtendo configuração Supabase do main.js...');
    const config = await window.streamerApi.getConfig();
    console.log('[STREAMER] Configuração Supabase recebida. Criando cliente local (Forçando Longpoll)...');
    
    supabaseClient = createClient(config.url, config.key, {
      realtime: {
        params: {
          transport: 'longpoll' // Força Long Polling (Plano H)
        }
      }
    });

    console.log('[STREAMER] Cliente Supabase local criado. Conectando canais...');
    connectToStreamSignalingChannel(); // Conecta ao canal de streaming
    connectToExtensionListenerChannel(); // Conecta ao canal de extensão
    
  } catch (error) {
    console.error('[STREAMER] Erro ao inicializar Supabase:', error);
  }
}

// --- LÓGICA DE SINALIZAÇÃO (STREAMING) ---

function connectToStreamSignalingChannel() {
  if (!supabaseClient || !colaboradorId) return;

  const channelName = `stream-signal-${colaboradorId}`;
  console.log(`[STREAMER][STREAM] Subscrevendo ao canal: ${channelName}`);
  
  if (streamChannel) {
    supabaseClient.removeChannel(streamChannel);
  }

  streamChannel = supabaseClient.channel(channelName, {
    config: {
      broadcast: {
        ack: false // Não precisa de ack para broadcast
      }
    }
  });

  streamChannel
    .on('broadcast', { event: 'offer' }, (message) => {
      console.log('[STREAMER][STREAM][RT] Recebida "offer".');
      handleOfferFromSupabase(message.payload);
    })
    .on('broadcast', { event: 'ice-candidate' }, (message) => {
      console.log('[STREAMER][STREAM][RT] Recebido "ice-candidate".');
      handleIceCandidateFromSupabase(message.payload);
    })
    .on('broadcast', { event: 'stop-stream' }, (message) => {
      console.log('[STREAMER][STREAM][RT] Recebido "stop-stream".');
      handleStopStreamFromSupabase(message.payload);
    })
    .on('broadcast', { event: 'test-event' }, (message) => {
       console.warn('[STREAMER][STREAM][TEST] ---------> MENSAGEM DE TESTE RECEBIDA! <---------', message.payload);
    })
    .subscribe((status, err) => {
      console.log(`[STREAMER][STREAM][RT_SUB] Status: ${status}`);
      if (status === 'SUBSCRIBED') {
        console.log('[STREAMER][STREAM][RT_SUB] Conectado com sucesso! Aguardando ofertas.');
      } else if (err) {
        console.error('[STREAMER][STREAM][RT_SUB] Erro na subscrição:', err);
      }
    });
}

/**
 * Handler: Recebe a oferta (offer) do Admin via Supabase
 */
async function handleOfferFromSupabase(payload) {
  console.log('[STREAMER][STREAM] ----> handleOfferFromSupabase INICIADO <----');
  const { offer, adminId } = payload;
  
  if (!offer || !adminId) {
    console.error('[STREAMER][STREAM] Oferta ou adminId ausente no payload.');
    return;
  }
  
  // Se já existe uma conexão, limpa antes
  if (peerConnection) {
    console.warn('[STREAMER][STREAM] Conexão P2P já existe. Limpando antes de criar nova...');
    stopStreaming(true); // Para o stream, mas mantém o canal do supabase
  }

  console.log(`[STREAMER][STREAM] Oferta recebida do Supabase Admin: ${adminId}`);
  currentAdminId = adminId; // Armazena o admin que iniciou

  try {
    // 1. Pede a fonte de tela ao main.js
    console.log('[STREAMER][STREAM] Pedindo sourceId ao main.js...');
    const { sourceId, error } = await window.streamerApi.getScreenSource();
    if (error || !sourceId) {
      console.error('[STREAMER][STREAM] Falha ao obter sourceId:', error);
      return;
    }

    // 2. Obtém o stream de mídia (tela)
    const stream = await getScreenMedia(sourceId);
    localStream = stream; // Armazena globalmente
    console.log('[STREAMER][STREAM][ICE] Stream de mídia obtido com ' + stream.getTracks().length + ' track(s).');

    // 3. (MUDANÇA) Obtém a configuração de ICE (STUN + TURN)
    const dynamicRtcConfig = await getDynamicRtcConfig();
    if (!dynamicRtcConfig) {
       console.error('[STREAMER][STREAM] Não foi possível obter a configuração RTC. Abortando.');
       return;
    }

    // 4. Cria a Conexão P2P (AGORA É ASYNC)
    await createRTCPeerConnection(dynamicRtcConfig);

    // 5. Adiciona as tracks de mídia (tela)
    console.log('[STREAMER][STREAM][ICE] Adicionando tracks do localStream ao PeerConnection...');
    stream.getTracks().forEach(track => {
      try {
        peerConnection.addTrack(track, stream);
      } catch (e) {
        console.error('[STREAMER][STREAM] Erro ao adicionar track:', e);
      }
    });
    console.log('[STREAMER][STREAM][ICE] Tracks adicionadas.');

    // 6. Define a oferta (Offer) remota
    console.log('[STREAMER][STREAM][ICE] 1. Tentando definir Remote Description (Offer)...');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    console.log('[STREAMER][STREAM][ICE] 2. Remote Description definida com sucesso.');

    // 7. Cria a resposta (Answer)
    console.log('[STREAMER][STREAM] Criando resposta (answer)...');
    const answer = await peerConnection.createAnswer();
    
    console.log('[STREAMER][STREAM][ICE] 3. Tentando definir Local Description (Answer)...');
    await peerConnection.setLocalDescription(answer);
    console.log('[STREAMER][STREAM][ICE] 4. Local Description definida com sucesso.');
    
    // Log de estado do ICE (ESPERAMOS VER "gathering" AGORA)
    console.log('[STREAMER][STREAM][ICE] Estado da coleta ICE APÓS setLocalDescription:', peerConnection.iceGatheringState);

    // 8. Envia a resposta (Answer) para o canal do Admin
    console.log('[STREAMER][STREAM] Enviando resposta (answer) DIRETAMENTE para o canal do admin...');
    sendAnswerToSupabase(answer);

  } catch (error) {
    console.error('[STREAMER][STREAM] Erro fatal no handleOfferFromSupabase:', error);
    stopStreaming(); // Limpa tudo em caso de erro
  }
}

/**
 * Envia a resposta (answer) para o canal do Admin
 */
function sendAnswerToSupabase(answer) {
  if (!streamChannel || !currentAdminId) {
    console.error('[STREAMER][STREAM] Canal ou Admin ID não definidos. Não é possível enviar "answer".');
    return;
  }
  
  const adminChannelName = `stream-signal-${currentAdminId}`;
  console.log(`[STREAMER][STREAM] Tentando enviar 'answer' para ${adminChannelName}`);

  streamChannel.send({
    type: 'broadcast',
    event: 'answer',
    payload: {
      payload: answer,
      collabId: colaboradorId // Se identifica para o Admin
    }
  }, { 
    // Opção para enviar para um canal diferente (requer que a RLS do Supabase permita)
    // Na verdade, o JS SDK não suporta enviar para OUTRO canal.
    // O ADMIN deve estar ouvindo o canal DELE.
    // Vamos corrigir a lógica: O Admin envia para o canal do Colaborador,
    // o Colaborador envia para o canal do Admin.
    
    // CORREÇÃO: Usamos o cliente Supabase para pegar o canal do admin e enviar
  })
  .then(status => {
    // Esta API mudou. `send` agora envia para o *mesmo* canal.
    // Precisamos de uma instância do canal do admin para enviar.
    
    console.log('[STREAMER][STREAM] (Correção) Enviando "answer" via cliente Supabase...');
    supabaseClient.channel(adminChannelName).send({
      type: 'broadcast',
      event: 'answer',
      payload: {
        payload: answer,
        collabId: colaboradorId
      }
    })
    .then(status => {
      console.log('[STREAMER][STREAM] "Answer" enviada com status:', status);
    })
    .catch(err => {
      console.error('[STREAMER][STREAM] Erro ao enviar "answer" (método 2):', err);
    });
  })
  .catch(err => {
    console.error('[STREAMER][STREAM] Erro ao enviar "answer" (método 1):', err);
  });
}

/**
 * Handler: Recebe um candidato ICE (ice-candidate) do Admin via Supabase
 */
async function handleIceCandidateFromSupabase(payload) {
  if (!payload.payload) return;

  try {
    if (peerConnection && peerConnection.remoteDescription) {
      console.log('[STREAMER][STREAM][ICE] Adicionando ICE candidate (do Admin)...');
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.payload));
    } else {
      console.warn('[STREAMER][STREAM][ICE] PeerConnection não pronto, candidato ICE (do Admin) descartado.');
    }
  } catch (e) {
    console.error('[STREAMER][STREAM][ICE] Erro ao adicionar ICE candidate (do Admin):', e);
  }
}

/**
 * Handler: Recebe o comando de parada (stop-stream) do Admin
 */
function handleStopStreamFromSupabase(payload) {
  console.log('[STREAMER][STREAM] ----> handleStopStreamFromSupabase INICIADO <----');
  console.log(`[STREAMER][STREAM] Comando Stop recebido do Admin: ${payload.adminId}`);
  // CORREÇÃO: Passa 'true' para manter o canal do Supabase vivo
  stopStreaming(true); 
}

/**
 * Cria o objeto RTCPeerConnection e anexa os listeners
 * (AGORA É ASYNC, POIS ESPERA A CONFIG)
 */
async function createRTCPeerConnection(config) {
  if (!config) {
    console.error('[STREAMER][STREAM][ICE] Configuração RTC está nula. Abortando criação.');
    return;
  }
  console.log('[STREAMER][STREAM] Criando RTCPeerConnection...');
  
  try {
    // CORREÇÃO: Removido 'iceTransportPolicy: "relay"'
    console.log('[STREAMER][STREAM][ICE] Criando PeerConnection com config:', JSON.stringify(config));
    peerConnection = new RTCPeerConnection(config); // Usa a config dinâmica
    console.log('[STREAMER][STREAM][ICE] RTCPeerConnection criado com sucesso.');
  } catch (error) {
    console.error('[STREAMER][STREAM][ICE] Falha ao criar RTCPeerConnection:', error);
    console.error('[STREAMER][STREAM][ICE] Configuração usada:', JSON.stringify(config));
    return;
  }

  // Configura os listeners de evento
  console.log('[STREAMER][STREAM][ICE] Configurando listeners do PeerConnection (onicecandidate, onconnectionstatechange, onicegatheringstatechange, onicecandidateerror)...');
  
  // Evento 1: Novo candidato ICE local encontrado
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      // --- LOG ADICIONAL ICE 1 ---
      console.log('[STREAMER][STREAM][ICE] Evento: onicecandidate. Candidato LOCAL encontrado:', event.candidate.candidate.substring(0, 50) + '...');
      
      if (!streamChannel || !currentAdminId) {
        console.error('[STREAMER][STREAM][ICE] Canal ou Admin ID não definidos. Não é possível enviar "ice-candidate".');
        return;
      }
      
      const adminChannelName = `stream-signal-${currentAdminId}`;
      
      // Envia o candidato para o Admin
      supabaseClient.channel(adminChannelName).send({
        type: 'broadcast',
        event: 'ice-candidate',
        payload: {
          payload: event.candidate,
          collabId: colaboradorId
        }
      }).catch(err => {
         console.error('[STREAMER][STREAM][ICE] Erro ao enviar ICE candidate (local) para admin:', err);
      });
      
    } else {
      // --- LOG ADICIONAL ICE 2 ---
      console.log('[STREAMER][STREAM][ICE] Evento: onicecandidate. Coleta finalizada (candidato nulo).');
    }
  };

  // Evento 2: Mudança no estado da conexão
  peerConnection.onconnectionstatechange = () => {
    // --- LOG ADICIONAL ICE 3 ---
    const state = peerConnection?.connectionState || 'fechado';
    console.log(`[STREAMER][STREAM][ICE] Evento: onconnectionstatechange. Estado: ${state}`);
    
    switch (state) {
      case 'connected':
        console.log('[STREAMER][STREAM][ICE] Conexão P2P estabelecida com sucesso!');
        break;
      case 'failed':
        console.error('[STREAMER][STREAM][ICE] Conexão P2P falhou.');
        stopStreaming(true); // Tenta reconectar
        break;
      case 'disconnected':
      case 'closed':
        console.log('[STREAMER][STREAM][ICE] Conexão P2P desconectada/fechada.');
        stopStreaming(); // Limpa
        break;
    }
  };

  // Evento 3: Mudança no estado da *coleta* ICE
  peerConnection.onicegatheringstatechange = () => {
    // --- LOG ADICIONAL ICE 4 ---
    const state = peerConnection?.iceGatheringState || 'completo';
    console.log(`[STREAMER][STREAM][ICE] Evento: onicegatheringstatechange. Estado da COLETA: ${state}`);
    // Se você viu "gathering" aqui, é um ótimo sinal.
  };

  // Evento 4: Erro na coleta ICE
  peerConnection.onicecandidateerror = (event) => {
    // --- LOG ADICIONAL ICE 5 ---
    console.error('[STREAMER][STREAM][ICE] Evento: onicecandidateerror. Erro na coleta ICE:', event);
    // Isso pode indicar um bloqueio de firewall no STUN/TURN
  };
}

/**
 * Obtém a fonte de mídia (tela)
 */
async function getScreenMedia(sourceId) {
  console.log(`[STREAMER][STREAM] Iniciando captura de tela para sourceId: ${sourceId}`);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          // Você pode adicionar restrições de qualidade aqui se necessário
          // maxWidth: 1280,
          // maxHeight: 720,
          // maxFrameRate: 15 
        }
      }
    });
    console.log('[STREAMER][STREAM] Captura de tela iniciada com sucesso.');
    return stream;
  } catch (err) {
    console.error('[STREAMER][STREAM] Erro ao obter mídia (getUserMedia):', err);
    throw err; // Propaga o erro
  }
}


// --- LÓGICA DE EXTENSÃO DE HORÁRIO ---

function connectToExtensionListenerChannel() {
  if (!supabaseClient || !colaboradorId) return;

  const channelName = `time_extension_updates_${colaboradorId}`;
  console.log(`[STREAMER][EXT] Configurando listener de extensões no canal: ${channelName}`);
  
  if (extensionChannel) {
    supabaseClient.removeChannel(extensionChannel);
  }

  extensionChannel = supabaseClient.channel(channelName);
  
  extensionChannel
    .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'time_extension_requests',
        filter: `colaborador_id=eq.${colaboradorId}`
      },
      (payload) => {
        console.log('[STREAMER][EXT] Recebida atualização de extensão de horário:', payload.new);
        const request = payload.new;

        if (request.status === 'approved') {
          console.log('[STREAMER][EXT] Extensão APROVADA. Notificando main.js para desbloquear.');
          window.streamerApi.notifyMainOfUnlock(request.approved_until);
        } else if (request.status === 'rejected') {
          console.log('[STREAMER][EXT] Extensão REJEITADA. Notificando main.js.');
           window.streamerApi.notifyMainOfRejection();
        }
      }
    )
    .subscribe((status, err) => {
      console.log(`[STREAMER][EXT][RT_SUB] Status: ${status}`);
       if (status === 'SUBSCRIBED') {
        console.log('[STREAMER][EXT][RT_SUB] Conectado com sucesso (Extensões).');
      } else if (err) {
        console.error('[STREAMER][EXT][RT_SUB] Erro na subscrição (Extensões):', err);
      }
    });
}

function disconnectExtensionListenerChannel() {
  if (extensionChannel) {
    console.log('[STREAMER][EXT] Desconectando do canal de extensões.');
    supabaseClient.removeChannel(extensionChannel);
    extensionChannel = null;
  }
}


// --- FUNÇÕES DE LIMPEZA (STOP) ---

/**
 * Handler: O 'main.js' manda parar (ex: logout, app quit)
 */
window.streamerApi.onStopRequest(() => {
  console.log('[STREAMER][GENERAL] onStopRequest (do main) recebido.');
  stopStreaming(); // Para stream
  disconnectExtensionListenerChannel(); // Para extensões
  colaboradorId = null;
  supabaseClient = null;
});

/**
 * Para o processo de streaming e limpa
 * @param {boolean} keepChannel - Se true, não desconecta do Supabase (usado para reconexões)
 */
function stopStreaming(keepChannel = false) {
  console.log('[STREAMER][STREAM] Parando stream...');

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  if (peerConnection) {
    // --- LOG ADICIONAL ICE 9 ---
    console.log('[STREAMER][STREAM][ICE] Removendo listeners e fechando PeerConnection...');
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.onicegatheringstatechange = null;
    peerConnection.onicecandidateerror = null;
    peerConnection.ontrack = null; // Limpa o ontrack também
    peerConnection.close();
    peerConnection = null;
  }

  currentAdminId = null;

  if (!keepChannel && streamChannel) {
    console.log('[STREAMER][STREAM] Removendo canal de sinalização.');
    supabaseClient.removeChannel(streamChannel);
    streamChannel = null;
  }
  
  console.log('[STREAMER][STREAM] Stream parado e limpo.');
}
