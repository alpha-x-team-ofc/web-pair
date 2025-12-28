const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { 
    default: makeWASocket, 
    useMultiFileAuthState,
    delay 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const router = express.Router();
const SESSION_DIR = path.join(__dirname, 'sessions');

// Store active connections
const activeConnections = new Map();

// Clean old sessions
async function cleanupOldSessions() {
    const files = await fs.readdir(SESSION_DIR);
    const now = Date.now();
    
    for (const file of files) {
        const filePath = path.join(SESSION_DIR, file);
        const stat = await fs.stat(filePath);
        const age = now - stat.mtimeMs;
        
        // Delete sessions older than 1 hour
        if (age > 3600000) {
            await fs.remove(filePath);
            console.log(`Cleaned up old session: ${file}`);
        }
    }
}

// Main pairing endpoint
router.post('/start', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }
    
    // Clean the number
    const cleanNumber = number.replace(/\D/g, '');
    
    if (cleanNumber.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }
    
    const sessionId = 'session_' + Date.now();
    const sessionPath = path.join(SESSION_DIR, sessionId);
    
    try {
        // Ensure session directory exists
        await fs.ensureDir(sessionPath);
        
        // Initialize WhatsApp connection
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: state.keys,
            },
            printQRInTerminal: false,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            logger: { level: 'silent' }
        });
        
        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);
        
        let pairingCode = null;
        let isConnected = false;
        
        // Handle connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            console.log(`[${sessionId}] Connection:`, connection);
            
            if (qr) {
                console.log(`[${sessionId}] QR Code generated`);
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'open') {
                console.log(`✅ [${sessionId}] WhatsApp Connected!`);
                isConnected = true;
                
                // Send welcome message with session info
                try {
                    await delay(2000);
                    
                    // Get session files
                    const files = await fs.readdir(sessionPath);
                    const sessionFiles = [];
                    
                    for (const file of files) {
                        if (file.endsWith('.json')) {
                            const content = await fs.readFile(
                                path.join(sessionPath, file), 
                                'utf8'
                            );
                            sessionFiles.push({
                                file,
                                content: JSON.parse(content)
                            });
                        }
                    }
                    
                    // Create session data
                    const sessionData = Buffer.from(
                        JSON.stringify(sessionFiles)
                    ).toString('base64');
                    
                    // Send session to user
                    const message = `🔐 *DTZ NOVA XMD Session Created*\n\n` +
                                   `*Session ID:* \`${sessionId}\`\n` +
                                   `*Session Data:* \`${sessionData.substring(0, 50)}...\`\n\n` +
                                   `✅ Save this information to restore your session.\n` +
                                   `⚠️ Never share this with anyone.\n\n` +
                                   `_Powered by DTZ NOVA XMD_`;
                    
                    await sock.sendMessage(sock.user.id, { text: message });
                    console.log(`📨 [${sessionId}] Session sent to user`);
                    
                    // Close connection after sending
                    await delay(3000);
                    sock.ws.close();
                    
                } catch (sendError) {
                    console.error(`[${sessionId}] Error sending session:`, sendError.message);
                }
            }
            
            if (connection === 'close') {
                console.log(`[${sessionId}] Connection closed`);
                
                // Cleanup after 10 seconds
                setTimeout(async () => {
                    try {
                        await fs.remove(sessionPath);
                        activeConnections.delete(sessionId);
                        console.log(`[${sessionId}] Cleaned up`);
                    } catch (cleanError) {
                        console.error(`[${sessionId}] Cleanup error:`, cleanError.message);
                    }
                }, 10000);
            }
        });
        
        // Request pairing code
        if (!sock.authState.creds.registered) {
            await delay(1000);
            
            try {
                pairingCode = await sock.requestPairingCode(cleanNumber);
                console.log(`[${sessionId}] Pairing code for ${cleanNumber}: ${pairingCode}`);
                
                // Store connection
                activeConnections.set(sessionId, {
                    sock,
                    sessionPath,
                    number: cleanNumber,
                    pairingCode,
                    timestamp: Date.now()
                });
                
                // Auto cleanup after 10 minutes
                setTimeout(() => {
                    const conn = activeConnections.get(sessionId);
                    if (conn && !isConnected) {
                        conn.sock.ws.close();
                        fs.remove(conn.sessionPath).catch(() => {});
                        activeConnections.delete(sessionId);
                        console.log(`[${sessionId}] Session expired`);
                    }
                }, 10 * 60 * 1000);
                
                return res.json({
                    success: true,
                    sessionId,
                    pairingCode,
                    message: 'Pairing code generated successfully',
                    instructions: [
                        '1. Open WhatsApp on your phone',
                        '2. Go to Settings → Linked Devices',
                        '3. Tap "Link a Device"',
                        '4. Enter this 6-digit code'
                    ]
                });
                
            } catch (pairError) {
                console.error(`[${sessionId}] Pairing error:`, pairError.message);
                
                // Try with different format
                try {
                    const formattedNumber = cleanNumber.startsWith('94') ? 
                        cleanNumber : `94${cleanNumber}`;
                    
                    pairingCode = await sock.requestPairingCode(formattedNumber);
                    console.log(`[${sessionId}] Retry successful: ${pairingCode}`);
                    
                    activeConnections.set(sessionId, {
                        sock,
                        sessionPath,
                        number: formattedNumber,
                        pairingCode,
                        timestamp: Date.now()
                    });
                    
                    return res.json({
                        success: true,
                        sessionId,
                        pairingCode,
                        message: 'Pairing code generated'
                    });
                    
                } catch (retryError) {
                    await fs.remove(sessionPath);
                    sock.ws.close();
                    
                    return res.status(500).json({
                        error: 'Failed to generate pairing code',
                        details: retryError.message,
                        suggestion: 'Make sure the number has WhatsApp and try again'
                    });
                }
            }
        }
        
    } catch (error) {
        console.error(`[ERROR] Setup failed:`, error.message);
        await fs.remove(sessionPath).catch(() => {});
        
        return res.status(500).json({
            error: 'Setup failed',
            details: error.message
        });
    }
});

// Check session status
router.get('/status/:id', async (req, res) => {
    const { id } = req.params;
    const sessionPath = path.join(SESSION_DIR, id);
    
    try {
        const exists = await fs.pathExists(sessionPath);
        
        if (!exists) {
            return res.json({ status: 'not_found' });
        }
        
        const files = await fs.readdir(sessionPath);
        const hasCreds = files.some(f => f.includes('creds'));
        
        const connection = activeConnections.get(id);
        const isConnected = connection?.sock?.user?.id;
        
        return res.json({
            status: 'active',
            connected: !!isConnected,
            hasCredentials: hasCreds,
            files: files.length,
            exists: exists
        });
        
    } catch (error) {
        return res.json({ 
            status: 'error',
            error: error.message 
        });
    }
});

// Cleanup endpoint
router.get('/cleanup', async (req, res) => {
    try {
        await cleanupOldSessions();
        res.json({ 
            success: true, 
            message: 'Cleanup completed' 
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Cleanup failed', 
            details: error.message 
        });
    }
});

module.exports = router;
