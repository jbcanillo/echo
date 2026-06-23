FROM node:18-bullseye

# Set working directory
WORKDIR /app

# Copy backend files
COPY backend/package*.json ./
RUN npm ci

# Copy the rest of the backend
COPY backend/ .

# Install Python dependencies for voice cloning
RUN apt-get update && apt-get install -y python3-pip ffmpeg && \
    pip3 install TTS pydub openai && \
    rm -rf /var/lib/apt/lists/*

# Create directories for uploads and outputs
RUN mkdir -p uploads outputs models

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "start"]