const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

// Signing secret (should match Python program)
const SIGN_SECRET = 'vecna-sign-key';

// Telegram Config
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;

async function sendTelegramAlert(text, screenshot = null) {
    try {
        if (screenshot) {
            const imageBuffer = Buffer.from(screenshot, 'base64');
            const formData = new FormData();
            formData.append('chat_id', TG_CHAT_ID);
            formData.append('caption', text);
            formData.append('parse_mode', 'Markdown');
            
            const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
            formData.append('photo', blob, 'screenshot.jpg');

            await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
                method: 'POST',
                body: formData
            });
        } else {
            await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TG_CHAT_ID,
                    text: text,
                    parse_mode: 'Markdown'
                })
            });
        }
    } catch (e) {
        console.error('TG Alert Error:', e);
    }
}

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
        const { key, macAddress, timestamp, signature, checkOnly, screenshot } = req.body;

        if (!key || !macAddress) {
            return res.status(400).json({ error: 'Missing key or macAddress' });
        }

        // Verify request signature
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
                .update(`${key}:${macAddress}:${timestamp}:${SIGN_SECRET}`)
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
            await sendTelegramAlert(`❌ *INVALID ACTIVATION ATTEMPT*\n\n🔑 *Key:* \`${key}\`\n🕒 *Time:* \`${time}\`\n💻 *MAC:* \`${macAddress || 'Unknown'}\`\n⚠️ *Reason:* Key does not exist in database.`, screenshot);
            return res.status(404).json({ error: 'Invalid license key', code: 'KEY_NOT_FOUND' });
        }

        // Check if revoked
        if (keyData.revoked === 'true') {
            return res.status(403).json({ error: 'License key has been revoked', code: 'KEY_REVOKED' });
        }

        // Check KILL SWITCH
        if (String(keyData.killSwitch) === 'true') {
            return res.status(200).json({
                valid: false,
                kill: true,
                error: 'Security violation detected',
                code: 'ORDER_66'
            });
        }

        // Check expiry
        const expiresAt = parseInt(keyData.expiresAt);
        if (expiresAt < Date.now()) {
            return res.status(403).json({ error: 'License key has expired', code: 'KEY_EXPIRED' });
        }

        // ============================================
        // MAC ADDRESS CHECK (Multi-device support)
        // ============================================
        const deviceRestrictionDisabled = String(keyData.disableDeviceRestriction) === 'true';
        const maxDevices = parseInt(keyData.maxDevices) || 1;
        const macAddresses = keyData.macAddresses ? keyData.macAddresses.split(',') : (keyData.macAddress ? [keyData.macAddress] : []);

        if (!deviceRestrictionDisabled) {
            // Check if current MAC is already authorized
            if (!macAddresses.includes(macAddress)) {
                // Not authorized. Check if we can add a new device
                if (macAddresses.length >= maxDevices) {
                    return res.status(409).json({
                        error: `License limit reached (${maxDevices} computer${maxDevices > 1 ? 's' : ''}).`,
                        code: 'MAC_MISMATCH'
                    });
                }

                // Authorized: add to the list
                macAddresses.push(macAddress);
                await redis.hset(`key:${key}`, {
                    macAddresses: macAddresses.join(','),
                    // Backwards compatibility
                    macAddress: macAddresses[0],
                    macActivatedAt: Date.now().toString()
                });
            }
        } else {
            // Restriction disabled - if first time, still set the main macAddress for compatibility
            if (!keyData.macAddress && !checkOnly) {
                await redis.hset(`key:${key}`, {
                    macAddress: macAddress,
                    macActivatedAt: Date.now().toString()
                });
            }
        }

        // Update last used
        await redis.hset(`key:${key}`, {
            lastMacCheck: Date.now().toString()
        });

        // Success Alert
        const time = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
        await sendTelegramAlert(`✅ *SUCCESSFUL ACTIVATION/LOGIN*\n\n🔑 *Key:* \`${key}\`\n🕒 *Time:* \`${time}\`\n💻 *MAC:* \`${macAddress || 'Unknown'}\`\n👤 *Note:* \`${keyData.note || 'None'}\``, screenshot);

        return res.status(200).json({
            valid: true,
            macBound: true,
            expiresAt: expiresAt,
            daysRemaining: Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
            label: keyData.label || null
        });

    } catch (error) {
        console.error('Activate MAC error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
