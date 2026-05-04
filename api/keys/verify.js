const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const { createToken } = require('../../lib/crypto');

// Signing secret (should match extension)
const SIGN_SECRET = 'vecna-sign-key';

// Telegram Config
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegramAlert(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error('TG Alert Error:', e);
    }
}

// Heartbeat must be within this many milliseconds to be considered "online"
// Heartbeat must be within this many milliseconds to be considered "online"
const HEARTBEAT_TIMEOUT = 300000; // 15 minutes (900 seconds)

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key, deviceId, timestamp, signature } = req.body;

        if (!key || !deviceId) {
            return res.status(400).json({ error: 'Missing key or deviceId' });
        }

        // Verify request signature (prevents replay attacks)
        if (timestamp && signature) {
            const now = Date.now();
            const requestAge = now - timestamp;

            // Reject requests older than 5 minutes
            if (requestAge > 5 * 60 * 1000 || requestAge < -60000) {
                return res.status(403).json({ error: 'Request expired', code: 'EXPIRED_REQUEST' });
            }

            // Verify signature
            const expectedSignature = crypto
                .createHash('sha256')
                .update(`${key}:${deviceId}:${timestamp}:${SIGN_SECRET}`)
                .digest('hex')
                .substring(0, 32);

            if (signature !== expectedSignature) {
                return res.status(403).json({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' });
            }
        }

        // Lookup key in Redis
        const keyData = await redis.hgetall(`key:${key}`);

        if (!keyData || !keyData.key) {
            const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
            await sendTelegramAlert(`❌ *INVALID LOGIN ATTEMPT*\n\n🔑 *Key:* \`${key}\`\n🕒 *Time:* \`${time}\`\n💻 *Device:* \`${deviceId || 'Unknown'}\`\n⚠️ *Reason:* Key does not exist in database.`);
            return res.status(404).json({ error: 'Invalid license key' });
        }

        // Check if revoked
        if (keyData.revoked === 'true') {
            return res.status(403).json({ error: 'License key has been revoked' });
        }

        // 3. Kill Switch Check (Only if auto-ban enforcement is enabled)
        const autoBanEnabled = String(keyData.autoBanEnabled) !== 'false';
        if (autoBanEnabled && String(keyData.killSwitch) === 'true') {
            return res.status(200).json({
                success: true,
                valid: false,
                kill: true,
                message: 'Device has been permanently blocked.'
            });
        }

        // Check expiry
        const expiresAt = parseInt(keyData.expiresAt);
        if (expiresAt < Date.now()) {
            return res.status(403).json({ error: 'License key has expired' });
        }

        // ============================================
        // MAC ADDRESS CHECK - Must be activated via Python first
        // ============================================
        if (!keyData.macAddress) {
            return res.status(403).json({
                error: 'License not activated. Run the activation program first.',
                code: 'MAC_NOT_BOUND',
                requiresActivation: true
            });
        }

        // ============================================
        // HEARTBEAT CHECK - Python program must be running
        // ============================================

        // ============================================
        // DEVICE FINGERPRINT CHECK (Multi-device support)
        // ============================================
        const deviceRestrictionDisabled = String(keyData.disableDeviceRestriction) === 'true';
        const maxDevices = parseInt(keyData.maxDevices) || 1;
        const deviceIds = keyData.deviceIds ? keyData.deviceIds.split(',') : (keyData.deviceId ? [keyData.deviceId] : []);

        if (!deviceRestrictionDisabled) {
            // Check if current device is already authorized
            if (!deviceIds.includes(deviceId)) {
                // Not authorized. Check if we can add a new device
                if (deviceIds.length >= maxDevices) {
                    return res.status(409).json({
                        error: `License limit reached (${maxDevices} device${maxDevices > 1 ? 's' : ''}).`,
                        code: 'DEVICE_MISMATCH'
                    });
                }

                // Authorized: add to the list
                deviceIds.push(deviceId);
                await redis.hset(`key:${key}`, {
                    deviceIds: deviceIds.join(','),
                    // Backwards compatibility for old list view/logic if needed
                    deviceId: deviceIds[0] 
                });
            }
        }

        // ============================================
        // HEARTBEAT CHECK - Python program must be running
        // ============================================
        const { isInitial } = req.body;
        const lastHeartbeat = parseInt(keyData.lastHeartbeat) || 0;
        const heartbeatAge = Date.now() - lastHeartbeat;

        // Two-tiered timeout:
        // 1. Initial Login/Activation: Must have a heartbeat within 90 seconds (Strict)
        // 2. Background Re-verification: Can have a heartbeat within 15 minutes (Lenient)
        const STRICT_TIMEOUT = 300000; // 90 seconds
        const effectiveTimeout = isInitial ? STRICT_TIMEOUT : HEARTBEAT_TIMEOUT;

        if (heartbeatAge > effectiveTimeout || keyData.isOnline === 'false') {
            const errorMsg = isInitial 
                ? 'License manager not running. Start the activation program before logging in.'
                : 'License manager connection lost. Start the activation program.';
                
            return res.status(403).json({
                error: errorMsg,
                code: 'HEARTBEAT_TIMEOUT',
                requiresActivation: true
            });
        }



        // Initial device binding handled above in multi-device logic
        if (!keyData.deviceId && deviceIds.length > 0) {
            // Migration for keys that had neither deviceId nor deviceIds
            await redis.hset(`key:${key}`, {
                deviceId: deviceIds[0],
                deviceActivatedAt: Date.now().toString()
            });
            keyData.deviceId = deviceIds[0];
        }

        // Update last used
        await redis.hset(`key:${key}`, {
            lastUsed: Date.now().toString()
        });

        // Generate verification token
        const token = createToken({
            key: key,
            deviceId: deviceId,
            macAddress: keyData.macAddress,
            expiresAt: expiresAt
        });

        // Success Alert
        const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
        await sendTelegramAlert(`✅ *SUCCESSFUL LOGIN*\n\n🔑 *Key:* \`${key}\`\n🕒 *Time:* \`${time}\`\n💻 *MAC:* \`${keyData.macAddress || 'Unknown'}\`\n👤 *Note:* \`${keyData.note || 'None'}\``);

        return res.status(200).json({
            valid: true,
            expiresAt: expiresAt,
            daysRemaining: Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
            token: token,
            label: keyData.label || null,
            macBound: true
        });

    } catch (error) {
        console.error('Verify error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
