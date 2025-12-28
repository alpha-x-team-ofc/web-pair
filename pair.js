const { makeid } = require('./gen-id');
const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const router = express.Router();

// Ensure temp directory exists
const tempBaseDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempBaseDir)) {
    fs.mkdirSync(tempBaseDir, { recursive: true });
}

// Store active sessions
const activeSessions = new Map();

// Cleanup function
function removeFolder(folderPath) {
    try {
        if (fs.existsSync(folderPath)) {
            fs.readdirSync(folderPath).forEach(file => {
                const curPath = path.join(folderPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    removeFolder(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(folderPath);
        }
    } catch (err) {
        console.error('Cleanup error:', err.message);
    }
}

router.get('/', async (req, res) => {
    const sessionId = makeid(8);
    let phoneNumber = req.query.number || '';
    
    // Clean phone number (keep only digits)
    phoneNumber = phoneNumber.replace(/\D/g, '');
    
    console.log(`📱 [${sessionId}] Request for number: ${phoneNumber}`);
    
    if (!phoneNumber || phoneNumber.length < 10) {
        return res.status(400).json({ 
            error: "Please provide a valid WhatsApp number (at least 10 digits)",
            example: "94712345678"
        });
    }
    
    // Ensure phone number has country code
    if (!phoneNumber.startsWith('94') && phoneNumber.length === 9) {
        phoneNumber = '94' + phoneNumber; // Add Sri Lanka country code
    }
    
    const tempDir = path.join(tempBaseDir, sessionId);
    
    try {
        // Create temp directory
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Setup WhatsApp socket
        const { state, saveCreds } = await useMultiFileAuthState(tempDir);
        const logger = pino({ level: 'silent' });
        
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS("Safari"),
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });
        
        // Store credentials
        sock.ev.on('creds.update', saveCreds);
        
        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`[${sessionId}] Connection update:`, connection);
            
            if (connection === 'open') {
                console.log(`✅ [${sessionId}] WhatsApp connected!`);
                
                try {
                    // Wait a moment for connection to stabilize
                    await delay(2000);
                    
                    // Get user info
                    const user = sock.user;
                    if (!user) {
                        throw new Error('User information not available');
                    }
                    
                    console.log(`[${sessionId}] Connected as: ${user.id}`);
                    
                    // Read session files
                    const sessionFiles = fs.readdirSync(tempDir);
                    let sessionData = {};
                    
                    for (const file of sessionFiles) {
                        if (file.endsWith('.json')) {
                            try {
                                const filePath = path.join(tempDir, file);
                                const content = fs.readFileSync(filePath, 'utf8');
                                sessionData[file] = content;
                            } catch (fileErr) {
                                console.error(`[${sessionId}] Error reading ${file}:`, fileErr.message);
                            }
                        }
                    }
                    
                    // Create session string
                    const sessionString = JSON.stringify(sessionData);
                    const sessionCode = Buffer.from(sessionString).toString('base64');
                    
                    console.log(`[${sessionId}] Session data prepared (${sessionCode.length} chars)`);
                    
                    // Send session ID to user
                    const message = {
                        text: `🔐 *DTZ NOVA XMD - Session Created*\n\n` +
                              `*📱 Your Session ID:*\n\`\`\`${sessionCode}\`\`\`\n\n` +
                              `*⚠️ IMPORTANT:*\n` +
                              `• Save this session ID safely\n` +
                              `• Never share it with anyone\n` +
                              `• Use it to restore your session\n\n` +
                              `_Generated: ${new Date().toLocaleString()}_\n` +
                              `_Session ID: ${sessionId}_`
                    };
                    
                    await sock.sendMessage(user.id, message);
                    console.log(`📨 [${sessionId}] Session ID sent to ${user.id}`);
                    
                    // Send welcome message
                    const welcomeMsg = {
                        text: `🎉 *Welcome to DTZ NOVA XMD!*\n\n` +
                              `✅ Your WhatsApp is now connected to the bot.\n\n` +
                              `*Features:*\n` +
                              `• Multi-functional bot\n` +
                              `• Web pairing system\n` +
                              `• Session management\n\n` +
                              `🔗 *Links:*\n` +
                              `• GitHub: https://github.com/alpha-x-team-ofc\n` +
                              `• Support: Contact the developer\n\n` +
                              `_Powered by ▶ ●───ᴅᴛᴢ ɴᴏᴠᴀ xᴍᴅ────▶ ●_`
                    };
                    
                    await sock.sendMessage(user.id, welcomeMsg);
                    
                    // Save session info
                    const sessionInfo = {
                        sessionId,
                        phoneNumber: user.id,
                        timestamp: new Date().toISOString(),
                        sessionCode: sessionCode.substring(0, 100) + '...'
                    };
                    
                    fs.writeFileSync(
                        path.join(tempDir, 'info.json'),
                        JSON.stringify(sessionInfo, null, 2)
                    );
                    
                } catch (error) {
                    console.error(`[${sessionId}] Error in connection handler:`, error.message);
                } finally {
                    // Close connection after 5 seconds
                    setTimeout(async () => {
                        console.log(`[${sessionId}] Closing connection...`);
                        try {
                            if (sock.ws && sock.ws.readyState === 1) {
                                sock.ws.close();
                            }
                        } catch (closeErr) {
                            console.error(`[${sessionId}] Error closing:`, closeErr.message);
                        }
                    }, 5000);
                }
            }
            
            if (connection === 'close') {
                console.log(`[${sessionId}] Connection closed`);
                const error = lastDisconnect?.error;
                if (error) {
                    console.log(`[${sessionId}] Disconnect error:`, error.output?.statusCode || error.message);
                }
                
                // Cleanup after 10 seconds
                setTimeout(() => {
                    if (activeSessions.has(sessionId)) {
                        removeFolder(tempDir);
                        activeSessions.delete(sessionId);
                        console.log(`[${sessionId}] Cleaned up`);
                    }
                }, 10000);
            }
            
            if (qr) {
                console.log(`[${sessionId}] QR generated (pairing mode active)`);
            }
        });
        
        // Request pairing code
        console.log(`[${sessionId}] Requesting pairing code for: ${phoneNumber}`);
        
        try {
            // Use a different approach for pairing code
            let pairingCode;
            
            // Try with 6-digit pairing code
            if (!sock.authState.creds.registered) {
                // First, try to register
                await delay(1000);
                
                // Get pairing code from WhatsApp
                pairingCode = await sock.requestPairingCode(phoneNumber.trim());
                
                console.log(`✅ [${sessionId}] Pairing code generated: ${pairingCode}`);
                
                // Store in active sessions
                activeSessions.set(sessionId, {
                    sock,
                    tempDir,
                    phoneNumber,
                    pairingCode,
                    timestamp: Date.now()
                });
                
                // Auto cleanup after 5 minutes
                setTimeout(() => {
                    if (activeSessions.has(sessionId)) {
                        console.log(`[${sessionId}] Session expired`);
                        sock.ws?.close();
                        removeFolder(tempDir);
                        activeSessions.delete(sessionId);
                    }
                }, 5 * 60 * 1000);
                
                // Return the pairing code to user
                return res.json({
                    success: true,
                    code: pairingCode,
                    sessionId: sessionId,
                    message: `Pairing code: ${pairingCode}`,
                    instructions: "Open WhatsApp → Settings → Linked Devices → Link a Device → Enter this code"
                });
            } else {
                return res.status(400).json({
                    error: "Already registered",
                    message: "This number is already registered. Please use logout command first."
                });
            }
            
        } catch (pairError) {
            console.error(`❌ [${sessionId}] Pairing error:`, pairError.message);
            
            // Try alternative method
            try {
                // Close existing socket
                if (sock.ws) sock.ws.close();
                
                // Remove temp directory
                removeFolder(tempDir);
                
                // Create new directory
                const newTempDir = path.join(tempBaseDir, sessionId + '_retry');
                if (!fs.existsSync(newTempDir)) {
                    fs.mkdirSync(newTempDir, { recursive: true });
                }
                
                const { state: state2, saveCreds: saveCreds2 } = await useMultiFileAuthState(newTempDir);
                
                const sock2 = makeWASocket({
                    auth: {
                        creds: state2.creds,
                        keys: makeCacheableSignalKeyStore(state2.keys, logger)
                    },
                    printQRInTerminal: false,
                    logger,
                    browser: Browsers.macOS("Safari"),
                    syncFullHistory: false,
                });
                
                sock2.ev.on('creds.update', saveCreds2);
                
                if (!sock2.authState.creds.registered) {
                    await delay(1500);
                    const pairingCode2 = await sock2.requestPairingCode(phoneNumber.trim());
                    
                    console.log(`✅ [${sessionId}] Retry successful. Pairing code: ${pairingCode2}`);
                    
                    activeSessions.set(sessionId, {
                        sock: sock2,
                        tempDir: newTempDir,
                        phoneNumber,
                        pairingCode: pairingCode2,
                        timestamp: Date.now()
                    });
                    
                    return res.json({
                        success: true,
                        code: pairingCode2,
                        sessionId: sessionId,
                        message: `Pairing code: ${pairingCode2}`
                    });
                }
                
            } catch (retryError) {
                console.error(`❌ [${sessionId}] Retry also failed:`, retryError.message);
                
                // Cleanup
                const session = activeSessions.get(sessionId);
                if (session) {
                    session.sock.ws?.close();
                    removeFolder(session.tempDir);
                    activeSessions.delete(sessionId);
                }
                
                return res.status(500).json({
                    error: "Failed to generate pairing code",
                    details: retryError.message,
                    solution: "Please try again or check if the number is valid"
                });
            }
        }
        
    } catch (error) {
        console.error(`🚨 [${sessionId}] Fatal error:`, error.message);
        
        // Cleanup
        removeFolder(tempDir);
        activeSessions.delete(sessionId);
        
        return res.status(500).json({
            error: "Internal server error",
            details: error.message
        });
    }
});

// Additional endpoint to check session status
router.get('/check/:id', (req, res) => {
    const sessionId = req.params.id;
    const session = activeSessions.get(sessionId);
    
    if (session) {
        const isConnected = session.sock && session.sock.user;
        const files = fs.existsSync(session.tempDir) ? fs.readdirSync(session.tempDir) : [];
        
        res.json({
            status: 'active',
            connected: isConnected,
            phoneNumber: session.phoneNumber,
            pairingCode: session.pairingCode,
            files: files.length,
            age: Math.floor((Date.now() - session.timestamp) / 1000) + 's'
        });
    } else {
        res.json({
            status: 'expired',
            message: 'Session not found or expired'
        });
    }
});

// Cleanup endpoint
router.get('/cleanup', (req, res) => {
    const cleaned = [];
    const now = Date.now();
    
    for (const [id, session] of activeSessions.entries()) {
        if (now - session.timestamp > 10 * 60 * 1000) { // 10 minutes
            session.sock.ws?.close();
            removeFolder(session.tempDir);
            activeSessions.delete(id);
            cleaned.push(id);
        }
    }
    
    res.json({
        cleaned: cleaned.length,
        active: activeSessions.size,
        cleanedIds: cleaned
    });
});

module.exports = router;
