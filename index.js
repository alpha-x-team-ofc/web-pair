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
    console.log(`📁 Created temp directory: ${tempDir}`);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// Import and use pair.js router
const pairCode = require('./pair');
app.use('/code', pairCode);

// Serve static files if needed
app.use(express.static(__path));

// Serve pair.html at root
app.get('/', (req, res) => {
    try {
        res.sendFile(path.join(__path, 'pair.html'));
    } catch (err) {
        res.status(500).send('Error loading page');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        tempDir: fs.existsSync(tempDir)
    });
});

// Server info endpoint
app.get('/info', (req, res) => {
    res.json({
        name: 'DTZ NOVA XMD Pairing Server',
        version: '2.0.0',
        port: PORT,
        tempDir: tempDir,
        tempExists: fs.existsSync(tempDir)
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: err.message 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Not Found',
        message: `Route ${req.url} not found` 
    });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ ====================================== ✨`);
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`✅ Network: http://${getIPAddress()}:${PORT}`);
    console.log(`📁 Temp directory: ${tempDir}`);
    console.log(`🕒 Started: ${new Date().toLocaleString()}`);
    console.log(`✨ ====================================== ✨\n`);
});

// Get IP address function
function getIPAddress() {
    const interfaces = require('os').networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const alias of iface) {
            if (alias.family === 'IPv4' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Server shutting down...');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

module.exports = app;
