/**
 * Modern Browser STT WebSocket client using AudioWorklet
 * 
 * Usage:
 *   const { ws, stop } = await startStt({
 *     wsUrl: location.origin.replace(/^http/, 'ws') + '/ws/stt',
 *     model: 'default-stt-model',
 *     language: 'en',
 *     sampleRate: 16000,
 *     onTranscript: (data) => console.log('Transcript:', data)
 *   });
 *
 * Features:
 * - Uses AudioWorklet for better performance (replaces deprecated ScriptProcessor)
 * - Proper error handling and cleanup
 * - Configurable callbacks for events
 * - Graceful fallback if AudioWorklet not supported
 */

// AudioWorklet processor code (will be created as a Blob URL)
const AUDIO_PROCESSOR_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];
    
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];
      
      if (this.bufferIndex >= this.bufferSize) {
        // Send buffer to main thread
        this.port.postMessage({
          type: 'audio',
          buffer: this.buffer.slice(0)
        });
        this.bufferIndex = 0;
      }
    }
    
    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;

/**
 * Start STT session with modern AudioWorklet
 */
export async function startStt({
  wsUrl,
  model = 'default-stt-model',
  language = 'en',
  sampleRate = 16000,
  onTranscript = null,
  onError = null,
  onClose = null
} = {}) {
  
  if (!wsUrl) {
    throw new Error('wsUrl is required');
  }

  // Check AudioWorklet support
  const supportsAudioWorklet = 'audioWorklet' in AudioContext.prototype;
  
  if (!supportsAudioWorklet) {
    console.warn('AudioWorklet not supported, using fallback');
    return startSttFallback({ wsUrl, model, language, sampleRate, onTranscript, onError, onClose });
  }

  // Create WebSocket
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  
  let audioCtx = null;
  let stream = null;
  let workletNode = null;
  let source = null;

  // WebSocket event handlers
  ws.onopen = () => {
    console.log('STT WebSocket connected');
    // Send initial configuration
    ws.send(JSON.stringify({
      action: 'start',
      model_id: model,
      language,
      sample_rate: sampleRate
    }));
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const obj = JSON.parse(ev.data);
        console.log('STT event:', obj);
        if (onTranscript) onTranscript(obj);
      } catch (e) {
        console.log('STT text message:', ev.data);
      }
    } else if (ev.data instanceof ArrayBuffer) {
      console.log('STT binary message length:', ev.data.byteLength);
    }
  };

  ws.onerror = (err) => {
    console.error('STT WebSocket error:', err);
    if (onError) onError(err);
  };

  ws.onclose = (e) => {
    console.log('STT WebSocket closed:', e.code, e.reason);
    if (onClose) onClose(e);
  };

  // Get microphone access
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: sampleRate
      }
    });
  } catch (err) {
    ws.close();
    throw new Error(`Failed to access microphone: ${err.message}`);
  }

  // Create AudioContext
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: sampleRate
  });

  // Create audio worklet processor
  try {
    // Create processor code as blob URL
    const blob = new Blob([AUDIO_PROCESSOR_CODE], { type: 'application/javascript' });
    const processorUrl = URL.createObjectURL(blob);
    
    await audioCtx.audioWorklet.addModule(processorUrl);
    URL.revokeObjectURL(processorUrl);
    
    workletNode = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
    
    // Handle audio data from worklet
    workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        const float32Buffer = event.data.buffer;
        const pcm16 = floatTo16BitPCM(float32Buffer);
        
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(pcm16.buffer);
        }
      }
    };
    
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(workletNode);
    workletNode.connect(audioCtx.destination);
    
  } catch (err) {
    // Cleanup on error
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (audioCtx) audioCtx.close();
    ws.close();
    throw new Error(`Failed to setup audio processing: ${err.message}`);
  }

  // Return controller object
  return {
    ws,
    stop: async () => {
      console.log('Stopping STT session');
      
      // Disconnect audio nodes
      if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
      }
      if (source) {
        source.disconnect();
        source = null;
      }
      
      // Stop microphone
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }
      
      // Close audio context
      if (audioCtx && audioCtx.state !== 'closed') {
        await audioCtx.close();
        audioCtx = null;
      }
      
      // Close WebSocket
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
  };
}

/**
 * Fallback implementation using ScriptProcessor (for older browsers)
 */
async function startSttFallback({
  wsUrl,
  model,
  language,
  sampleRate,
  onTranscript,
  onError,
  onClose
}) {
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  
  let audioCtx = null;
  let stream = null;
  let processor = null;
  let source = null;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      action: 'start',
      model_id: model,
      language,
      sample_rate: sampleRate
    }));
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const obj = JSON.parse(ev.data);
        if (onTranscript) onTranscript(obj);
      } catch (e) {
        console.log('STT message:', ev.data);
      }
    }
  };

  ws.onerror = (err) => {
    console.error('WS error', err);
    if (onError) onError(err);
  };

  ws.onclose = (e) => {
    console.log('STT WS closed', e);
    if (onClose) onClose(e);
  };

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: sampleRate
      }
    });
  } catch (err) {
    ws.close();
    throw new Error(`Failed to access microphone: ${err.message}`);
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  source = audioCtx.createMediaStreamSource(stream);

  const bufferSize = 4096;
  processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  source.connect(processor);
  // Don't connect to destination to avoid feedback
  processor.connect(audioCtx.destination);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioCtx.sampleRate, sampleRate);
    const pcm16 = floatTo16BitPCM(downsampled);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(pcm16.buffer);
    }
  };

  return {
    ws,
    stop: () => {
      if (processor) processor.disconnect();
      if (source) source.disconnect();
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (audioCtx) audioCtx.close();
      ws.close();
    }
  };
}

// Helper functions
function downsampleBuffer(buffer, srcRate, dstRate) {
  if (dstRate === srcRate) return buffer;
  if (dstRate > srcRate) {
    throw new Error('Destination sample rate must be <= source sample rate');
  }
  
  const ratio = srcRate / dstRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  
  return result;
}

function floatTo16BitPCM(float32Array) {
  const len = float32Array.length;
  const buffer = new ArrayBuffer(len * 2);
  const view = new DataView(buffer);
  let offset = 0;
  
  for (let i = 0; i < len; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  
  return new Uint8Array(buffer);
}
