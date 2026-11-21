const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const buildOpenApiSpec = require('./openapi');
const appSettings = require('./settings');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
// One .env at the repository root is shared with Docker Compose and the frontend
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
// The backend runs behind the nginx container, which sets X-Forwarded-For.
// Trust exactly one hop so rate limiting keys on the real client IP.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS) || 1);
const PORT = parseInt(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB) || 20;
const MAX_TEXT_LENGTH = parseInt(process.env.MAX_TEXT_LENGTH) || 5000;
const MAX_PROMPT_LENGTH = 1000;
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 5;
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
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute' }
});

const settingsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again in a minute' }
});

// Synthesizer tuning sent with each cloning request. Ranges are generous but keep the model sane.
const SYNTH_RANGES = {
  speed: [0.5, 2], // 1 = normal; higher is faster
  expressiveness: [0.1, 1], // how much the pitch and tone vary; lower is steadier
  variation: [0, 1.5] // how much the rhythm and pauses vary
};

function parseSynthSettings(body) {
  const out = {};
  for (const [field, [min, max]] of Object.entries(SYNTH_RANGES)) {
    const raw = body[field];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      return { error: `${field} must be a number between ${min} and ${max}` };
    }
    out[field] = value;
  }
  if (body.language !== undefined && body.language !== '') {
    if (typeof body.language !== 'string' || !/^[a-z]{2}(-[a-z]{2})?$/i.test(body.language)) {
      return { error: 'language must be a code such as en, fr-fr or pt-br' };
    }
    out.language = body.language.toLowerCase();
  }
  return { settings: out };
}

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

// API documentation (Swagger UI) and the raw OpenAPI spec
const apiSpec = buildOpenApiSpec({
  maxTextLength: MAX_TEXT_LENGTH,
  maxPromptLength: MAX_PROMPT_LENGTH,
  maxUploadMb: MAX_UPLOAD_MB,
  rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
  synthRanges: SYNTH_RANGES
});
app.get('/api/openapi.json', (req, res) => res.json(apiSpec));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(apiSpec, { customSiteTitle: 'Echo API' }));

// Settings: the OpenRouter key and model. The key is write-only: it is never sent back to the browser.
app.get('/api/settings', settingsLimiter, (req, res) => {
  res.json({
    openrouter: appSettings.publicOpenRouter(),
    synthesizer: { ranges: SYNTH_RANGES, languages: ['en', 'fr-fr', 'pt-br'] }
  });
});

app.put('/api/settings', settingsLimiter, (req, res) => {
  const { openrouterApiKey, openrouterModel } = req.body || {};
  const change = {};
  if (openrouterApiKey !== undefined) {
    if (typeof openrouterApiKey !== 'string' || openrouterApiKey.length > 300 || /\s/.test(openrouterApiKey)) {
      return res.status(400).json({ error: 'The API key must be a single string without spaces' });
    }
    change.openrouterApiKey = openrouterApiKey;
  }
  if (openrouterModel !== undefined) {
    if (typeof openrouterModel !== 'string' || openrouterModel.length > 120 || (openrouterModel && !/^[\w\-./:]+$/.test(openrouterModel))) {
      return res.status(400).json({ error: 'The model must look like provider/model-name' });
    }
    change.openrouterModel = openrouterModel;
  }
  try {
    appSettings.update(change);
  } catch (err) {
    console.error('Could not save settings:', err.message);
    return res.status(500).json({ error: 'Could not save the settings on the server' });
  }
  res.json({ openrouter: appSettings.publicOpenRouter() });
});

// Checks the saved key (or one passed in the body, to test before saving) against OpenRouter
app.post('/api/settings/test', settingsLimiter, async (req, res) => {
  const candidate = typeof req.body?.openrouterApiKey === 'string' ? req.body.openrouterApiKey.trim() : '';
  const key = candidate || appSettings.getApiKey();
  if (!key) {
    return res.status(400).json({ error: 'No OpenRouter API key to test' });
  }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 401 || response.status === 403) {
      return res.status(400).json({ error: 'OpenRouter rejected this key' });
    }
    if (!response.ok) {
      return res.status(502).json({ error: `OpenRouter returned HTTP ${response.status}` });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('OpenRouter key test failed:', err.message);
    res.status(502).json({ error: 'Could not reach OpenRouter' });
  }
});

