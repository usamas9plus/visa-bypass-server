// Vecna License Admin - Dashboard Logic v1.1.0
// Renamed to dashboard_v2.js to break aggessive browser cache

const API_BASE = '/api/keys';
let ADMIN_PASSWORD = '';

// Auth Check
function checkAuth() {
    const password = localStorage.getItem('admin_password');
    if (!password) {
        showScreen('login-screen');
        return false;
    }
    ADMIN_PASSWORD = password;
    showScreen('dashboard-screen');
    loadKeys();
    return true;
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// Login
document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const password = document.getElementById('password').value;
    localStorage.setItem('admin_password', password);
    if (checkAuth()) {
        document.getElementById('password').value = '';
    }
};

// Logout
document.getElementById('logout-btn').onclick = () => {
    localStorage.removeItem('admin_password');
    location.reload();
};

// Load Keys
async function loadKeys() {
    const keysTbody = document.getElementById('keys-tbody');
    const statTotal = document.getElementById('stat-total');
    const statActive = document.getElementById('stat-active');
    const statExpired = document.getElementById('stat-expired');
    const statRevoked = document.getElementById('stat-revoked');

    try {
        const response = await fetch(`${API_BASE}/list?t=${Date.now()}`, {
            headers: { 'Authorization': `Bearer ${ADMIN_PASSWORD}` }
        });

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('admin_password');
                showScreen('login-screen');
                return;
            }
            throw new Error('Failed to load keys');
        }

        const data = await response.json();
        
        // DEBUG: LOG DATA TO CONSOLE FOR TRACING
        console.warn('DEBUG: V1.1.0 DATA RECEIVED', data);
        if (data._debug_sample) {
            console.log('DEBUG: RAW KEY SAMPLE', data._debug_sample);
        }

        statTotal.textContent = data.stats.total;
        statActive.textContent = data.stats.active;
        statExpired.textContent = data.stats.expired;
        statRevoked.textContent = data.stats.revoked || 0;

        if (!data.keys || data.keys.length === 0) {
            keysTbody.innerHTML = '<tr class="loading-row"><td colspan="10">No keys found.</td></tr>';
            return;
        }

        keysTbody.innerHTML = data.keys.map(key => renderKeyRow(key)).join('');

    } catch (error) {
        console.error('Load error:', error);
        showToast(error.message, 'error');
    }
}

