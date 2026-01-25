const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Check admin auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get all keys from index
        const allKeys = await redis.smembers('keys:all');

        if (!allKeys || allKeys.length === 0) {
            return res.status(200).json({ keys: [], stats: { total: 0, active: 0, expired: 0, revoked: 0 } });
        }

        const keys = [];
        let active = 0, expired = 0, revoked = 0;
        const now = Date.now();

        for (const key of allKeys) {
            const keyData = await redis.hgetall(`key:${key}`);
            if (keyData && keyData.key) {
                const expiresAt = parseInt(keyData.expiresAt);
                const isExpired = expiresAt < now;
                const isRevoked = keyData.revoked === 'true';

                let status = 'active';
                if (isRevoked) {
                    status = 'revoked';
                    revoked++;
                } else if (isExpired) {
                    status = 'expired';
                    expired++;
                } else {
                    active++;
                }

                keys.push({
                    key: keyData.key,
                    label: keyData.label || '',
                    status: status,
                    deviceId: keyData.deviceId || null,
                    createdAt: parseInt(keyData.createdAt),
                    expiresAt: expiresAt,
                    expiresInDays: parseInt(keyData.expiresInDays),
                    killSwitch: keyData.killSwitch === 'true',
                    activatedAt: keyData.activatedAt ? parseInt(keyData.activatedAt) : null,
                    lastUsed: keyData.lastUsed ? parseInt(keyData.lastUsed) : null
                });
            }
        }

        // Sort by creation date (newest first)
        keys.sort((a, b) => b.createdAt - a.createdAt);

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json({
            keys: keys,
            stats: {
                total: keys.length,
                active: active,
                expired: expired,
                revoked: revoked
            }
        });

    } catch (error) {
        console.error('List error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
