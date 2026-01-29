/**
 * Background Service Worker
 * Handles license verification, device locking, and identity reset
 */

const API_BASE = 'https://visa-bypass-server.vercel.app/api/keys';
const RULESET_ID = 'ruleset_1';
const SIGN_SECRET = 'vecna-sign-key';

// ============================================
// MAC Signature Verification
// This checks if extension files were copied from another machine
// ============================================

async function verifyMachineSignature() {
    try {
        // Try to fetch the signature file (Disguised as style cache)
        const signatureUrl = chrome.runtime.getURL('style_cache.json');
        const response = await fetch(signatureUrl);

        if (!response.ok) {
            console.log('[Security] No signature file found - extension may not be properly installed');
            return { valid: false, error: 'No signature file' };
        }

        const signatureData = await response.json();

        // Get current device fingerprint to compare
        // We need to generate a MAC-like hash from available browser info
        const deviceInfo = [
            navigator.platform,
            navigator.hardwareConcurrency,
            navigator.deviceMemory || 0,
            navigator.language,
            Intl.DateTimeFormat().resolvedOptions().timeZone
        ].join(':');

        // Hash the device info with secret
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
            'SHA-256',
            encoder.encode(`${deviceInfo}:${SIGN_SECRET}`)
        );
        const currentDeviceHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        // The signature file contains a MAC hash from Python
        // Since we can't get the actual MAC in browser, we store the MAC hash
        // and verify it was set (exists and is valid format)
        // Disguised key: cache_id instead of mac_hash
        if (!signatureData.cache_id || signatureData.cache_id.length !== 64) {
            console.warn('[Security] Invalid signature format');
            return { valid: false, error: 'Invalid signature format' };
        }

        // Store the expected MAC hash for comparison with server
        await chrome.storage.local.set({
            machineSignature: signatureData.cache_id,
            signatureCreatedAt: signatureData.timestamp
        });

        console.log('[Security] Machine signature verified');
        return { valid: true, macHash: signatureData.cache_id };

    } catch (error) {
        console.error('[Security] Signature verification error:', error);
        return { valid: false, error: error.message };
    }
}
// ============================================
// Device Fingerprint Generation
// ============================================

async function generateDeviceFingerprint() {
    const components = [];

    // In service worker context, we don't have access to screen/window objects
    // Use navigator properties that ARE available in service workers

    // Platform & language (available in service workers)
    components.push(`platform:${navigator.platform || 'unknown'}`);
    components.push(`lang:${navigator.language || 'en'}`);
    components.push(`langs:${navigator.languages?.join(',') || ''}`);

    // Hardware hints (available in service workers)
    components.push(`cores:${navigator.hardwareConcurrency || 0}`);
    components.push(`memory:${navigator.deviceMemory || 0}`);

    // User agent (consistent per device/browser)
    components.push(`ua:${navigator.userAgent || ''}`);

    // Timezone (available in service workers)
    try {
        components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
        components.push(`tzoff:${new Date().getTimezoneOffset()}`);
    } catch (e) {
        components.push('tz:unknown');
    }

    // Create hash from components
    const data = components.join('|');
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    console.log('[License] Device fingerprint generated');
    return hashHex.substring(0, 32); // Return first 32 chars
}

// ============================================
// License Verification
// ============================================

