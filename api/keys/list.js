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
        let debugSample = null;

        // Helper for robust numeric conversion
        const toNum = (val) => {
            if (val === null || val === undefined || val === '') return 0;
            const n = parseInt(val);
            return isNaN(n) ? 0 : n;
        };

        // Sequential fetching (More robust for now, ruling out pipeline)
        for (const key of allKeys) {
            const keyData = await redis.hgetall(`key:${key}`);
            
            if (keyData && (keyData.key || keyData.createdAt)) {
                // Determine current status
                const expiresAt = toNum(keyData.expiresAt);
                const isExpired = expiresAt > 0 && expiresAt < now;
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

                // Consolidated Activity Tracking
                const lastActiveAt = Math.max(
                    toNum(keyData.lastHeartbeat),
                    toNum(keyData.lastUsed),
                    toNum(keyData.lastMacCheck),
                    toNum(keyData.macActivatedAt),
                    toNum(keyData.activatedAt),
                    toNum(keyData.createdAt)
                );

                const k = {
                    key: keyData.key || key,
                    label: keyData.label || '',
                    status: status,
                    deviceId: keyData.deviceId || null,
                    createdAt: toNum(keyData.createdAt),
                    expiresAt: expiresAt,
                    expiresInDays: toNum(keyData.expiresInDays),
                    killSwitch: String(keyData.killSwitch) === 'true',
                    autoBanEnabled: String(keyData.autoBanEnabled) !== 'false',
                    maxDevices: toNum(keyData.maxDevices) || 1,
                    deviceIds: keyData.deviceIds ? keyData.deviceIds.split(',') : [],
                    lastHeartbeat: toNum(keyData.lastHeartbeat),
                    lastActiveAt: lastActiveAt,
                    isOnline: String(keyData.isOnline) === 'true'
                };

                keys.push(k);

                // Capture one debug sample for the UI to show why Last Seen might be 0
                if (!debugSample && lastActiveAt > 0) {
                    debugSample = { raw: keyData, processed: k };
                }
            }
        }

        // Sort by creation date (newest first)
        keys.sort((a, b) => b.createdAt - a.createdAt);

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        return res.status(200).json({
            version: "1.1.0",
            keys: keys,
            stats: {
                total: keys.length,
                active: active,
                expired: expired,
                revoked: revoked
            },
            _debug_sample: debugSample
        });

    } catch (error) {
        console.error('List error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
