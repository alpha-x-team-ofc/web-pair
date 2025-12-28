const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const app = express();

const PORT = process.env.PORT || 8001;

// Create session directory
const SESSION_DIR = path.join(__dirname, 'sessions');
fs.ensureDirSync(SESSION_DIR);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Import pairing router
const pairRouter = require('./pair');
app.use('/pair', pairRouter);

// Main HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        sessions: fs.readdirSync(SESSION_DIR).length 
    });
});

app.listen(PORT, () => {
    console.log(`
    ============================================
    🚀 DTZ NOVA XMD WhatsApp Pairing Server
    🌐 http://localhost:${PORT}
    📁 Sessions: ${SESSION_DIR}
    ============================================
    `);
});