function renderKeyRow(key) {
    const expiresDate = new Date(key.expiresAt).toLocaleDateString();
    const isKill = key.killSwitch;
    const killChecked = isKill ? 'checked' : '';
    const killClass = isKill ? 'key-killed' : '';
    
    const deviceCount = key.deviceIds ? key.deviceIds.length : 0;
    const maxDevices = key.maxDevices || 1;
    
    const lastSeenTimestamp = key.lastActiveAt || 0;
    const isOnline = key.isOnline && (Date.now() - (key.lastHeartbeat || 0) < 15 * 60 * 1000);
    
    const onlineHtml = isOnline
        ? '<span class="online-dot online" title="Status: ONLINE (App Heartbeat Active)">●</span>'
        : '<span class="online-dot" title="Status: OFFLINE (No Heartbeat)">●</span>';

    const lastSeenHtml = lastSeenTimestamp > 0 
        ? formatRelativeTime(lastSeenTimestamp) 
        : '<span class="text-muted">Never Seen</span>';

    const restrictionChecked = !key.disableDeviceRestriction ? 'checked' : '';

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
                <label class="switch-small">
                    <input type="checkbox" ${restrictionChecked} onchange="updateKeyRestrictions('${key.key}', null, !this.checked)">
                    <span class="slider round"></span>
                </label>
            </td>
            <td>
                <label class="switch-kill" title="Auto-Ban Settings">
                    <input type="checkbox" ${key.autoBanEnabled ? 'checked' : ''} onchange="toggleKill('${key.key}', this.checked, 'autoBan')">
                    <span class="slider round"></span>
                </label>
            </td>
            <td>
                <div class="actions-cell">
                    <label class="switch-kill" title="Manual Remote Kill">
                        <input type="checkbox" ${killChecked} onchange="toggleKill('${key.key}', this.checked, 'kill')">
                        <span class="slider round"></span>
                    </label>
                    ${deviceCount > 0 ? `<button class="btn btn-ghost btn-sm" onclick="resetDevice('${key.key}')" title="Reset All Devices"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></button>` : ''}
                    ${isOnline ? `<button class="btn btn-ghost btn-sm" style="color: #22C55E;" onclick="requestScreenshot('${key.key}')" title="Take Remote Screenshot"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg></button>` : ''}
                    ${key.status !== 'revoked' ? `<button class="btn btn-danger btn-sm" onclick="revokeKey('${key.key}')" title="Revoke"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></button>` : ''}
                </div>
            </td>
            <td>${expiresDate}</td>
            <td style="font-size: 0.85em; color: #888;">${lastSeenHtml}</td>
        </tr>
    `;
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

// Global functions for inline handlers
window.copyKey = (key) => {
    navigator.clipboard.writeText(key);
    showToast('Key copied to clipboard');
};

window.toggleKill = async (key, active, type = 'kill') => {
    try {
        const response = await fetch(`${API_BASE}/toggle-kill`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_PASSWORD}`
            },
            body: JSON.stringify({ key, enabled: active, type })
        });
        if (!response.ok) throw new Error('Action failed');
        loadKeys();
        
        const label = type === 'autoBan' ? 'Auto-Ban' : 'Remote Kill';
        showToast(`${label} ${active ? 'ENABLED' : 'DISABLED'}`);
    } catch (error) {
        showToast(error.message, 'error');
        loadKeys(); // Revert UI
    }
}

window.revokeKey = async (key) => {
    if (!confirm('Are you sure you want to PERMANENTLY revoke this key?')) return;
    try {
        const response = await fetch(`${API_BASE}/revoke`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_PASSWORD}`
            },
            body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error('Revoke failed');
        loadKeys();
        showToast('Key revoked successfully');
    } catch (error) {
        showToast(error.message, 'error');
    }
};

window.updateKeyRestrictions = async (key, maxDevices, disableRestriction) => {
    try {
        const payload = { key };
        if (maxDevices !== null) payload.maxDevices = parseInt(maxDevices);
        if (disableRestriction !== null) payload.disableDeviceRestriction = disableRestriction;

        const response = await fetch(`${API_BASE}/update-restrictions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_PASSWORD}`
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Update failed');
        loadKeys();
        showToast('Restrictions updated');
    } catch (error) {
        showToast(error.message, 'error');
    }
};

window.resetDevice = async (key) => {
    if (!confirm('Clear all device registrations for this key?')) return;
    try {
        const response = await fetch(`${API_BASE}/reset-device`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_PASSWORD}`
            },
            body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error('Reset failed');
        loadKeys();
        showToast('Devices reset successfully');
    } catch (error) {
        showToast(error.message, 'error');
    }
};

window.requestScreenshot = async (key) => {
    try {
        const response = await fetch(`${API_BASE}/request-screenshot`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_PASSWORD}`
            },
            body: JSON.stringify({ key })
        });
        if (!response.ok) throw new Error('Request failed');
        showToast('Screenshot requested! Wait for Telegram alert.');
    } catch (error) {
        showToast(error.message, 'error');
    }
};

// Toast
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast visible ${type}`;
    setTimeout(() => {
        toast.className = 'toast hidden';
    }, 3000);
}

// Initial Check
document.addEventListener('DOMContentLoaded', () => {
    console.warn('VECNA DASHBOARD v1.1.0 STARTING...');
    checkAuth();
});

// Refresh button
document.getElementById('refresh-keys').onclick = () => loadKeys();
