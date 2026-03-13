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

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Check admin auth
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { key, maxDevices, disableDeviceRestriction } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'Missing key' });
        }

        const updateData = {};
        if (maxDevices !== undefined) updateData.maxDevices = String(maxDevices);
        if (disableDeviceRestriction !== undefined) updateData.disableDeviceRestriction = String(disableDeviceRestriction);

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No update data provided' });
        }

        await redis.hset(`key:${key}`, updateData);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Update restrictions error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
