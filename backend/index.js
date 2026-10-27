const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB) || 20;
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH) || 1000;
// Covers the first-run model download as well as synthesis on CPU
const JOB_TIMEOUT_MS = (parseInt(process.env.JOB_TIMEOUT_SECONDS) || 600) * 1000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');

console.log(`Starting server on ${HOST}:${PORT}`);

// Ensure required directories exist
for (const dir of [UPLOAD_DIR, OUTPUT_DIR, path.join(__dirname, 'models')]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Middleware
// CORS_ORIGIN is a comma-separated list of allowed origins; unset allows all (development)
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : '*';
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.webm', '.flac']);

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: function (req, file, cb) {
    // Some clients send recordings as video/* or application/octet-stream, so also accept by extension
    if (file.mimetype.startsWith('audio/') || AUDIO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'voiceSample'));
    }
  }
});

const cloneLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute' }
});

const removeFile = (filePath) => {
  fs.promises.unlink(filePath).catch((err) => {
    if (err.code !== 'ENOENT') console.warn('Cleanup error:', err);
  });
};

// Long-running Python worker so the TTS model is loaded once, not per request.
// Jobs run one at a time; the worker is restarted if it crashes or times out.
const worker = {
  proc: null,
  queue: [],
  current: null,
  nextId: 1,

  start() {
    const proc = spawn(process.env.PYTHON_BIN || 'python3', [path.join(__dirname, 'voice_clone.py')], {
      cwd: __dirname,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.proc = proc;

    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let result;
      try {
        result = JSON.parse(line);
      } catch {
        console.warn('Ignoring non-JSON worker output:', line);
        return;
      }
      if (this.current && result.id === this.current.id) {
        this.finish(result);
      }
    });
    proc.stderr.on('data', (data) => process.stderr.write(`[voice_clone] ${data}`));
    proc.on('error', (err) => console.error('Failed to start voice cloning worker:', err));
    proc.on('exit', (code, signal) => {
      console.error(`Voice cloning worker exited (code ${code}, signal ${signal})`);
      // Ignore exits of a worker that was already replaced (e.g. killed after a timeout)
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.current) this.finish({ error: 'Voice cloning process failed' });
    });
  },

  run(job) {
    return new Promise((resolve) => {
      this.queue.push({ ...job, id: this.nextId++, resolve });
      this.next();
    });
  },

  next() {
    if (this.current || this.queue.length === 0) return;
    if (!this.proc) this.start();
    const job = this.queue.shift();
    this.current = job;
    job.timer = setTimeout(() => {
      console.error(`Voice cloning job ${job.id} timed out`);
      const proc = this.proc;
      this.proc = null;
      proc?.kill('SIGKILL');
      this.finish({ error: 'Voice cloning timed out' });
    }, JOB_TIMEOUT_MS);
    const { resolve, timer, ...payload } = job;
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  },

  finish(result) {
    const job = this.current;
    this.current = null;
    clearTimeout(job.timer);
    job.resolve(result);
    this.next();
  }
};

// Simple health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Voice cloning endpoint
app.post('/api/clone-voice', cloneLimiter, upload.single('voiceSample'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No voice sample provided' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(OUTPUT_DIR, path.parse(req.file.filename).name + '_output.wav');
  let responded = false;
  res.on('close', () => {
    removeFile(inputPath);
    if (!responded) removeFile(outputPath);
  });

  const { text, enhance, consent } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Text is required' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Text must be at most ${MAX_TEXT_LENGTH} characters` });
  }
  if (consent !== 'true' && consent !== true) {
    return res.status(400).json({ error: 'Consent from the voice owner is required' });
  }

  const result = await worker.run({
    voice_sample_path: inputPath,
    output_path: outputPath,
    text: text.trim(),
    enhance: enhance === 'true' || enhance === true,
    openrouter_key: process.env.OPENROUTER_API_KEY || ''
  });

  // Client disconnected while the job was running
  if (res.destroyed) {
    removeFile(outputPath);
    return;
  }

  if (result.error) {
    console.error(`Voice cloning error: ${result.error}`);
    removeFile(outputPath);
    return res.status(500).json({ error: result.error });
  }

  if (!fs.existsSync(outputPath)) {
    return res.status(500).json({ error: 'Generated audio file not found' });
  }

  responded = true;
  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Content-Disposition', 'attachment; filename="cloned_voice.wav"');
  const fileStream = fs.createReadStream(outputPath);
  fileStream.on('close', () => removeFile(outputPath));
  fileStream.pipe(res);
});

// Upload and other errors
app.use((err, req, res, next) => {
  if (req.file) removeFile(req.file.path);
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `Voice sample must be at most ${MAX_UPLOAD_MB} MB`
      : 'Please upload a single audio file as voiceSample';
    return res.status(400).json({ error: message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
