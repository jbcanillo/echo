const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();
// Explicitly set port to 8000 for consistency with frontend expectations
// Can be overridden by PORT environment variable if needed
const PORT = parseInt(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';

console.log(`Starting server on ${HOST}:${PORT}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Ensure required directories exist
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
};

ensureDir('./uploads');
ensureDir('./outputs');
ensureDir('./models');

// Simple health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Voice cloning endpoint
app.post('/api/clone-voice', upload.single('voiceSample'), (req, res) => {
  // Python script path
  const pythonScript = path.join(__dirname, 'voice_clone.py');
  
  // Check if voice sample was uploaded
  if (!req.file) {
    return res.status(400).json({ error: 'No voice sample provided' });
  }
  
  // Get text and enhance flag from request body
  const { text, enhance } = req.body;
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Text is required' });
  }
  
  // Prepare input for Python script
  const inputData = {
    voice_sample_path: req.file.path,
    text: text,
    enhance: enhance === 'true' || enhance === true,
    openrouter_key: process.env.OPENROUTER_API_KEY || ''
  };
  
  // Spawn Python process
  const pythonProcess = spawn('python3', [pythonScript], {
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8'
    }
  });
  
  let resultData = '';
  let errorData = '';
  
  pythonProcess.stdout.on('data', (data) => {
    resultData += data.toString();
  });
  
  pythonProcess.stderr.on('data', (data) => {
    errorData += data.toString();
  });
  
  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`Python script exited with code ${code}`);
      console.error(`Stderr: ${errorData}`);
      return res.status(500).json({ error: 'Voice cloning process failed' });
    }
    
    try {
      const result = JSON.parse(resultData.trim());
      
      if (result.error) {
        console.error(`Python script error: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }
      
      if (result.output_path) {
        // Check if output file exists
        const outputPath = path.join(__dirname, result.output_path);
        if (fs.existsSync(outputPath)) {
          // Set appropriate headers for audio file
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Disposition', 'attachment; filename="cloned_voice.wav"');
          
          // Send the file
          const fileStream = fs.createReadStream(outputPath);
          fileStream.pipe(res);
          
          // Cleanup input and output files after sending
          fileStream.on('end', () => {
            try {
              fs.unlinkSync(req.file.path);
              fs.unlinkSync(outputPath);
            } catch (cleanupError) {
              console.warn('Cleanup error:', cleanupError);
            }
          });
        } else {
          res.status(500).json({ error: 'Generated audio file not found' });
        }
      } else {
        res.status(500).json({ error: 'Unexpected response from voice cloning service' });
      }
    } catch (parseError) {
      console.error('Failed to parse Python script output:', parseError);
      console.error('Stdout:', resultData);
      console.error('Stderr:', errorData);
      res.status(500).json({ error: 'Failed to process voice cloning result' });
    }
  });
});

// Handle preflight requests
app.options('/api/clone-voice', cors());

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});