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
        const { key, enabled, type } = req.body; // type can be 'autoBan' or 'kill'

        if (!key) {
            return res.status(400).json({ error: 'Missing key' });
        }

        // Check if key exists
        const exists = await redis.exists(`key:${key}`);
        if (!exists) {
            return res.status(404).json({ error: 'Key not found' });
        }

        const val = enabled ? 'true' : 'false';
        const updates = {};

        if (type === 'autoBan') {
            updates.autoBanEnabled = val;
            // "When it is turned off the remote kill should be turned off"
            if (!enabled) {
                updates.killSwitch = 'false';
            }
        } else {
            // Default to 'kill' for backward compatibility
            updates.killSwitch = val;
            // "and vice versa" -> if kill is turned OFF, turn OFF auto-ban? 
            // Or if kill is turned ON, turn ON auto-ban?
            // "when [auto-ban] is turned off the remote kill should be turned off and vice versa"
            // Vice versa = when [remote kill] is turned off, [auto-ban] should be turned off.
            if (!enabled) {
                updates.autoBanEnabled = 'false';
            } else {
                // Also turn ON auto-ban if we are manually killing?
                updates.autoBanEnabled = 'true';
            }
        }

        await redis.hset(`key:${key}`, updates);

        // Verify write
        const verified = await redis.hgetall(`key:${key}`);

        return res.status(200).json({ 
            success: true, 
            autoBanEnabled: String(verified.autoBanEnabled) === 'true', 
            killSwitch: String(verified.killSwitch) === 'true' 
        });

    } catch (error) {
        console.error('Toggle kill error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
};
