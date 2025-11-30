"""
Combined WebSocket proxy for Cartesia STT and TTS.

Endpoints:
- ws://<your-backend>/ws/stt   -> STT proxy (browser audio -> Cartesia -> transcripts)
- ws://<your-backend>/ws/tts   -> TTS proxy (browser request -> Cartesia -> streamed audio)

Environment variables required:
- CARTESIA_API_KEY
- CARTESIA_VERSION (e.g. "2025-04-16")
- CARTESIA_STT_WS_URL (e.g. wss://api.cartesia.ai/realtime/stt)   # replace with actual
- CARTESIA_TTS_WS_URL (e.g. wss://api.cartesia.ai/realtime/tts)   # replace with actual

Run:
- pip install fastapi uvicorn websockets
- uvicorn server_ws:app --reload --port 8000
"""
import os
import json
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets  # pip install websockets

logger = logging.getLogger("server_ws")
logging.basicConfig(level=logging.INFO)

CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
if not CARTESIA_API_KEY:
    raise RuntimeError("Set CARTESIA_API_KEY environment variable")

CARTESIA_VERSION = os.getenv("CARTESIA_VERSION", "2025-04-16")
CARTESIA_STT_WS_URL = os.getenv("CARTESIA_STT_WS_URL", "wss://api.cartesia.ai/realtime/stt")
CARTESIA_TTS_WS_URL = os.getenv("CARTESIA_TTS_WS_URL", "wss://api.cartesia.ai/realtime/tts")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _proxy_websocket(client_ws: WebSocket, upstream_url: str, initial_message: dict | None = None):
    """
    Generic proxy: accepts a connected FastAPI WebSocket (client_ws),
    opens an upstream websockets.connect to upstream_url with headers, optionally sends an initial JSON message,
    then shuttles messages bidirectionally.
    - binary frames are forwarded as binary (bytes)
    - text frames are forwarded as text
    Adapt to Cartesia protocol (base64-in-JSON, envelope names) if needed.
    """
    await client_ws.accept()
    headers = [("Authorization", f"Bearer {CARTESIA_API_KEY}"), ("Cartesia-Version", CARTESIA_VERSION)]

    try:
        upstream = await websockets.connect(upstream_url, extra_headers=headers)
    except Exception as e:
        logger.exception("Failed to connect upstream %s", upstream_url)
        await client_ws.close(code=1011)
        return

    async def client_to_upstream():
        try:
            # Send initial message upstream if provided (as JSON text)
            if initial_message:
                try:
                    await upstream.send(json.dumps(initial_message))
                except Exception:
                    logger.exception("Failed to send initial message upstream")

            while True:
                data = await client_ws.receive()
                # FastAPI returns dict with 'type' and 'text' or 'bytes'
                t = data.get("type")
                if t == "websocket.receive":
                    if "bytes" in data and data["bytes"] is not None:
                        # forward binary as-is
                        await upstream.send(data["bytes"])
                    elif "text" in data and data["text"] is not None:
                        # forward text as-is
                        await upstream.send(data["text"])
                elif t == "websocket.disconnect":
                    break
        except WebSocketDisconnect:
            logger.info("Client disconnected")
        except Exception:
            logger.exception("client_to_upstream error")
        finally:
            try:
                await upstream.close()
            except Exception:
                pass

    async def upstream_to_client():
        try:
            async for msg in upstream:
                # websockets library yields str for text frames and bytes for binary
                if isinstance(msg, (bytes, bytearray)):
                    await client_ws.send_bytes(msg)
                else:
                    # string
                    await client_ws.send_text(msg)
        except Exception:
            logger.exception("upstream_to_client error")
        finally:
            try:
                await client_ws.close()
            except Exception:
                pass

    try:
        await asyncio.gather(client_to_upstream(), upstream_to_client())
    finally:
        try:
            await upstream.close()
        except Exception:
            pass


@app.websocket("/ws/stt")
async def websocket_stt_endpoint(ws: WebSocket):
    """
    STT proxy:
    - Browser should first send an initial JSON config message (model_id, language, sample_rate, etc.)
    - After that, browser sends binary audio frames (PCM Int16 LE or as required by upstream)
    - This proxy forwards client messages to Cartesia and forwards upstream transcripts/events back to client.

    NOTE: If Cartesia requires base64-in-JSON for audio frames, modify this proxy to convert bytes -> base64 and send JSON text.
    """
    # Receive initial JSON config from browser (handle gracefully)
    await ws.accept()
    try:
        init = await ws.receive_json()
    except Exception:
        # If no JSON received, treat as empty init
        init = {}
    finally:
        # Hand off to generic proxy; proxy will re-accept internally, so close the earlier accept
        pass

    await _proxy_websocket(ws, CARTESIA_STT_WS_URL, initial_message=init)


@app.websocket("/ws/tts")
async def websocket_tts_endpoint(ws: WebSocket):
    """
    TTS proxy:
    - Browser sends a single JSON TTS request (model_id, transcript/transcript:text, voice:{mode,id}, language, output_format, etc.)
    - This proxy sends that JSON upstream to Cartesia and proxies back audio chunks (binary or JSON with base64) to the client.
    """
    await ws.accept()
    try:
        init_req = await ws.receive_json()
    except Exception:
        await ws.close(code=4000)
        return

    await _proxy_websocket(ws, CARTESIA_TTS_WS_URL, initial_message=init_req)