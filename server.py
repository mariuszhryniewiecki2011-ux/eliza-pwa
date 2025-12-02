from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional, Dict, Any
import os
import logging
import httpx

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Requirements:
# pip install fastapi uvicorn httpx pydantic

CARTESIA_API_KEY = os.getenv("CARTESIA_API_KEY")
if not CARTESIA_API_KEY:
    raise RuntimeError("Set CARTESIA_API_KEY environment variable before starting the server")

# Optional: set API version header
CARTESIA_VERSION = os.getenv("CARTESIA_VERSION", "2025-04-16")
CARTESIA_BASE = os.getenv("CARTESIA_BASE_URL", "https://api.cartesia.ai")

# Configure allowed origins (SECURITY FIX)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")
if not ALLOWED_ORIGINS or ALLOWED_ORIGINS == [""]:
    logger.warning("ALLOWED_ORIGINS not set. Using wildcard (*) - NOT RECOMMENDED FOR PRODUCTION")
    ALLOWED_ORIGINS = ["*"]
else:
    logger.info(f"CORS enabled for origins: {ALLOWED_ORIGINS}")

app = FastAPI(title="Cartesia Proxy API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# Pydantic models for request validation
class Voice(BaseModel):
    mode: str = Field(..., regex="^(id|embedding)$")
    id: Optional[str] = None
    embedding: Optional[list] = None
    
    @validator('id')
    def validate_voice_id(cls, v, values):
        if values.get('mode') == 'id' and not v:
            raise ValueError('voice.id is required when mode is "id"')
        return v


class OutputFormat(BaseModel):
    container: str = Field(default="wav", regex="^(wav|mp3|raw)$")
    sample_rate: int = Field(default=44100, ge=8000, le=48000)
    encoding: str = Field(default="pcm_f32le")


class TTSRequest(BaseModel):
    model_id: str = Field(default="sonic-2")
    transcript: str = Field(..., min_length=1, max_length=10000)
    voice: Voice
    language: Optional[str] = Field(None, regex="^[a-z]{2}(-[A-Z]{2})?$")
    output_format: Optional[OutputFormat] = None
    speed: Optional[str] = Field(None, regex="^(slowest|slow|normal|fast|fastest)$")
    
    class Config:
        schema_extra = {
            "example": {
                "model_id": "sonic-2",
                "transcript": "Hello, world!",
                "voice": {"mode": "id", "id": "voice-id-here"},
                "language": "en",
                "output_format": {
                    "container": "wav",
                    "sample_rate": 44100,
                    "encoding": "pcm_f32le"
                }
            }
        }


# Shared httpx.AsyncClient so we reuse connections
client: Optional[httpx.AsyncClient] = None


@app.on_event("startup")
async def startup_event():
    global client
    client = httpx.AsyncClient(timeout=60.0)
    logger.info("Server started successfully")


@app.on_event("shutdown")
async def shutdown_event():
    global client
    if client:
        await client.aclose()
    logger.info("Server shutdown complete")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "cartesia-proxy"}


@app.post("/api/tts")
async def tts(request: Request):
    """
    Proxy to Cartesia /tts/bytes (POST).
    
    Accepts a JSON body conforming to the TTSRequest schema.
    Streams the binary audio response back to the caller.
    """
    try:
        # Parse and validate request body
        body = await request.json()
        
        # Handle legacy field names for backwards compatibility
        if "text" in body and "transcript" not in body:
            body["transcript"] = body["text"]
        
        if "voice_id" in body or "voiceId" in body:
            voice_id = body.get("voice_id") or body.get("voiceId")
            if "voice" not in body:
                body["voice"] = {"mode": "id", "id": voice_id}
        
        # Validate using Pydantic model
        tts_request = TTSRequest(**body)
        
        # Convert back to dict for Cartesia API
        cartesia_body = {
            "model_id": tts_request.model_id,
            "transcript": tts_request.transcript,
            "voice": tts_request.voice.dict(exclude_none=True),
            "output_format": (tts_request.output_format.dict() 
                            if tts_request.output_format 
                            else {"container": "wav", "sample_rate": 44100, "encoding": "pcm_f32le"}),
        }
        
        if tts_request.language:
            cartesia_body["language"] = tts_request.language
        
        if tts_request.speed:
            cartesia_body["speed"] = tts_request.speed
        
        logger.info(f"TTS request: model={tts_request.model_id}, language={tts_request.language}, "
                   f"text_length={len(tts_request.transcript)}")
        
    except ValueError as e:
        logger.warning(f"Validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
    except Exception as e:
        logger.error(f"Request parsing error: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to parse request: {str(e)}")

    url = f"{CARTESIA_BASE}/tts/bytes"
    headers = {
        "Authorization": f"Bearer {CARTESIA_API_KEY}",
        "Cartesia-Version": CARTESIA_VERSION,
        "Accept": "audio/*",
        "Content-Type": "application/json",
    }

    global client
    if client is None:
        logger.warning("Client not initialized, creating new one")
        client = httpx.AsyncClient(timeout=60.0)

    try:
        # Stream the POST to Cartesia and forward the stream to the client
        async with client.stream("POST", url, json=cartesia_body, headers=headers, timeout=120.0) as resp:
            # If the upstream failed, read text and return an error
            if resp.status_code != 200:
                try:
                    err_text = await resp.aread()
                    try:
                        decoded = err_text.decode("utf-8", errors="replace")
                    except Exception:
                        decoded = str(err_text)
                except Exception:
                    decoded = f"Cartesia returned status {resp.status_code}"
                
                logger.error(f"Cartesia API error: {resp.status_code} - {decoded}")
                raise HTTPException(status_code=502, detail=f"Cartesia error: {decoded}")

            # Choose media_type from the upstream response if present
            media_type = resp.headers.get("content-type", "application/octet-stream")

            # Preserve Cartesia-File-ID header if present
            out_headers = {}
            cartesia_file_id = resp.headers.get("Cartesia-File-ID")
            if cartesia_file_id:
                out_headers["Cartesia-File-ID"] = cartesia_file_id

            logger.info("TTS request successful, streaming response")
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type=media_type,
                status_code=200,
                headers=out_headers
            )
            
    except httpx.RequestError as e:
        logger.error(f"Network error contacting Cartesia: {str(e)}")
        raise HTTPException(status_code=502, detail=f"Network error when contacting Cartesia: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.get("/api/languages")
async def list_languages():
    """
    Fetch available languages from Cartesia.
    Note: This endpoint needs to be implemented based on Cartesia's actual API.
    """
    # Placeholder - implement based on actual Cartesia API
    logger.warning("Languages endpoint called but not fully implemented")
    return [
        {"id": "en", "name": "English"},
        {"id": "es", "name": "Spanish"},
        {"id": "fr", "name": "French"},
        {"id": "de", "name": "German"},
    ]


@app.get("/api/voices")
async def list_voices(language: Optional[str] = None):
    """
    Fetch available voices from Cartesia.
    Note: This endpoint needs to be implemented based on Cartesia's actual API.
    """
    # Placeholder - implement based on actual Cartesia API
    logger.warning(f"Voices endpoint called for language={language} but not fully implemented")
    return [
        {"id": "voice-1", "name": "Voice 1"},
        {"id": "voice-2", "name": "Voice 2"},
    ]


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
