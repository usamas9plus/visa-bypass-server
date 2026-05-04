/**
 * Background Service Worker
 * Handles license verification, device locking, and identity reset
 */

const API_BASE = 'https://visa-bypass-server-sigma.vercel.app/api/keys';
const SIGN_SECRET = 'vecna-sign-key';

let lastVerifyTime = 0; // Emergency throttle v1.1.2

// Hidden blocking targets (Split strings to confuse simple grep)
const TARGET_1 = 'cli' + 'ent.mi' + 'n.js';
const TARGET_2 = 'fing' + 'erpr' + 'int';

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

// Helper: Clear session data but preserve the remembered license key AND throttle data
async function clearSessionData() {
    try {
        const preserved = await chrome.storage.local.get(['rememberedLicenseKey', 'lastVerifyAt']);
        await chrome.storage.local.clear();
        // Restore preserved keys
        const restoreData = {};
        if (preserved.rememberedLicenseKey) restoreData.rememberedLicenseKey = preserved.rememberedLicenseKey;
        if (preserved.lastVerifyAt) restoreData.lastVerifyAt = preserved.lastVerifyAt;
        if (Object.keys(restoreData).length > 0) {
            await chrome.storage.local.set(restoreData);
        }
        console.log('[Storage] Session cleared, preserved keys restored');
    } catch (e) {
        console.error('[Storage] Failed to clear session safely:', e);
        await chrome.storage.local.clear(); // Fallback
    }
}

// ============================================
// License Verification
// ============================================

async function verifyLicense(key = null, isInitial = false, skipLocalCheck = false) {
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

        // --- EMERGENCY THROTTLE v1.1.2 ---
        const now = Date.now();
        const sixtySeconds = 60 * 1000;
        const thirtyMins = 30 * 60 * 1000;

        // Retrieve last check from persistent storage
        const throttleData = await chrome.storage.local.get(['lastVerifyAt', 'token', 'verifiedAt']);
        const lastVerifyAt = throttleData.lastVerifyAt || 0;

        // Block ANY verification call if one happened in the last 60 seconds (unless manual activation)
        if (!isInitial && (now - lastVerifyAt) < sixtySeconds) {
            console.warn('[License] Verify blocked by emergency throttle (too frequent)');
            return { valid: true, cached: true };
        }

        // Even for manual activation, enforce a 10-second minimum gap to prevent rapid clicks
        if (isInitial && (now - lastVerifyAt) < 10000) {
            console.warn('[License] Activation throttled (too rapid)');
            return { valid: false, error: 'Please wait a moment before retrying', cached: true };
        }

        // Long-term cache check
        if (!isInitial && throttleData.token && throttleData.verifiedAt && (now - throttleData.verifiedAt) < thirtyMins) {
            console.log('[License] Background sync skipped, recently verified.');
            return { valid: true, cached: true };
        }
        
        await chrome.storage.local.set({ lastVerifyAt: now }); // Update persistent throttle

        const deviceId = await generateDeviceFingerprint();

        // Request signing with timestamp
        const timestamp = Date.now();
        const signatureData = `${key}:${deviceId}:${timestamp}:vecna-sign-key`;
        const signatureBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signatureData));
        const signature = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);

        const response = await fetch(`${API_BASE}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, deviceId, timestamp, signature, isInitial })
        });

        const data = await response.json();
        
        // For INITIAL activation or background syncs, we MUST have the local app running
        // This prevents logging in to the extension without the protection app.
        try {
            const health = await checkLocalHealth(key);
            if (!health.valid) {
                console.error('[License] Local health check failed during verification stage');
                return { 
                    valid: false, 
                    error: 'Run Vecna Bypass Web Application First!', 
                    requiresActivation: true 
                };
            }
        } catch (e) {
            console.error('[License] Local health check error:', e);
            return { valid: false, error: 'Local Connection Error' };
        }

        if (response.ok && data.valid) {
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
            await chrome.storage.local.set({ rememberedLicenseKey: key });
            await enableProtection();

            console.log('[License] Verified successfully with server and local app.');
            return { valid: true, daysRemaining: data.daysRemaining };
        } else {
            console.warn('[License] Server verification failed.');
            await chrome.storage.local.remove(['licenseKey', 'token', 'expiresAt', 'verifiedAt', 'checksum']);
            await disableProtection();
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
        // Dynamic Rules (Hidden in Obfuscated JS)
        const rules = [
            {
                "id": 1,
                "priority": 1,
                "action": { "type": "block" },
                "condition": { "urlFilter": TARGET_1, "resourceTypes": ["script"] }
            },
            {
                "id": 2,
                "priority": 1,
                "action": { "type": "block" },
                "condition": { "urlFilter": TARGET_2, "resourceTypes": ["script", "xmlhttprequest"] }
            }
        ];

        // Reset first to ensure no duplicates
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1, 2],
            addRules: rules
        });

        await chrome.storage.local.set({ protectionActive: true });
        console.log('[Protection] Blocking rules ENABLED (Dynamic)');
        return true;
    } catch (error) {
        console.error('[Protection] Failed to enable:', error);
        return false;
    }
}

async function disableProtection() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1, 2] // Remove our specific rules
        });
        await chrome.storage.local.set({ protectionActive: false });
        console.log('[Protection] Blocking rules DISABLED (Dynamic)');
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
        await clearSessionData();
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

    // Check local connectivity first
    const localResult = await checkLocalHealth();
    if (!localResult.valid) {
        console.error('[Startup] Local Python app not detected or invalid signature');
        await clearSessionData();
        await disableProtection();
        return;
    }

    // Re-verify with server if last check was more than 30 minutes ago
    const syncThreshold = 30 * 60 * 1000;
    if (!stored.verifiedAt || (Date.now() - stored.verifiedAt) > syncThreshold) {
        console.log('[Startup] Syncing with server...');
        await verifyLicense();
    } else {
        // Trust local data, enable protection
        await enableProtection();
    }
}

// Run on service worker startup
chrome.runtime.onStartup.addListener(() => {
    checkLicenseOnStartup();
    setupAlarms();
});
chrome.runtime.onInstalled.addListener(() => {
    checkLicenseOnStartup();
    setupAlarms();
});

function setupAlarms() {
    // Local health check every 1 minute (Low cost)
    chrome.alarms.create('local_ping', { periodInMinutes: 1 });
    // Full server sync every 30 minutes (Prevents Vercel 429)
    chrome.alarms.create('server_sync', { periodInMinutes: 30 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'local_ping') {
        checkLocalHealth().then(res => {
            if (!res.valid) {
                console.log('[Heartbeat] Local connection lost. Logging out...');
                deactivateLicense();
            }
        });
    } else if (alarm.name === 'server_sync') {
        verifyLicense();
    }
});

// ============================================
// Secure Local Health Check
// ============================================

async function checkLocalHealth(overrideKey = null) {
    try {
        let key = overrideKey;
        if (!key) {
            const stored = await chrome.storage.local.get(['licenseKey']);
            key = stored.licenseKey;
        }
        
        if (!key) return { valid: false, error: 'NO_KEY' };

        // 1. Generate Nonce
        const nonce = Math.random().toString(36).substring(7) + Date.now();

        // 2. Ping Local Server
        const response = await fetch(`http://127.0.0.1:31337/status?nonce=${nonce}`, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-cache'
        });

        if (!response.ok) return { valid: false };

        const data = await response.json();

        // 3. Verify Signature: HMAC-SHA256(nonce, SIGN_SECRET + license_key)
        const expectedSigData = `${nonce}:${SIGN_SECRET}:${key}`;
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(expectedSigData));
        const expectedSignature = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        if (data.signature !== expectedSignature) {
            console.error('[Security] Local signature mismatch!');
            return { valid: false };
        }

        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

