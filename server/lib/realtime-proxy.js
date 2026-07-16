/**
 * Bridges the browser microphone WebSocket to OpenAI Realtime or Gemini Live.
 */

'use strict';

const WebSocket = require('ws');
const OpenCC = require('opencc-js');
const {
  buildOpenAIConnectSession,
  buildOpenAIInstructionsUpdate,
  buildGeminiSetup,
} = require('./realtime-session');

const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const toTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'twp' });

function downsample24to16(pcm24k) {
  const samples24k = new Int16Array(
    pcm24k.buffer,
    pcm24k.byteOffset,
    Math.floor(pcm24k.byteLength / 2),
  );
  const samples16k = new Int16Array(Math.floor(samples24k.length * 2 / 3));

  for (let index = 0; index < samples16k.length; index += 1) {
    const sourceIndex = index * 1.5;
    const low = Math.floor(sourceIndex);
    const high = Math.min(low + 1, samples24k.length - 1);
    const fraction = sourceIndex - low;
    samples16k[index] = Math.round(samples24k[low] * (1 - fraction) + samples24k[high] * fraction);
  }

  return Buffer.from(samples16k.buffer);
}

function sendToClient(clientWs, event) {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify(event));
  }
}

function transcriptEvent(type, text) {
  return { type, delta: toTaiwanTraditional(text || '') };
}

