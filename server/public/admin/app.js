/**
 * Vecna License Admin Panel
 */

const API_BASE = '/api/keys';
let authToken = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const createKeyForm = document.getElementById('create-key-form');
const newKeyResult = document.getElementById('new-key-result');
const newKeyValue = document.getElementById('new-key-value');
const copyNewKey = document.getElementById('copy-new-key');
const refreshKeys = document.getElementById('refresh-keys');
const keysTbody = document.getElementById('keys-tbody');
const toast = document.getElementById('toast');
const settingsForm = document.getElementById('settings-form');
const inputLatestVersion = document.getElementById('latest-version');
const inputUpdateUrl = document.getElementById('update-url');
const inputLatestVersionTrial = document.getElementById('latest-version-trial');
const inputUpdateUrlTrial = document.getElementById('update-url-trial');

// Stats
const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statExpired = document.getElementById('stat-expired');
const statRevoked = document.getElementById('stat-revoked');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check for saved session
    const savedToken = sessionStorage.getItem('adminToken');
    if (savedToken) {
        authToken = savedToken;
        showDashboard();
    }
});

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;

    loginError.textContent = '';

    // Test the password by trying to list keys
    try {
        const response = await fetch(`${API_BASE}/list`, {
            headers: { 'Authorization': `Bearer ${password}` }
        });

        if (response.ok) {
            authToken = password;
            sessionStorage.setItem('adminToken', password);
            showDashboard();
        } else {
            loginError.textContent = 'Invalid password';
        }
    } catch (error) {
        loginError.textContent = 'Connection error. Please try again.';
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    authToken = null;
    sessionStorage.removeItem('adminToken');
    loginScreen.classList.remove('hidden');
    dashboardScreen.classList.add('hidden');
    document.getElementById('password').value = '';
});

// Show Dashboard
function showDashboard() {
    loginScreen.classList.add('hidden');
    dashboardScreen.classList.remove('hidden');
    dashboardScreen.classList.remove('hidden');
    loadKeys();
    loadSettings();
}

// Load Keys
async function loadKeys() {
    try {
        keysTbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';

        const response = await fetch(`${API_BASE}/list?t=${Date.now()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

        if (!response.ok) throw new Error('Failed to load keys');

        const data = await response.json();
        console.log('DEBUG: Keys Data', data.keys);

        // Update stats
        statTotal.textContent = data.stats.total;
        statActive.textContent = data.stats.active;
        statExpired.textContent = data.stats.expired;
        statRevoked.textContent = data.stats.revoked;

        // Render keys
        renderKeys(data.keys);

    } catch (error) {
        keysTbody.innerHTML = '<tr class="loading-row"><td colspan="6">Failed to load keys</td></tr>';
        showToast('Failed to load keys', 'error');
    }
}

// Helper to format relative time
function formatRelativeTime(timestamp) {
    if (!timestamp) return '-';
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
}

// Render Keys Table
function renderKeys(keys) {
    if (!keys || keys.length === 0) {
        keysTbody.innerHTML = '<tr class="loading-row"><td colspan="10">No keys found. Create your first key above!</td></tr>';
        return;
    }

    keysTbody.innerHTML = keys.map(key => {
        const expiresDate = new Date(key.expiresAt).toLocaleDateString();
        const killChecked = key.killSwitch ? 'checked' : '';
        const killClass = key.killSwitch ? 'kill-active' : '';

        // Multi-device info
        const deviceCount = key.deviceIds ? key.deviceIds.length : 0;
        const maxDevices = key.maxDevices || 1;
        const deviceLimitDisplay = `${deviceCount}/${maxDevices}`;

        // Restriction Toggle
        const restrictionChecked = !key.disableDeviceRestriction ? 'checked' : '';
        const restrictionTitle = key.disableDeviceRestriction ? 'Device restriction is DISABLED' : 'Device restriction is ACTIVE';

        // Online Status & Last Seen
        // server now calculates key.lastActiveAt for us
        const lastSeenTimestamp = key.lastActiveAt || 0;
        
        // Online if heartbeat is within 15 mins
        const isOnline = key.isOnline && (Date.now() - (key.lastHeartbeat || 0) < 15 * 60 * 1000);
        const onlineHtml = isOnline
            ? '<span class="online-dot online" title="Online: Recent App Heartbeat">●</span>'
            : '<span class="online-dot" title="Offline: No App Heartbeat">●</span>';

        const lastSeenHtml = lastSeenTimestamp > 0 
            ? formatRelativeTime(lastSeenTimestamp) 
            : '<span class="text-muted">Never Seen</span>';

        return `
            <tr class="${killClass}">
                <td>
                    <div class="key-cell">
                        <span>${key.key}</span>
                        <button class="copy-btn" onclick="copyKey('${key.key}')" title="Copy key">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>
                </td>
                <td>${key.label || '—'}</td>
                <td><span class="badge badge-${key.status}">${key.status}</span></td>
                <td>
                    <div class="device-info">
                        ${onlineHtml}
                        <input type="number" class="device-limit-input" value="${maxDevices}" min="1" max="100" 
                            onchange="updateKeyRestrictions('${key.key}', this.value, null)" title="Max Devices">
                        <span class="device-count">(${deviceCount} used)</span>
                    </div>
                </td>
                <td>
                    <label class="switch-small" title="${restrictionTitle}">
                        <input type="checkbox" ${restrictionChecked} onchange="updateKeyRestrictions('${key.key}', null, !this.checked)">
                        <span class="slider round"></span>
                    </label>
                </td>
                <td>
                    <div class="actions-cell">
                        <label class="switch-kill" title="Remote Kill">
                            <input type="checkbox" ${killChecked} onchange="toggleKill('${key.key}', this.checked)">
                            <span class="slider round"></span>
                        </label>
                        ${deviceCount > 0 ? `<button class="btn btn-ghost btn-sm" onclick="resetDevice('${key.key}')" title="Reset All Devices"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>` : ''}
                        ${key.status !== 'revoked' ? `<button class="btn btn-danger btn-sm" onclick="revokeKey('${key.key}')" title="Revoke"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></button>` : ''}
                    </div>
                </td>
                <td>${expiresDate}</td>
                <td style="font-size: 0.85em; color: #888;">${lastSeenHtml}</td>
            </tr>
        `;
    }).join('');
}

// Toggle Kill Switch
async function toggleKill(key, enabled) {
    try {
        const response = await fetch(`${API_BASE}/toggle-kill`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ key, enabled })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const validErr = errData.error;
            const statusMsg = `(${response.status} ${response.statusText})`;
            throw new Error(validErr || `Failed to toggle kill switch ${statusMsg}`);
        }

        const data = await response.json();
        if (data.success) {
            showToast(enabled ? 'Kill Switch ACTIVATED' : 'Kill Switch deactivated', enabled ? 'error' : 'success');

            // Manual optimistic update - find checkbox and update row class
            const checkbox = document.querySelector(`input[onchange="toggleKill('${key}', this.checked)"]`);
            if (checkbox) {
                const tr = checkbox.closest('tr');
                if (enabled) {
                    tr.classList.add('kill-active');
                } else {
                    tr.classList.remove('kill-active');
                }
            }
        }

    } catch (error) {
        showToast(error.message || 'Failed to toggle kill switch', 'error');
        // Revert checkbox state via reload ONLY on error
        loadKeys();
    }
}

// Update Key Device Restrictions
async function updateKeyRestrictions(key, maxDevices, disableDeviceRestriction) {
    try {
        const body = { key };
        if (maxDevices !== null) body.maxDevices = maxDevices;
        if (disableDeviceRestriction !== null) body.disableDeviceRestriction = disableDeviceRestriction;

        const response = await fetch(`${API_BASE}/update-restrictions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) throw new Error('Failed to update restrictions');

        showToast('Restrictions updated', 'success');
        // loadKeys(); // Optional: Full reload or let user see change
    } catch (error) {
        showToast(error.message || 'Failed to update restrictions', 'error');
        loadKeys();
    }
}

