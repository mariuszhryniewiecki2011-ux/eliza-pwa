/**
 * Modern Browser TTS WebSocket client with progressive playback
 * 
 * Usage:
 *   const controller = await startTtsWebsocket({
 *     wsUrl: location.origin.replace(/^http/, 'ws') + '/ws/tts',
 *     request: {
 *       model_id: 'sonic-2',
 *       transcript: 'Hello, world!',
 *       voice: { mode: 'id', id: '<voice-id>' },
 *       language: 'en',
 *       output_format: {
 *         container: 'wav',
 *         sample_rate: 44100,
 *         encoding: 'pcm_f32le'
 *       }
 *     },
 *     onStart: () => console.log('Started'),
 *     onEnd: () => console.log('Finished'),
 *     onError: (err) => console.error(err)
 *   });
 *
 * Features:
 * - Progressive audio playback with smooth queueing
 * - Proper memory management and cleanup
 * - Event callbacks for lifecycle
 * - Handles both binary and JSON message formats
 */

export async function startTtsWebsocket({
  wsUrl,
  request,
  bufferMs = 50,
  onStart = null,
  onEnd = null,
  onError = null,
  onChunk = null
}) {
  
  if (!wsUrl) {
    throw new Error('wsUrl is required');
  }
  
  if (!request || !request.transcript) {
    throw new Error('request.transcript is required');
  }

  // Create WebSocket
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  // Audio playback setup
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let queuedTime = audioCtx.currentTime;
  const audioSources = []; // Track active sources for cleanup
  let isPlaying = false;
  let hasStarted = false;

  /**
   * Schedule an AudioBuffer for playback
   */
  function scheduleAudioBuffer(audioBuffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(audioCtx.destination);
    
    // Calculate start time with buffer
    const startAt = Math.max(queuedTime, audioCtx.currentTime + (bufferMs / 1000));
    src.start(startAt);
    
    // Track for cleanup
    audioSources.push(src);
    
    // Remove from tracking when done
    src.onended = () => {
      const idx = audioSources.indexOf(src);
      if (idx > -1) {
        audioSources.splice(idx, 1);
      }
      
      // Check if all playback finished
      if (audioSources.length === 0 && !isPlaying) {
        if (onEnd) onEnd();
      }
    };
    
    queuedTime = startAt + audioBuffer.duration;
    
    if (!hasStarted) {
      hasStarted = true;
      if (onStart) onStart();
    }
  }

  /**
   * Decode audio data and schedule playback
   */
  async function decodeAndPlay(arrayBuffer) {
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      scheduleAudioBuffer(audioBuffer);
      if (onChunk) onChunk(audioBuffer);
    } catch (err) {
      console.error('Failed to decode audio data:', err);
      if (onError) {
        onError(new Error(`Audio decode failed: ${err.message}`));
      }
    }
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  function base64ToArrayBuffer(base64) {
    try {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (err) {
      throw new Error(`Failed to decode base64: ${err.message}`);
    }
  }

  // WebSocket event handlers
  ws.onopen = () => {
    console.log('TTS WebSocket connected');
    isPlaying = true;
    
    try {
      ws.send(JSON.stringify(request));
      console.log('Sent TTS request');
    } catch (err) {
      console.error('Failed to send TTS request:', err);
      if (onError) onError(err);
      ws.close();
    }
  };

  ws.onmessage = async (ev) => {
    if (typeof ev.data === 'string') {
      // Handle JSON messages
      try {
        const obj = JSON.parse(ev.data);
        
        // Handle different message types
        if (obj.type === 'audio' && obj.payload) {
          // Base64-encoded audio in JSON
          const ab = base64ToArrayBuffer(obj.payload);
          await decodeAndPlay(ab);
        } else if (obj.type === 'end' || obj.event === 'end' || obj.done) {
          // End of stream
          console.log('TTS stream ended');
          isPlaying = false;
          if (audioSources.length === 0 && onEnd) {
            onEnd();
          }
        } else if (obj.type === 'error' || obj.error) {
          // Error message
          const errorMsg = obj.message || obj.error || 'Unknown error';
          console.error('TTS error:', errorMsg);
          if (onError) onError(new Error(errorMsg));
        } else {
          // Other events
          console.log('TTS event:', obj);
        }
      } catch (e) {
        console.warn('Failed to parse TTS message:', e);
      }
    } else if (ev.data instanceof ArrayBuffer) {
      // Handle binary audio frames
      await decodeAndPlay(ev.data);
    }
  };

  ws.onerror = (e) => {
    console.error('TTS WebSocket error:', e);
    isPlaying = false;
    if (onError) onError(new Error('WebSocket error'));
  };

  ws.onclose = (e) => {
    console.log('TTS WebSocket closed:', e.code, e.reason);
    isPlaying = false;
    
    // If closed unexpectedly
    if (e.code !== 1000 && e.code !== 1001) {
      console.warn('TTS WebSocket closed unexpectedly:', e.code, e.reason);
      if (onError) {
        onError(new Error(`WebSocket closed: ${e.reason || e.code}`));
      }
    }
  };

  // Return controller object
  return {
    ws,
    audioContext: audioCtx,
    
    /**
     * Stop playback and cleanup resources
     */
    stop: async () => {
      console.log('Stopping TTS playback');
      
      // Stop all active audio sources
      audioSources.forEach(src => {
        try {
          src.stop();
        } catch (e) {
          // Source may have already stopped
        }
      });
      audioSources.length = 0;
      
      // Close WebSocket
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Client requested stop');
      }
      
      // Close audio context
      if (audioCtx.state !== 'closed') {
        await audioCtx.close();
      }
    },
    
    /**
     * Pause playback (suspend audio context)
     */
    pause: async () => {
      if (audioCtx.state === 'running') {
        await audioCtx.suspend();
      }
    },
    
    /**
     * Resume playback
     */
    resume: async () => {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
    },
    
    /**
     * Get current playback state
     */
    getState: () => ({
      isPlaying,
      hasStarted,
      queuedSources: audioSources.length,
      audioContextState: audioCtx.state,
      websocketState: ws.readyState
    })
  };
}

/**
 * Simple helper for one-shot TTS playback
 * Returns a promise that resolves when playback is complete
 */
export async function synthesizeAndPlay(wsUrl, text, voiceId, language = 'en') {
  return new Promise((resolve, reject) => {
    let controller = null;
    
    startTtsWebsocket({
      wsUrl,
      request: {
        model_id: 'sonic-2',
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        language,
        output_format: {
          container: 'wav',
          sample_rate: 44100,
          encoding: 'pcm_f32le'
        }
      },
      onEnd: () => {
        resolve();
      },
      onError: (err) => {
        reject(err);
      }
    }).then(ctrl => {
      controller = ctrl;
    }).catch(reject);
  });
}