function handleRealtimeClient(clientWs, broadcast, apiKeys) {
  let providerWs   = null;
  let activeProvider = 'openai';
  let sessionConfig  = {};
  let geminiReady    = false; // true after setupComplete received
  let inputChunkCount = 0;
  let outputChunkCount = 0;
  let openaiResponding = false; // true between response.created and response.done/cancelled

  function handleOpenAIEvent(message) {
    // Log every type for debugging (remove after confirmed working)
    console.log('[realtime-proxy] OpenAI event:', message.type);

    if (message.type === 'session.updated') {
      // Do not stream microphone audio until OpenAI has accepted session config.
      sendToClient(clientWs, { type: 'proxy.ready', provider: 'openai' });
    } else if (message.type === 'conversation.item.input_audio_transcription.delta') {
      broadcast.toAll(transcriptEvent('transcript.user.delta', message.delta));
    } else if (message.type === 'conversation.item.input_audio_transcription.completed') {
      broadcast.toAll({ type: 'transcript.user.done', transcript: toTaiwanTraditional(message.transcript || '') });
    } else if (message.type === 'response.audio_transcript.delta' || message.type === 'response.output_audio_transcript.delta') {
      broadcast.toAll(transcriptEvent('transcript.ai.delta', message.delta));
    } else if (message.type === 'response.audio_transcript.done' || message.type === 'response.output_audio_transcript.done') {
      broadcast.toAll({ type: 'transcript.ai.done', transcript: toTaiwanTraditional(message.transcript || '') });
    } else if (message.type === 'response.created') {
      openaiResponding = true;
      broadcast.toAll({ type: 'ai.thinking' });
    } else if (message.type === 'response.done') {
      openaiResponding = false;
      broadcast.toAll({ type: 'ai.done' });
    } else if (message.type === 'response.cancelled') {
      // Authoritative confirmation that OpenAI cancelled the in-flight response
      // (emitted after input_audio_buffer.speech_started when interrupt_response
      // is enabled). The speech_started handler below already reacts sooner;
      // this is a defensive re-broadcast in case that race didn't catch it.
      openaiResponding = false;
      broadcast.toAll({ type: 'response.cancelled' });
    } else if (message.type === 'input_audio_buffer.speech_started') {
      // Per OpenAI's documented interrupt flow: the server auto-cancels any
      // in-progress response as soon as it sees this event. React immediately
      // so the projection/monitor "打斷" cue and local audio flush happen with
      // the lowest possible latency, rather than waiting for response.cancelled.
      if (openaiResponding) {
        openaiResponding = false;
        broadcast.toAll({ type: 'response.cancelled' });
      }
      broadcast.toAll({ type: 'vad.speech_started' });
    } else if (message.type === 'input_audio_buffer.speech_stopped') {
      broadcast.toAll({ type: 'vad.speech_stopped' });
    } else if (message.type === 'error') {
      console.error('[realtime-proxy] OpenAI error detail:', JSON.stringify(message.error));
      broadcast.toAll({ type: 'ai.error', message: message.error?.message || 'unknown error' });
    }
  }

  function handleGeminiEvent(message) {
    const content = message.serverContent;
    if (!content) {
      if (message.error) {
        broadcast.toAll({ type: 'ai.error', message: message.error.message || 'unknown error' });
      }
      return;
    }

    if (content.inputTranscription?.text) {
      broadcast.toAll(transcriptEvent('transcript.user.delta', content.inputTranscription.text));
    }
    if (content.outputTranscription?.text) {
      broadcast.toAll(transcriptEvent('transcript.ai.delta', content.outputTranscription.text));
    }
    if (content.activityStart) {
      sendToClient(clientWs, { type: 'input_audio_buffer.speech_started' });
      broadcast.toAll({ type: 'vad.speech_started' });
    }
    if (content.activityEnd || content.audioStreamEnded) {
      sendToClient(clientWs, { type: 'input_audio_buffer.speech_stopped' });
      broadcast.toAll({ type: 'vad.speech_stopped' });
      broadcast.toAll({ type: 'transcript.user.done' });
    }
    if (content.interrupted) {
      // Authoritative Gemini signal: "If the client is playing out the content
      // in realtime, this is a good signal to stop and empty the current
      // playback queue." — mirrors OpenAI's response.cancelled handling above.
      broadcast.toAll({ type: 'response.cancelled' });
    }
    if (content.turnComplete) {
      broadcast.toAll({ type: 'transcript.ai.done' });
      broadcast.toAll({ type: 'ai.done' });
    }
  }

  function attachProviderHandlers(ws, provider) {
    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Gemini: setupComplete unlocks audio forwarding and signals session ready
      if (provider === 'gemini' && message.setupComplete) {
        geminiReady = true;
        console.log('[realtime-proxy] Gemini setupComplete — session ready');
        sendToClient(clientWs, { type: 'session.created', provider: 'gemini' });
        sendToClient(clientWs, { type: 'proxy.ready', provider: 'gemini' });
        return; // don't forward setupComplete itself to the browser
      }

      const hasOpenAIAudio = message.type === 'response.audio.delta' || message.type === 'response.output_audio.delta';
      const hasGeminiAudio = message.serverContent?.modelTurn?.parts?.some((part) => part.inlineData?.data);
      if (hasOpenAIAudio || hasGeminiAudio) {
        outputChunkCount += 1;
        if (outputChunkCount === 1) {
          console.log(`[realtime-proxy] First ${provider} audio response chunk received`);
          sendToClient(clientWs, { type: 'proxy.output_active', provider });
        }
      }

      sendToClient(clientWs, message);
      if (provider === 'openai') handleOpenAIEvent(message);
      else handleGeminiEvent(message);
    });

    ws.on('close', (code, reason) => {
      if (providerWs !== ws) return;
      console.log(`[realtime-proxy] ${provider} WebSocket closed: ${code} ${reason.toString()}`);
      sendToClient(clientWs, { type: 'proxy.disconnected', provider, code });
    });

    ws.on('error', (error) => {
      if (providerWs !== ws) return;
      console.error(`[realtime-proxy] ${provider} WebSocket error:`, error.message);
      sendToClient(clientWs, { type: 'proxy.error', message: error.message });
    });
  }

  function connectToOpenAI() {
    const model = apiKeys.openaiRealtime || 'gpt-realtime-2.1';
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKeys.openai}` },
    });
    providerWs = ws;
    attachProviderHandlers(ws, 'openai');

    ws.on('open', () => {
      openaiResponding = false;
      ws.send(JSON.stringify(buildOpenAIConnectSession({
        instructions: sessionConfig.instructions,
        voice: sessionConfig.voice,
      })));
      sendToClient(clientWs, { type: 'proxy.connected', provider: 'openai' });
    });
  }

  function connectToGemini() {
    geminiReady = false;
    const ws = new WebSocket(`${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKeys.gemini)}`);
    providerWs = ws;
    attachProviderHandlers(ws, 'gemini');

    ws.on('open', () => {
      ws.send(JSON.stringify(buildGeminiSetup({
        instructions: sessionConfig.instructions,
        voiceName: sessionConfig.voice,
        modelName: apiKeys.geminiLive,
      })));
      // session.created is sent later, when setupComplete arrives
      sendToClient(clientWs, { type: 'proxy.connected', provider: 'gemini' });
    });
  }

  function connectProvider() {
    if (activeProvider === 'gemini') connectToGemini();
    else connectToOpenAI();
  }

  clientWs.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'session.start') {
      sessionConfig  = message.config || {};
      activeProvider = sessionConfig.provider || 'openai';
      geminiReady    = false;
      inputChunkCount = 0;
      outputChunkCount = 0;
      const key = activeProvider === 'gemini' ? apiKeys.gemini : apiKeys.openai;
      if (!key) {
        sendToClient(clientWs, {
          type: 'proxy.error',
          message: `Provider ${activeProvider} has no API key configured`,
        });
        return;
      }
      if (providerWs) providerWs.close();
      connectProvider();
      return;
    }

    if (!providerWs || providerWs.readyState !== WebSocket.OPEN) return;

    if (message.type === 'session.update') {
      // OpenAI: instructions-only live update (voice is never sent here — the
      // client always reconnects for a voice change instead, since OpenAI
      // rejects any update containing voice once assistant audio is present).
      //
      // Gemini: the ENTIRE setup message (voice, model, AND instructions) is
      // one-time and can never be patched on the public Live API — confirmed
      // by live testing: sending a clientContent role:"system" update closes
      // the connection with code 1007 "Request contains an invalid argument"
      // (see the correction note in realtime-session.js). The client should
      // never send session.update for an active Gemini session at all (it
      // reconnects instead — see needsReconnect() in realtime-session.js).
      // If one arrives anyway, fail safely instead of corrupting the socket.
      sessionConfig = { ...sessionConfig, ...message.session };
      if (activeProvider === 'openai') {
        providerWs.send(JSON.stringify(buildOpenAIInstructionsUpdate({
          instructions: sessionConfig.instructions,
        })));
      } else {
        sendToClient(clientWs, {
          type: 'proxy.error',
          message: 'Gemini Live has no live-update mechanism; reconnect to apply changes.',
        });
      }
    } else if (message.type === 'input_audio_buffer.append') {
      inputChunkCount += 1;
      if (inputChunkCount === 1) {
        console.log(`[realtime-proxy] First ${activeProvider} microphone chunk received`);
        sendToClient(clientWs, { type: 'proxy.input_active', provider: activeProvider });
      }
      if (activeProvider === 'openai') {
        providerWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: message.audio }));
      } else {
        if (!geminiReady) return; // drop until setupComplete
        const pcm24k = Buffer.from(message.audio, 'base64');
        const pcm16k = downsample24to16(pcm24k);
        providerWs.send(JSON.stringify({
          realtimeInput: {
            audio: { data: pcm16k.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
          },
        }));
      }
    } else if (message.type === 'input_audio_buffer.commit') {
      if (activeProvider === 'openai') {
        providerWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        providerWs.send(JSON.stringify({ type: 'response.create' }));
      } else {
        providerWs.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
    } else if (message.type === 'response.cancel') {
      // Manual 打斷 button. Send the provider-specific cancel, and broadcast
      // immediately rather than waiting for the provider's confirmation —
      // matches the same immediate-reaction pattern used for barge-in above.
      if (activeProvider === 'openai') {
        openaiResponding = false;
        providerWs.send(JSON.stringify({ type: 'response.cancel' }));
      } else {
        providerWs.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      }
      broadcast.toAll({ type: 'response.cancelled' });
    } else if (message.type === 'session.close') {
      providerWs.close();
    }
  });

  clientWs.on('close', () => {
    if (providerWs) providerWs.close();
  });

  clientWs.on('error', (error) => {
    console.error('[realtime-proxy] Browser WebSocket error:', error.message);
  });
}

module.exports = { handleRealtimeClient };
