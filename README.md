# Cartesia Audio Integration - Fixed Version

A complete, production-ready integration for Cartesia's Speech-to-Text (STT) and Text-to-Speech (TTS) services with both REST and WebSocket support.

## 🎯 What's Been Fixed

### Security
- ✅ Configurable CORS (no more wildcard `*` in production)
- ✅ Input validation using Pydantic models
- ✅ Comprehensive error handling and logging
- ✅ Request timeouts to prevent hanging connections

### Code Quality
- ✅ Replaced deprecated `ScriptProcessor` with modern `AudioWorklet`
- ✅ Consolidated duplicate WebSocket server code
- ✅ Proper cleanup and memory management
- ✅ Added TypeScript-style JSDoc comments
- ✅ Consistent error handling patterns

### Functionality
- ✅ Complete HTML structure with proper UI
- ✅ Better audio scheduling and playback
- ✅ Event callbacks for lifecycle management
- ✅ Graceful fallbacks for older browsers
- ✅ Health check endpoints

## 📁 Project Structure

```
.
├── index-fixed.html          # Complete frontend with UI
├── cartesia-init-fixed.js    # Improved SDK initialization
├── server-fixed.py           # REST API with validation
├── server_ws-fixed.py        # Consolidated WebSocket proxy
├── stt-client-fixed.js       # Modern STT client with AudioWorklet
├── tts-client-fixed.js       # Improved TTS client
├── .env.example              # Environment variables template
└── README.md                 # This file
```

## 🚀 Quick Start

### 1. Install Dependencies

#### Python Backend
```bash
pip install fastapi uvicorn httpx pydantic websockets
```

#### Frontend
No build step required! Just serve the HTML files.

### 2. Configure Environment

Create a `.env` file:

```bash
# Required
CARTESIA_API_KEY=your_api_key_here

# Optional (with defaults)
CARTESIA_VERSION=2025-04-16
CARTESIA_BASE_URL=https://api.cartesia.ai
CARTESIA_STT_WS_URL=wss://api.cartesia.ai/realtime/stt
CARTESIA_TTS_WS_URL=wss://api.cartesia.ai/realtime/tts

# Security - IMPORTANT for production
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Server
PORT=8000
```

### 3. Run the Server

#### REST API Server (TTS only)
```bash
python server-fixed.py
```

#### WebSocket Server (STT + TTS)
```bash
python server_ws-fixed.py
```

Or use uvicorn directly:
```bash
uvicorn server_ws-fixed:app --reload --port 8000
```

### 4. Open the Frontend

```bash
# Simple Python HTTP server
python -m http.server 3000
```

Then open: http://localhost:3000/index-fixed.html

## 📖 API Documentation

### REST API

#### Health Check
```
GET /health
```

#### Text-to-Speech
```
POST /api/tts
Content-Type: application/json

{
  "model_id": "sonic-2",
  "transcript": "Hello, world!",
  "voice": {
    "mode": "id",
    "id": "voice-id-here"
  },
  "language": "en",
  "output_format": {
    "container": "wav",
    "sample_rate": 44100,
    "encoding": "pcm_f32le"
  }
}
```

Returns: Binary audio stream

### WebSocket API

#### Speech-to-Text
```
WS /ws/stt

# Initial message (JSON)
{
  "action": "start",
  "model_id": "default-stt-model",
  "language": "en",
  "sample_rate": 16000
}

# Then send binary audio frames (PCM Int16 LE)
# Receive transcript events (JSON)
```

#### Text-to-Speech Streaming
```
WS /ws/tts

# Send TTS request (JSON)
{
  "model_id": "sonic-2",
  "transcript": "Hello, world!",
  "voice": {
    "mode": "id",
    "id": "voice-id-here"
  },
  "language": "en",
  "output_format": {
    "container": "wav",
    "sample_rate": 44100,
    "encoding": "pcm_f32le"
  }
}

# Receive binary audio chunks
# Receive end event (JSON): { "type": "end" }
```

## 💻 Client Library Usage

### STT Client

```javascript
import { startStt } from './stt-client-fixed.js';

const { ws, stop } = await startStt({
  wsUrl: 'ws://localhost:8000/ws/stt',
  model: 'default-stt-model',
  language: 'en',
  sampleRate: 16000,
  onTranscript: (data) => {
    console.log('Transcript:', data);
  },
  onError: (err) => {
    console.error('Error:', err);
  }
});

// Stop when done
await stop();
```

### TTS Client

