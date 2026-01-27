const { Redis } = require('@upstash/redis');

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            // Public endpoint to get settings
            const settings = await redis.hgetall('vecna:settings');
            return res.status(200).json(settings || {});
        }

        if (req.method === 'POST') {
            // Admin-only endpoint to update settings
            const authHeader = req.headers.authorization;
            if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { latestVersion, updateUrl } = req.body;

            await redis.hset('vecna:settings', {
                latestVersion: latestVersion || '1.0.0',
                updateUrl: updateUrl || ''
            });

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        console.error('Settings error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
