# Echo - Voice Cloning PWA

A web-based, mobile-first PWA for cloning user voice and synthesizing speech.

## Features

- Audio recording using MediaRecorder API
- File upload support for pre-recorded audio
- Text input with optional AI enhancement via OpenRouter
- Voice cloning using Coqui TTS (YourTTS model, via the maintained `coqui-tts` fork)
- Playback and download of generated audio
- Consent confirmation before a voice can be cloned
- Animated 3D avatar that listens while you record, thinks while the voice is generated and lip-syncs to the result
- PWA capabilities: installable, offline caching of the app shell
- Responsive, mobile-first design

## Tech Stack

### Frontend
- React 18 with TypeScript
- Vite 5 with `vite-plugin-pwa`
- [TalkingHead](https://github.com/met4citizen/TalkingHead) (three.js) for the 3D avatar, with [HeadAudio](https://github.com/met4citizen/HeadAudio) for audio-driven lip-sync
- nginx in production (serves the app and proxies `/api` to the backend)

### Backend
- Node.js 20 with Express
- A long-running Python worker (`voice_clone.py`) using `coqui-tts`, `pydub` and `openai`; the TTS model is loaded once and reused across requests
- ffmpeg for decoding uploaded or recorded audio

## Prerequisites

- Docker and Docker Compose, **or**
- Node.js 20+, Python 3.10–3.12 and ffmpeg for local development
- OpenRouter API key (optional, for text enhancement)

## Getting Started

### Development (without Docker)

1. **Backend**
   ```bash
   cd backend
   npm install
   python3 -m venv .venv && source .venv/bin/activate
   # PyTorch first (CPU build shown; see https://pytorch.org/get-started/locally/ for GPU)
   pip install --index-url https://download.pytorch.org/whl/cpu torch torchaudio torchcodec
   pip install -r requirements.txt
   cp .env.example .env   # optionally add OPENROUTER_API_KEY
   npm start              # http://localhost:8000
   ```
   If Python isn't `python3` on your PATH, set `PYTHON_BIN` (e.g. `PYTHON_BIN=.venv/bin/python npm start`).

2. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev            # http://localhost:5173
   ```
   The dev server proxies `/api` to `http://localhost:8000` (override with `VITE_PROXY_TARGET`).
   To call the backend directly instead, set `VITE_BACKEND_URL` and allow the origin with the backend's `CORS_ORIGIN`.

### Production (with Docker)

```bash
cp backend/.env.example backend/.env   # optional; edit as needed
docker compose up --build
```

- App: http://localhost:5173 (nginx, which proxies `/api` to the backend)
- Backend API: http://localhost:8000
- Downloaded TTS models are kept in the `tts-models` volume, so only the first run downloads them.

## Configuration (backend `.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` / `HOST` | `8000` / `0.0.0.0` | Listen address |
| `CORS_ORIGIN` | *(all)* | Comma-separated allowed origins |
| `OPENROUTER_API_KEY` | | Enables the "Enhance text" option |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Model used for enhancement |
| `TTS_MODEL_NAME` | `tts_models/multilingual/multi-dataset/your_tts` | Coqui TTS model |
| `MAX_UPLOAD_MB` | `20` | Maximum voice sample size |
| `MAX_TEXT_LENGTH` | `1000` | Maximum text length |
| `JOB_TIMEOUT_SECONDS` | `600` | Per-request synthesis timeout (worker is restarted on timeout) |
| `RATE_LIMIT_PER_MINUTE` | `5` | Clone requests per client IP per minute |
| `PYTHON_BIN` | `python3` | Python interpreter for the worker |

## Project Structure

```
echo/
├── backend/
│   ├── index.js              # Express server + Python worker management
│   ├── voice_clone.py        # Long-running voice cloning worker (JSON lines over stdin/stdout)
│   ├── requirements.txt      # Python dependencies
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main React component
│   │   ├── Avatar.tsx        # 3D avatar (TalkingHead + HeadAudio lip-sync)
│   │   ├── main.tsx          # Entry point
│   │   └── index.css         # Styles
│   ├── public/               # PWA icons, avatars/generic.glb
│   ├── nginx.conf            # Production nginx config (SPA + /api proxy)
│   ├── vite.config.ts
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## API Endpoints

### Health Check
- **GET** `/api/health`
- Returns: `{ "status": "ok" }`

### Voice Cloning
- **POST** `/api/clone-voice` (multipart form data)
  - `voiceSample`: audio file (wav, mp3, m4a, ogg, webm, flac, …)
  - `text`: text to synthesize (max `MAX_TEXT_LENGTH` characters)
  - `consent`: must be `true` — confirms the speaker agreed to having their voice cloned
  - `enhance`: `true` to rewrite the text via OpenRouter first (optional)
- Returns: `audio/wav` on success, or `{ "error": "..." }` with status 400/429/500

## Avatar

The avatar lives in `frontend/src/Avatar.tsx` and runs entirely in the browser:

- **Listening** while you record (it follows the microphone)
- **Thinking** while the voice is generated
- **Speaking** when the generated audio plays: the audio is analysed live, so the lips follow whatever the player plays, including pause and seek

It is loaded as a separate chunk after the page is shown. If WebGL isn't available the avatar is hidden and the rest of the app works as before.

### Replacing the model

The bundled `frontend/public/avatars/generic.glb` is a placeholder: the CC0 "MPFB" sample avatar from the TalkingHead project, compressed from 37 MB to 4.6 MB. To use your own:

1. Create a GLB with a Mixamo-compatible rig plus ARKit and Oculus viseme blend shapes (see [TalkingHead, Appendix A](https://github.com/met4citizen/TalkingHead#appendix-a-create-your-own-3d-avatar)).
2. Compress it (textures to WebP, geometry with Meshopt; avoid `optimize`/`simplify`, which can break blend shapes):
   ```bash
   npx @gltf-transform/cli resize in.glb a.glb --width 1024 --height 1024
   npx @gltf-transform/cli webp a.glb b.glb
   npx @gltf-transform/cli meshopt b.glb generic.glb
   ```
3. Replace `frontend/public/avatars/generic.glb`, or change `AVATAR_URL` / `AVATAR_OPTIONS` (body type, mood, camera view) at the top of `Avatar.tsx`.

## PWA Features

- Installable on mobile and desktop
- Offline caching of the app shell (voice generation itself needs the backend)

## Notes

- The first-time voice cloning may take longer as the TTS model is downloaded.
- Uploaded samples and generated audio are temporary and deleted after each request.
- Only clone voices you have permission to use.
- For production, consider using a cloud storage service for audio samples and generated audio.
- The OpenRouter API key is required only if you want to use the text enhancement feature.

## Troubleshooting

- **Microphone access not working**: Ensure the site is served over HTTPS (localhost is exempt) and that microphone permissions are granted.
- **Voice cloning fails**: Check the backend logs (worker output is prefixed with `[voice_clone]`). Ensure the TTS model can be downloaded (internet access required) and ffmpeg is installed.
- **Requests time out on first use**: The first request downloads the model; raise `JOB_TIMEOUT_SECONDS` on slow connections.
- **CORS issues**: Only relevant when `VITE_BACKEND_URL` points at the backend directly; set `CORS_ORIGIN` to the frontend's origin.

## License

MIT