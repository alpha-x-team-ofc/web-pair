const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 8001;
const __path = process.cwd();

// Increase event listeners
require('events').EventEmitter.defaultMaxListeners = 500;

// Create necessary directories
const tempDir = path.join(__path, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import and use pair.js router
const pairCode = require('./pair');
app.use('/code', pairCode);

// Serve static files if needed
app.use(express.static(__path));

// Serve pair.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__path, 'pair.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`📁 Temp directory: ${tempDir}`);
});

module.exports = app;
