# Echo - Voice Cloning PWA

A web-based, mobile-first PWA for cloning user voice and synthesizing speech.

## Features

- Audio recording using MediaRecorder API
- File upload support for pre-recorded audio
- Text input with optional AI enhancement via OpenRouter
- Voice cloning using Coqui TTS (YourTTS model)
- Playback and download of generated audio
- PWA capabilities: installable, offline support
- Responsive, mobile-first design

## Tech Stack

### Frontend
- React 18+ with TypeScript
- Vite for fast development and building
- PWA plugin for offline capabilities
- Axios for HTTP requests

### Backend
- Node.js with Express
- Python script for voice cloning (using TTS, pydub, openai)
- Docker for containerization

## Prerequisites

- Docker and Docker Compose
- Node.js (for development without Docker)
- Python 3.8+ (for development without Docker)
- OpenRouter API key (optional, for text enhancement)

## Getting Started

### Development (without Docker)

1. **Backend Setup**
   ```bash
   cd backend
   npm install
   # Install Python dependencies
   pip install TTS pydub openai
   # Create .env file from .env.example and configure
   cp .env.example .env
   # Edit .env to add your OpenRouter API key (if desired)
   npm start
   ```

2. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   cp .env.example .env  # We'll create this below
   # Edit .env to set VITE_BACKEND_URL=http://localhost:8000
   npm run dev
   ```

3. **Environment Variables**
   - Backend: See `.env.example`
   - Frontend: Create a `.env` file in the frontend directory with:
     ```
     VITE_BACKEND_URL=http://localhost:8000
     ```

### Production (with Docker)

1. **Configure Environment**
   - Copy `.env.example` to `.env` in the backend directory and fill in the values.
   - The frontend uses the `VITE_BACKEND_URL` environment variable, which is set in the docker-compose.yml.

2. **Build and Run**
   ```bash
   docker-compose up --build
   ```

3. **Access the Application**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:8000

## Project Structure

```
echo/
├── backend/
│   ├── index.js              # Node.js Express server
│   ├── voice_clone.py        # Python voice cloning script
│   ├── package.json
│   ├── Dockerfile
│   ├── .env.example
│   ├── uploads/              # Audio sample uploads
│   ├── outputs/              # Generated audio files
│   └── models/               # TTS models (downloaded at runtime)
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main React component
│   │   ├── main.tsx          # Entry point
│   │   └── index.css         # Styles
│   ├── public/
│   │   ├── pwa-192x192.png   # PWA icons
│   │   └── pwa-512x512.png
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## API Endpoints

### Health Check
- **GET** `/api/health`
- Returns: `{ status: "ok" }`

### Voice Cloning
- **POST** `/api/clone-voice`
- Form Data:
  - `voiceSample`: audio file (wav, mp3, etc.)
  - `text`: text to synthesize
  - `enhance`: boolean (optional, default false)
- Returns: audio/wav file (cloned voice)

## PWA Features

- Installable on mobile and desktop
- Offline caching of static assets
- Background sync (future enhancement)
- Push notifications (future enhancement)

## Notes

- The first-time voice cloning may take longer as the TTS model is downloaded.
- Generated audio files are temporarily stored and cleaned up after sending.
- For production, consider using a cloud storage service for audio samples and generated audio.
- The OpenRouter API key is required only if you want to use the text enhancement feature.

## Troubleshooting

- **Microphone access not working**: Ensure the site is served over HTTPS (localhost is exempt) and that microphone permissions are granted.
- **Voice cloning fails**: Check the backend logs for Python errors. Ensure the TTS model can be downloaded (internet access required).
- **CORS issues**: The backend is configured to accept requests from any origin in development. Adjust the CORS middleware in `index.js` for production.

## License

MIT