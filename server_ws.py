"""
Combined WebSocket proxy for Cartesia STT and TTS.

Endpoints:
- ws://<your-backend>/ws/stt   -> STT proxy (browser audio -> Cartesia -> transcripts)
- ws://<your-backend>/ws/tts   -> TTS proxy (browser request -> Cartesia -> streamed audio)

Environment variables required:
- CARTESIA_API_KEY
- CARTESIA_VERSION (e.g. "2025-04-16")
- CARTESIA_STT_WS_URL (e.g. wss://api.cartesia.ai/realtime/stt)
- CARTESIA_TTS_WS_URL (e.g. wss://api.cartesia.ai/realtime/tts)
- ALLOWED_ORIGINS (comma-separated list of allowed origins)

Run:
- pip install fastapi uvicorn websockets pydantic
- uvicorn server_ws_fixed:app --reload --port 8000
"""
import os
import json
import asyncio
import logging
from typing import Optional, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import websockets

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("server_ws")

# Load environment variables
CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
if not CARTESIA_API_KEY:
    raise RuntimeError("Set CARTESIA_API_KEY environment variable")

CARTESIA_VERSION = os.getenv("CARTESIA_VERSION", "2025-04-16")
CARTESIA_STT_WS_URL = os.getenv("CARTESIA_STT_WS_URL", "wss://api.cartesia.ai/realtime/stt")
CARTESIA_TTS_WS_URL = os.getenv("CARTESIA_TTS_WS_URL", "wss://api.cartesia.ai/realtime/tts")

# Configure allowed origins
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")
if not ALLOWED_ORIGINS or ALLOWED_ORIGINS == [""]:
    logger.warning("ALLOWED_ORIGINS not set. Using wildcard (*) - NOT RECOMMENDED FOR PRODUCTION")
    ALLOWED_ORIGINS = ["*"]
else:
    logger.info(f"CORS enabled for origins: {ALLOWED_ORIGINS}")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _proxy_websocket(
    client_ws: WebSocket,
    upstream_url: str,
    initial_message: Optional[Dict[str, Any]] = None,
    connection_timeout: float = 10.0
):
    """
    Generic WebSocket proxy with improved error handling.
    
    Args:
        client_ws: Connected FastAPI WebSocket from client
        upstream_url: URL of upstream WebSocket service
        initial_message: Optional initial JSON message to send upstream
        connection_timeout: Timeout for connecting to upstream (seconds)
    """
    headers = [
        ("Authorization", f"Bearer {CARTESIA_API_KEY}"),
        ("Cartesia-Version", CARTESIA_VERSION)
    ]

    upstream = None
    try:
        # Connect to upstream with timeout
        logger.info(f"Connecting to upstream: {upstream_url}")
        upstream = await asyncio.wait_for(
            websockets.connect(upstream_url, extra_headers=headers),
            timeout=connection_timeout
        )
        logger.info("Connected to upstream successfully")
    except asyncio.TimeoutError:
        logger.error(f"Timeout connecting to upstream: {upstream_url}")
        await client_ws.close(code=1011, reason="Upstream connection timeout")
        return
    except Exception as e:
        logger.exception(f"Failed to connect to upstream: {upstream_url}")
        await client_ws.close(code=1011, reason="Failed to connect to upstream service")
        return

    async def client_to_upstream():
        """Forward messages from client to upstream."""
        try:
            # Send initial message upstream if provided
            if initial_message:
                try:
                    await upstream.send(json.dumps(initial_message))
                    logger.debug(f"Sent initial message upstream: {initial_message.get('action', 'N/A')}")
                except Exception as e:
                    logger.error(f"Failed to send initial message upstream: {e}")
                    return

            while True:
                try:
                    data = await client_ws.receive()
                except WebSocketDisconnect:
                    logger.info("Client disconnected")
                    break
                
                msg_type = data.get("type")
                
                if msg_type == "websocket.disconnect":
                    logger.info("Client sent disconnect")
                    break
                elif msg_type == "websocket.receive":
                    # Forward binary or text data
                    if "bytes" in data and data["bytes"] is not None:
                        await upstream.send(data["bytes"])
                    elif "text" in data and data["text"] is not None:
                        await upstream.send(data["text"])
                        
        except Exception as e:
            logger.exception("Error in client_to_upstream")
        finally:
            try:
                await upstream.close()
            except:
                pass

    async def upstream_to_client():
        """Forward messages from upstream to client."""
        try:
            async for msg in upstream:
                # Forward binary or text frames
                if isinstance(msg, (bytes, bytearray)):
                    await client_ws.send_bytes(msg)
                else:
                    await client_ws.send_text(msg)
        except websockets.exceptions.ConnectionClosed:
            logger.info("Upstream connection closed")
        except Exception as e:
            logger.exception("Error in upstream_to_client")
        finally:
            try:
                await client_ws.close()
            except:
                pass

    try:
        # Run both directions concurrently
        await asyncio.gather(
            client_to_upstream(),
            upstream_to_client(),
            return_exceptions=True
        )
    finally:
        try:
            if upstream:
                await upstream.close()
        except:
            pass


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "cartesia-websocket-proxy"}