// Simple health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// The limits actually in force, so the UI never has to guess (or hard-code) them
app.get('/api/config', (req, res) => {
  res.json({ maxTextLength: MAX_TEXT_LENGTH, maxPromptLength: MAX_PROMPT_LENGTH, maxUploadMb: MAX_UPLOAD_MB });
});

// Shared by the text endpoints: send a system + user message to OpenRouter and return the reply,
// trimmed to MAX_TEXT_LENGTH. Sends the error response itself and returns null on failure.
async function askModel(res, system, user) {
  const apiKey = appSettings.getApiKey();
  if (!apiKey) {
    res.status(503).json({ error: 'Text generation is not configured: add an OpenRouter API key in Settings' });
    return null;
  }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: appSettings.getModel(),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      console.error('OpenRouter error:', response.status, await response.text().catch(() => ''));
      res.status(502).json({ error: 'Text generation failed, please try again' });
      return null;
    }
    const data = await response.json();
    let text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      res.status(502).json({ error: 'The model returned no text, please try again' });
      return null;
    }
    // Models sometimes overshoot; cut at the last sentence end that fits
    if (text.length > MAX_TEXT_LENGTH) {
      const cut = text.slice(0, MAX_TEXT_LENGTH);
      const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
      text = lastStop > MAX_TEXT_LENGTH * 0.5 ? cut.slice(0, lastStop + 1) : cut;
    }
    return text;
  } catch (err) {
    console.error('Text generation error:', err);
    res.status(502).json({ error: 'Text generation failed, please try again' });
    return null;
  }
}

const SPEECH_STYLE =
  'Use plain prose: no markdown, headings, lists, emojis or stage directions, and spell out ' +
  'numbers and abbreviations. Separate paragraphs with a blank line. ' +
  `Keep the whole response under ${MAX_TEXT_LENGTH} characters. ` +
  'Reply with the text only, without quotes or commentary.';

// Text generation endpoint: turns a user's idea ("a bedtime story about monsters") into text to speak
app.post('/api/generate-text', cloneLimiter, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({ error: `Prompt must be at most ${MAX_PROMPT_LENGTH} characters` });
  }
  const text = await askModel(
    res,
    "You write text that will be read aloud by a speech synthesizer. Follow the user's request. " + SPEECH_STYLE,
    prompt
  );
  if (text !== null) res.json({ text });
});

// Polish endpoint: rewrites existing text so it sounds natural when spoken
app.post('/api/enhance-text', cloneLimiter, async (req, res) => {
  const input = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!input) {
    return res.status(400).json({ error: 'Text is required' });
  }
  if (input.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `Text must be at most ${MAX_TEXT_LENGTH} characters` });
  }
  const text = await askModel(
    res,
    "Rewrite the user's text so it sounds natural when read aloud by a speech synthesizer. " +
      'Keep the meaning, the language and roughly the same length. ' + SPEECH_STYLE,
    input
  );
  if (text !== null) res.json({ text });
});

// Voice cloning endpoint
app.post('/api/clone-voice', cloneLimiter, upload.single('voiceSample'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No voice sample provided' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(OUTPUT_DIR, path.parse(req.file.filename).name + '_output.wav');
  // Converted copy written by voice_clone.py; normally removed there, but not if the worker is killed
  const processedPath = path.join(UPLOAD_DIR, path.parse(req.file.filename).name + '_processed.wav');
  let responded = false;
  res.on('close', () => {
    removeFile(inputPath);
    removeFile(processedPath);
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

  const synth = parseSynthSettings(req.body);
  if (synth.error) {
    return res.status(400).json({ error: synth.error });
  }

  const result = await worker.run({
    voice_sample_path: inputPath,
    output_path: outputPath,
    text: text.trim(),
    enhance: enhance === 'true' || enhance === true,
    openrouter_key: appSettings.getApiKey(),
    openrouter_model: appSettings.getModel(),
    ...synth.settings
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
  // A stale value in .env silently overrides the defaults, so show what is really in force
  console.log(
    `Limits: text ${MAX_TEXT_LENGTH} chars, prompt ${MAX_PROMPT_LENGTH} chars, upload ${MAX_UPLOAD_MB} MB, ` +
      `${RATE_LIMIT_PER_MINUTE} requests/min, job timeout ${JOB_TIMEOUT_MS / 1000}s`
  );
});