```javascript
import { startTtsWebsocket } from './tts-client-fixed.js';

const controller = await startTtsWebsocket({
  wsUrl: 'ws://localhost:8000/ws/tts',
  request: {
    model_id: 'sonic-2',
    transcript: 'Hello, world!',
    voice: { mode: 'id', id: 'voice-id-here' },
    language: 'en'
  },
  onStart: () => console.log('Playback started'),
  onEnd: () => console.log('Playback finished'),
  onError: (err) => console.error('Error:', err)
});

// Control playback
await controller.pause();
await controller.resume();
await controller.stop();
```

## 🔒 Security Best Practices

### Production Checklist

- [ ] Set `ALLOWED_ORIGINS` to specific domains (never use `*`)
- [ ] Use HTTPS/WSS in production
- [ ] Implement authentication/authorization
- [ ] Add rate limiting
- [ ] Set up monitoring and logging
- [ ] Use environment-specific configurations
- [ ] Enable CORS only for trusted origins
- [ ] Validate all user inputs
- [ ] Set appropriate timeout values

### Example Production Configuration

```python
# server-fixed.py
ALLOWED_ORIGINS = [
    "https://yourdomain.com",
    "https://www.yourdomain.com"
]

# Add rate limiting
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/tts")
@limiter.limit("10/minute")
async def tts(request: Request):
    # ... implementation
```

## 🐛 Troubleshooting

### Common Issues

#### 1. CORS Errors
```
Access to fetch at 'http://localhost:8000/api/tts' from origin 'http://localhost:3000' 
has been blocked by CORS policy
```

**Solution:** Add your frontend origin to `ALLOWED_ORIGINS`
```bash
ALLOWED_ORIGINS=http://localhost:3000
```

#### 2. Microphone Access Denied
```
Failed to access microphone: NotAllowedError
```

**Solution:** 
- Ensure you're using HTTPS (required for getUserMedia in production)
- Check browser permissions
- User must interact with page before requesting microphone

#### 3. AudioWorklet Not Supported
The client will automatically fall back to ScriptProcessor, but you'll see a warning:
```
AudioWorklet not supported, using fallback
```

**Solution:** Use a modern browser (Chrome 66+, Firefox 76+, Safari 14.1+)

#### 4. WebSocket Connection Failed
```
WebSocket connection to 'ws://localhost:8000/ws/stt' failed
```

**Solution:**
- Check server is running
- Verify WebSocket URL is correct
- Check firewall/proxy settings
- Ensure `CARTESIA_API_KEY` is set

## 📊 Monitoring

### Health Checks

Both servers expose health check endpoints:

```bash
# REST API
curl http://localhost:8000/health

# WebSocket server
curl http://localhost:8000/health
```

### Logging

All servers log to stdout with timestamps:

```
2025-12-02 10:30:45 - server_ws - INFO - STT WebSocket connection attempt
2025-12-02 10:30:45 - server_ws - INFO - Connected to upstream successfully
2025-12-02 10:30:46 - server_ws - INFO - Client disconnected
```

### Recommended Monitoring Tools

- **Application Performance:** New Relic, DataDog, or Sentry
- **Log Aggregation:** ELK Stack, Splunk, or CloudWatch
- **Uptime Monitoring:** UptimeRobot, Pingdom
- **Real User Monitoring:** Google Analytics, Mixpanel

## 🧪 Testing

### Manual Testing

1. Start the server
2. Open browser console
3. Run test commands:

```javascript
// Test TTS
fetch('http://localhost:8000/api/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    transcript: 'Hello, this is a test',
    voice: { mode: 'id', id: 'test-voice' },
    language: 'en'
  })
}).then(r => r.blob()).then(blob => {
  const audio = new Audio(URL.createObjectURL(blob));
  audio.play();
});
```

### Automated Testing

TODO: Add unit tests and integration tests

## 📝 Migration Guide

### From Original Code

1. **Frontend:**
   - Replace `index.html` → `index-fixed.html`
   - Replace `cartesia-init.js` → `cartesia-init-fixed.js`
   - Update script references

2. **Backend:**
   - Replace `server.py` → `server-fixed.py`
   - Replace `server_ws.py` → `server_ws-fixed.py`
   - Add environment variables
   - Update CORS configuration

3. **Client Libraries:**
   - Replace `stt-client.js` → `stt-client-fixed.js`
   - Replace `tts-client.js` → `tts-client-fixed.js`
   - Update callback patterns

## 🤝 Contributing

Improvements welcome! Key areas:

- Add unit tests
- Implement authentication
- Add rate limiting
- Improve error messages
- Add more examples
- Performance optimizations

## 📄 License

[Your License Here]

## 🔗 Resources

- [Cartesia API Documentation](https://docs.cartesia.ai)
- [FastAPI Documentation](https://fastapi.tiangolo.com)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