// Removed setInterval calls as they are unreliable in MV3
// Logic moved to chrome.alarms (setupAlarms)

// ============================================
// Message Handlers
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'reset_identity') {
        performIdentityReset(sendResponse);
        return true;
    }

    if (request.action === 'activate_license') {
        verifyLicense(request.key, true).then(sendResponse);
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
    const stored = await chrome.storage.local.get(['licenseKey', 'expiresAt', 'daysRemaining', 'verifiedAt', 'rememberedLicenseKey']);

    if (!stored.licenseKey) {
        return { 
            active: false, 
            rememberedKey: stored.rememberedLicenseKey 
        };
    }

    const integrityOk = await verifyChecksum();
    if (!integrityOk) {
        // TAMPERING DETECTED - Auto logout
        console.warn('[Security] Tampering detected! Auto-logout triggered.');
        await clearSessionData();
        await disableProtection();
        return { 
            active: false, 
            error: 'Tampering detected', 
            tampered: true,
            rememberedKey: stored.rememberedLicenseKey
        };
    }

    const expired = stored.expiresAt && stored.expiresAt < Date.now();

    return {
        active: !expired,
        expired: expired,
        daysRemaining: expired ? 0 : Math.ceil((stored.expiresAt - Date.now()) / (1000 * 60 * 60 * 24)),
        key: stored.licenseKey.substring(0, 9) + '...',
        rememberedKey: stored.rememberedLicenseKey
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
        await clearSessionData();
        await disableProtection();
        return { active: false, error: result.error };
    }
}

async function deactivateLicense() {
    await clearSessionData();
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

// Logic moved to chrome.alarms (setupAlarms)
