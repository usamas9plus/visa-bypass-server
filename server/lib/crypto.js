const crypto = require('crypto');

const SECRET = process.env.TOKEN_SECRET || 'vecna-bypass-secret-key-2024';

/**
 * Generate a random license key
 */
function generateKey() {
    const segments = [];
    for (let i = 0; i < 4; i++) {
        segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
    }
    return segments.join('-');
}

/**
 * Create a signed verification token
 */
function createToken(keyData) {
    const payload = {
        key: keyData.key,
        deviceId: keyData.deviceId,
        exp: keyData.expiresAt,
        iat: Date.now()
    };
    const data = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
    return Buffer.from(JSON.stringify({ data: payload, sig: signature })).toString('base64');
}

/**
 * Verify a token's signature
 */
function verifyToken(token) {
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const expectedSig = crypto.createHmac('sha256', SECRET).update(JSON.stringify(decoded.data)).digest('hex');
        if (expectedSig !== decoded.sig) return null;
        if (decoded.data.exp < Date.now()) return null;
        return decoded.data;
    } catch {
        return null;
    }
}

module.exports = { generateKey, createToken, verifyToken };
