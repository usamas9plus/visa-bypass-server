const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const { createToken } = require('../../lib/crypto');

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { key, deviceId } = req.body;

        if (!key || !deviceId) {
            return res.status(400).json({ error: 'Missing key or deviceId' });
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

        // Check device lock
        if (keyData.deviceId && keyData.deviceId !== deviceId) {
            return res.status(403).json({
                error: 'License is already activated on another device',
                code: 'DEVICE_MISMATCH'
            });
        }

        // If no device bound yet, bind this device
        if (!keyData.deviceId) {
            await redis.hset(`key:${key}`, {
                deviceId: deviceId,
                activatedAt: Date.now().toString()
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
            expiresAt: expiresAt
        });

        return res.status(200).json({
            valid: true,
            expiresAt: expiresAt,
            daysRemaining: Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
            token: token,
            label: keyData.label || null
        });

    } catch (error) {
        console.error('Verify error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
