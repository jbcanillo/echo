FROM node:20-bookworm-slim

WORKDIR /app

# Python + ffmpeg for voice cloning (venv avoids Debian's externally-managed pip)
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv ffmpeg && \
    rm -rf /var/lib/apt/lists/*
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# CPU-only PyTorch keeps the image several GB smaller than the default CUDA build
COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchaudio && \
    pip install --no-cache-dir -r requirements.txt

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Downloaded TTS models are cached here (mounted as a volume in docker-compose)
ENV TTS_HOME=/app/models
RUN mkdir -p uploads outputs models

EXPOSE 8000

CMD ["node", "index.js"]
