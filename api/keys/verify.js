const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const { createToken } = require('../../lib/crypto');

// Signing secret (should match extension)
const SIGN_SECRET = 'vecna-sign-key';

// Heartbeat must be within this many milliseconds to be considered "online"
const HEARTBEAT_TIMEOUT = 60000; // 60 seconds

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
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
            return res.status(404).json({ error: 'Invalid license key' });
        }

        // Check if revoked
        if (keyData.revoked === 'true') {
            return res.status(403).json({ error: 'License key has been revoked' });
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
        const lastHeartbeat = parseInt(keyData.lastHeartbeat) || 0;
        const heartbeatAge = Date.now() - lastHeartbeat;

        if (heartbeatAge > HEARTBEAT_TIMEOUT || keyData.isOnline === 'false') {
            return res.status(403).json({
                error: 'License manager not running. Start the activation program.',
                code: 'HEARTBEAT_TIMEOUT',
                requiresActivation: true
            });
        }

        // ============================================
        // DEVICE FINGERPRINT CHECK
        // ============================================
        if (keyData.deviceId && keyData.deviceId !== deviceId) {
            return res.status(403).json({
                error: 'License is already activated on another browser/device',
                code: 'DEVICE_MISMATCH'
            });
        }

        // If no device bound yet, bind this device
        if (!keyData.deviceId) {
            await redis.hset(`key:${key}`, {
                deviceId: deviceId,
                deviceActivatedAt: Date.now().toString()
            });
            keyData.deviceId = deviceId;
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