// Load Settings
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        if (response.ok) {
            const data = await response.json();
            inputLatestVersion.value = data.latestVersion || '';
            inputUpdateUrl.value = data.updateUrl || '';
            inputLatestVersionTrial.value = data.latestVersion_trial || '';
            inputUpdateUrlTrial.value = data.updateUrl_trial || '';
        }
    } catch (error) {
        console.error('Failed to load settings', error);
    }
}

// Save Settings
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                latestVersion: inputLatestVersion.value,
                updateUrl: inputUpdateUrl.value,
                latestVersion_trial: inputLatestVersionTrial.value,
                updateUrl_trial: inputUpdateUrlTrial.value
            })
        });

        if (!response.ok) throw new Error('Failed to save settings');

        showToast('Settings saved successfully', 'success');

    } catch (error) {
        showToast('Failed to save settings', 'error');
    }
});

// Create Key
createKeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const label = document.getElementById('key-label').value;
    const days = parseInt(document.getElementById('key-days').value) || 30;
    const maxDevices = parseInt(document.getElementById('key-max-devices').value) || 1;

    try {
        const response = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ label, expiresInDays: days, maxDevices })
        });

        if (!response.ok) throw new Error('Failed to create key');

        const data = await response.json();

        // Show new key
        newKeyValue.textContent = data.key;
        newKeyResult.classList.remove('hidden');

        // Clear form
        document.getElementById('key-label').value = '';

        // Reload keys
        loadKeys();

        showToast('Key created successfully!', 'success');

    } catch (error) {
        showToast('Failed to create key', 'error');
    }
});

// Copy new key
copyNewKey.addEventListener('click', () => {
    copyKey(newKeyValue.textContent);
});

// Copy key to clipboard
function copyKey(key) {
    navigator.clipboard.writeText(key).then(() => {
        showToast('Key copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

// Revoke Key
async function revokeKey(key) {
    if (!confirm(`Are you sure you want to revoke this key?\n\n${key}`)) return;

    try {
        const response = await fetch(`${API_BASE}/revoke`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ key })
        });

        if (!response.ok) throw new Error('Failed to revoke key');

        loadKeys();
        showToast('Key revoked successfully', 'success');

    } catch (error) {
        showToast('Failed to revoke key', 'error');
    }
}

// Reset Device
async function resetDevice(key) {
    if (!confirm(`Reset device binding for this key?\n\n${key}\n\nThis will allow the key to be activated on a new device.`)) return;

    try {
        const response = await fetch(`${API_BASE}/reset-device`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ key })
        });

        if (!response.ok) throw new Error('Failed to reset device');

        loadKeys();
        showToast('Device binding reset successfully', 'success');

    } catch (error) {
        showToast('Failed to reset device', 'error');
    }
}

// Refresh Keys
refreshKeys.addEventListener('click', () => {
    loadKeys();
});

// Toast Notification
function showToast(message, type = 'success') {
    toast.textContent = message;
    toast.className = `toast ${type}`;

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}
