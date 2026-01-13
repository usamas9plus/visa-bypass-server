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
    loadKeys();
}

// Load Keys
async function loadKeys() {
    try {
        keysTbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading...</td></tr>';

        const response = await fetch(`${API_BASE}/list`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (!response.ok) throw new Error('Failed to load keys');

        const data = await response.json();

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

// Render Keys Table
function renderKeys(keys) {
    if (!keys || keys.length === 0) {
        keysTbody.innerHTML = '<tr class="loading-row"><td colspan="6">No keys found. Create your first key above!</td></tr>';
        return;
    }

    keysTbody.innerHTML = keys.map(key => {
        const expiresDate = new Date(key.expiresAt).toLocaleDateString();
        const deviceDisplay = key.deviceId ? key.deviceId.substring(0, 12) + '...' : 'Not activated';
        const deviceClass = key.deviceId ? 'bound' : '';

        return `
            <tr>
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
                <td><span class="device-cell ${deviceClass}" title="${key.deviceId || ''}">${deviceDisplay}</span></td>
                <td>${expiresDate}</td>
                <td>
                    <div class="actions-cell">
                        ${key.deviceId ? `<button class="btn btn-ghost btn-sm" onclick="resetDevice('${key.key}')">Reset Device</button>` : ''}
                        ${key.status !== 'revoked' ? `<button class="btn btn-danger btn-sm" onclick="revokeKey('${key.key}')">Revoke</button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Create Key
createKeyForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const label = document.getElementById('key-label').value;
    const days = parseInt(document.getElementById('key-days').value) || 30;

    try {
        const response = await fetch(`${API_BASE}/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ label, expiresInDays: days })
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