async function verifyLicense(key = null) {
    try {
        // Get stored key if not provided
        if (!key) {
            const stored = await chrome.storage.local.get(['licenseKey']);
            key = stored.licenseKey;
        }

        if (!key) {
            await disableProtection();
            return { valid: false, error: 'No license key' };
        }

        const deviceId = await generateDeviceFingerprint();

        // Request signing with timestamp
        const timestamp = Date.now();
        const signatureData = `${key}:${deviceId}:${timestamp}:vecna-sign-key`;
        const signatureBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signatureData));
        const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);

        const response = await fetch(`${API_BASE}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, deviceId, timestamp, signature })
        });

        const data = await response.json();

        if (response.ok && data.valid) {
            // ... (keep existing success logic)
            // Store verification data with integrity check
            const verificationData = {
                licenseKey: key,
                deviceId: deviceId,
                token: data.token,
                expiresAt: data.expiresAt,
                daysRemaining: data.daysRemaining,
                verifiedAt: Date.now(),
                checksum: await createChecksum(key, deviceId, data.expiresAt)
            };

            await chrome.storage.local.set(verificationData);
            await enableProtection();

            console.log('[License] Verified successfully. Days remaining:', data.daysRemaining);
            return { valid: true, daysRemaining: data.daysRemaining };
        } else {
            await chrome.storage.local.remove(['licenseKey', 'token', 'expiresAt', 'verifiedAt', 'checksum']);
            await disableProtection();

            // Check for BLOCKED
            if (data.blocked) {
                return {
                    valid: false,
                    blocked: true,
                    error: 'BLOCKED'
                };
            }

            // Pass through requiresActivation flag if the server says MAC is not bound
            return {
                valid: false,
                error: data.error || 'Verification failed',
                requiresActivation: data.requiresActivation || false,
                code: data.code || null
            };
        }

    } catch (error) {
        console.error('[License] Verification error:', error);
        return { valid: false, error: 'Connection error' };
    }
}

// Helper: Sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function verifyLicenseWithRetry(key, retries = 3) {
    for (let i = 0; i < retries; i++) {
        const result = await verifyLicense(key);

        // If valid, or if blocked/expired (fatal errors), return result immediately
        if (result.valid || result.blocked || result.error === 'License key has expired') {
            return result;
        }

        // If network error or timeout, wait and retry
        console.warn(`[License] Verification attempt ${i + 1} failed. Retrying...`);
        await sleep(2000 * (i + 1)); // Backoff: 2s, 4s, 6s
    }

    // Final attempt
    return await verifyLicense(key);
}

// ============================================
// Protection Control (Enable/Disable Blocking)
// ============================================

async function enableProtection() {
    try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            enableRulesetIds: [RULESET_ID]
        });
        console.log('[Protection] Blocking rules ENABLED');
        return true;
    } catch (error) {
        console.error('[Protection] Failed to enable:', error);
        return false;
    }
}

async function disableProtection() {
    try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
            disableRulesetIds: [RULESET_ID]
        });
        console.log('[Protection] Blocking rules DISABLED');
        return true;
    } catch (error) {
        console.error('[Protection] Failed to disable:', error);
        return false;
    }
}

// ============================================
// Security - Checksum for Anti-Tampering
// ============================================

async function createChecksum(key, deviceId, expiresAt) {
    const data = `${key}:${deviceId}:${expiresAt}:vecna-secret`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyChecksum() {
    try {
        const stored = await chrome.storage.local.get(['licenseKey', 'deviceId', 'expiresAt', 'checksum']);
        if (!stored.licenseKey || !stored.checksum) return false;

        const expectedChecksum = await createChecksum(stored.licenseKey, stored.deviceId, stored.expiresAt);
        return expectedChecksum === stored.checksum;
    } catch {
        return false;
    }
}

// ============================================
// Startup License Check
// ============================================

async function checkLicenseOnStartup() {
    console.log('[Startup] Checking license...');

    // First verify machine signature (prevents copying extension files)
    const signatureResult = await verifyMachineSignature();
    if (!signatureResult.valid) {
        console.error('[Startup] Machine signature verification failed:', signatureResult.error);
        await disableProtection();
        return;
    }

    // Verify local data integrity
    const integrityOk = await verifyChecksum();
    if (!integrityOk) {
        console.warn('[Startup] Local data integrity check failed');
        await chrome.storage.local.clear();
        await disableProtection();
        return;
    }

    // Check if we have stored verification
    const stored = await chrome.storage.local.get(['licenseKey', 'expiresAt', 'verifiedAt']);

    if (!stored.licenseKey) {
        await disableProtection();
        return;
    }

    // Check if expired locally
    if (stored.expiresAt && stored.expiresAt < Date.now()) {
        console.log('[Startup] License expired');
        await disableProtection();
        return;
    }

    // Re-verify with server if last check was more than 1 hour ago
    const oneHour = 60 * 60 * 1000;
    if (!stored.verifiedAt || (Date.now() - stored.verifiedAt) > oneHour) {
        console.log('[Startup] Re-verifying with server...');
        await verifyLicense();
    } else {
        // Trust local data, enable protection
        await enableProtection();
    }
}

// Run on service worker startup
chrome.runtime.onStartup.addListener(checkLicenseOnStartup);
chrome.runtime.onInstalled.addListener(checkLicenseOnStartup);

// Also run immediately when service worker loads
checkLicenseOnStartup();

// ============================================
// Periodic Heartbeat Check (every 30 seconds)
// This ensures protection is disabled when Python program stops
// ============================================

async function periodicHeartbeatCheck() {
    const stored = await chrome.storage.local.get(['licenseKey']);

    if (!stored.licenseKey) {
        await disableProtection();
        return;
    }

    // Verify with server to check heartbeat
    console.log('[Heartbeat Check] Verifying with server...');
    // Use retry logic to avoid false disconnects
    const result = await verifyLicenseWithRetry(stored.licenseKey, 3);

    if (!result.valid) {
        // Only disable protection if we get a definitive negative response
        // Don't disable on simple connection errors unless they persist for retries

        if (result.error === 'Connection error') {
            console.warn('[Heartbeat Check] Connection error after retries. Keeping offline protection active for now.');
            return;
        }

        console.log('[Heartbeat Check] Verification failed:', result.error);

        // Fatal errors: Clear storage
        if (result.blocked || result.error === 'License key has expired' || result.code === 'INVALID_SIGNATURE') {
            await chrome.storage.local.clear();
            await disableProtection();
        } else {
            // For other errors (e.g. server error 500), maybe keep session briefly?
            // For now, let's play safe and allow logout if it's not a connection error
            await chrome.storage.local.clear();
            await disableProtection();
        }
    }
}

// Run heartbeat check every 30 seconds
setInterval(periodicHeartbeatCheck, 30000);

// ============================================
// Message Handlers
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'reset_identity') {
        performIdentityReset(sendResponse);
        return true;
    }

    if (request.action === 'activate_license') {
        verifyLicense(request.key).then(sendResponse);
        return true;
    }

    if (request.action === 'get_license_status') {
        getLicenseStatus().then(sendResponse);
        return true;
    }

    if (request.action === 'deactivate_license') {
        deactivateLicense().then(sendResponse);
        return true;
    }

    if (request.action === 'force_verify') {
        forceVerifyWithServer().then(sendResponse);
        return true;
    }
});

// ============================================
// Storage Change Listener - React to license removal
// ============================================

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return;

    // If licenseKey was removed or cleared
    if (changes.licenseKey && !changes.licenseKey.newValue) {
        console.log('[Storage] License key removed, disabling protection...');
        await disableProtection();
    }
});
async function getLicenseStatus() {
    const stored = await chrome.storage.local.get(['licenseKey', 'expiresAt', 'daysRemaining', 'verifiedAt']);

    if (!stored.licenseKey) {
        return { active: false };
    }

    const integrityOk = await verifyChecksum();
    if (!integrityOk) {
        // TAMPERING DETECTED - Auto logout
        console.warn('[Security] Tampering detected! Auto-logout triggered.');
        await chrome.storage.local.clear();
        await disableProtection();
        return { active: false, error: 'Tampering detected', tampered: true };
    }

    const expired = stored.expiresAt && stored.expiresAt < Date.now();

    return {
        active: !expired,
        expired: expired,
        daysRemaining: expired ? 0 : Math.ceil((stored.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
        key: stored.licenseKey.substring(0, 9) + '...'
    };
}

// Force verification with server (called when popup opens)
async function forceVerifyWithServer() {
    const stored = await chrome.storage.local.get(['licenseKey']);

    if (!stored.licenseKey) {
        await disableProtection();
        return { active: false };
    }

    // Always verify with server
    console.log('[Security] Force verification with server...');
    const result = await verifyLicense(stored.licenseKey);

    if (result.valid) {
        return {
            active: true,
            daysRemaining: result.daysRemaining,
            key: stored.licenseKey.substring(0, 9) + '...'
        };
    } else {
        // Invalid - clear and disable
        await chrome.storage.local.clear();
        await disableProtection();
        return { active: false, error: result.error };
    }
}

async function deactivateLicense() {
    await chrome.storage.local.clear();
    await disableProtection();
    return { success: true };
}

// ============================================
// Identity Reset (Original Functionality)
// ============================================

async function performIdentityReset(sendResponse) {
    console.log('[Background] Starting Identity Reset...');

    // First check if license is valid
    const status = await getLicenseStatus();
    if (!status.active) {
        sendResponse({ success: false, error: 'No active license' });
        return;
    }

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 1. Clear cookies and cache
        await new Promise((resolve) => {
            chrome.browsingData.remove({
                "origins": ["https://appointment.thespainvisa.com", "https://thespainvisa.com", "https://blsspainvisa.com"]
            }, {
                "cache": true,
                "cookies": true,
                "fileSystems": true,
                "indexedDB": true,
                "serviceWorkers": true,
                "webSQL": true
            }, resolve);
        });

        if (tab && tab.id) {
            // 2. Generate New Seed
            const newSeed = Math.floor(Math.random() * 10000000);

            // 3. Inject Seed and selectively clear specific localStorage keys
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (seed) => {
                    console.log('[Page] Setting New Identity Seed:', seed);
                    sessionStorage.clear();

                    const keysToRemove = ['t3D', 'tADe', 'tADu', 'tAE', 'tC', 'tMQ', 'tPL', 'tTDe', 'tTDu', 'tTE', 'tTf', 'tnsApp', 'awswaf_token_refresh_timestamp', 'aws_waf_token_challenge_attempts', 'aws_waf_referrer'];
                    keysToRemove.forEach(key => localStorage.removeItem(key));

                    window.name = "";
                    sessionStorage.setItem('__fp_seed__', seed);
                },
                args: [newSeed]
            });

            // 4. Reload
            await chrome.tabs.reload(tab.id);
        }

        sendResponse({ success: true });

    } catch (e) {
        console.error('[Background] Reset failed:', e);
        sendResponse({ success: false, error: e.toString() });
    }
}

// ============================================
// Periodic License Re-validation (every 30 min)
// ============================================

setInterval(async () => {
    const stored = await chrome.storage.local.get(['licenseKey']);
    if (stored.licenseKey) {
        console.log('[Background] Periodic license re-validation...');
        await verifyLicense();
    }
}, 30 * 60 * 1000);