@app.websocket("/ws/stt")
async def websocket_stt_endpoint(ws: WebSocket):
    """
    STT WebSocket proxy endpoint.
    
    Expected flow:
    1. Client connects
    2. Client sends initial JSON config: {action: "start", model_id: "...", language: "...", sample_rate: ...}
    3. Client sends binary audio frames (PCM Int16 LE)
    4. Server forwards everything to Cartesia
    5. Cartesia sends back transcript events (JSON)
    """
    logger.info("STT WebSocket connection attempt")
    await ws.accept()
    
    try:
        # Receive initial configuration from client
        try:
            init_data = await asyncio.wait_for(ws.receive_json(), timeout=5.0)
            logger.info(f"STT session started with config: {init_data}")
        except asyncio.TimeoutError:
            logger.warning("Client didn't send initial config, using defaults")
            init_data = {}
        except Exception as e:
            logger.error(f"Failed to receive initial config: {e}")
            await ws.close(code=4000, reason="Invalid initial message")
            return
        
        # Validate basic structure
        if not isinstance(init_data, dict):
            logger.error("Initial message is not a dict")
            await ws.close(code=4001, reason="Initial message must be JSON object")
            return
        
        # Start proxying
        await _proxy_websocket(ws, CARTESIA_STT_WS_URL, initial_message=init_data)
        
    except Exception as e:
        logger.exception("STT WebSocket error")
        try:
            await ws.close(code=1011)
        except:
            pass


@app.websocket("/ws/tts")
async def websocket_tts_endpoint(ws: WebSocket):
    """
    TTS WebSocket proxy endpoint.
    
    Expected flow:
    1. Client connects
    2. Client sends single JSON TTS request: {model_id, transcript, voice, language, output_format}
    3. Server forwards to Cartesia
    4. Cartesia streams back audio chunks (binary frames)
    5. Server forwards audio to client
    """
    logger.info("TTS WebSocket connection attempt")
    await ws.accept()
    
    try:
        # Receive initial TTS request from client
        try:
            init_request = await asyncio.wait_for(ws.receive_json(), timeout=5.0)
            logger.info(f"TTS request: {init_request.get('model_id', 'unknown model')}")
        except asyncio.TimeoutError:
            logger.error("Client didn't send TTS request in time")
            await ws.close(code=4000, reason="Request timeout")
            return
        except Exception as e:
            logger.error(f"Failed to receive TTS request: {e}")
            await ws.close(code=4000, reason="Invalid request")
            return
        
        # Validate request structure
        if not isinstance(init_request, dict):
            logger.error("TTS request is not a dict")
            await ws.close(code=4001, reason="Request must be JSON object")
            return
        
        if not init_request.get("transcript") and not init_request.get("text"):
            logger.error("TTS request missing transcript")
            await ws.close(code=4002, reason="Missing transcript field")
            return
        
        # Start proxying
        await _proxy_websocket(ws, CARTESIA_TTS_WS_URL, initial_message=init_request)
        
    except Exception as e:
        logger.exception("TTS WebSocket error")
        try:
            await ws.close(code=1011)
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
