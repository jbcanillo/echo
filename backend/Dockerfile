FROM node:20-bookworm-slim

WORKDIR /app

# Python + ffmpeg for voice cloning (venv avoids Debian's externally-managed pip)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv ffmpeg && \
    rm -rf /var/lib/apt/lists/*
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# coqui-tts doesn't install PyTorch itself. The CPU-only build keeps the image several GB
# smaller than the default CUDA build; torchcodec is needed for audio I/O with PyTorch 2.9+.
# PyPI stays the main index (--extra-index-url, not --index-url) because the PyTorch index only
# hosts torch packages, not their dependencies (typing_extensions, numpy, ...).
COPY requirements.txt ./
# Installed in ONE pip call so the resolver picks torch versions that satisfy coqui-tts too.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    torch torchaudio torchcodec -r requirements.txt

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Downloaded TTS models are cached here (mounted as a volume in docker-compose)
ENV TTS_HOME=/app/models
RUN mkdir -p uploads outputs models

EXPOSE 8000

CMD ["node", "index.js"]
