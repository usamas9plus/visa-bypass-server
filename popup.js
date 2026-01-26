
/**
 * Popup Logic
 * Handles license activation and identity reset
 */

// DOM Elements

// --- ANTI-TAMPER SECURITY START ---
(function protectUI() {
    document.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('keydown', function (e) {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
            (e.ctrlKey && e.key === 'U')
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });
    setInterval(() => {
        const start = performance.now();
        debugger;
        const end = performance.now();
        if (end - start > 100) {
            document.body.innerHTML = "<h1>Security Violation</h1>";
        }
    }, 1000);
})();
// --- ANTI-TAMPER SECURITY END ---
const licenseSection = document.getElementById('license-section');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const daysRemaining = document.getElementById('days-remaining');
const activationForm = document.getElementById('activation-form');
const activeState = document.getElementById('active-state');
const licenseKeyInput = document.getElementById('license-key');
const activateBtn = document.getElementById('activate-btn');
const deactivateBtn = document.getElementById('deactivate-btn');
const keyDisplay = document.getElementById('key-display');
const resetBtn = document.getElementById('resetBtn');
const status = document.getElementById('status');
const warning = document.getElementById('warning');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Force verify with server every time popup opens
    forceVerifyLicense();
});

// Force Verify License with Server
async function forceVerifyLicense() {
    // Show loading state
    statusText.textContent = 'Verifying...';
    statusIndicator.classList.remove('active', 'inactive');

    try {
        const response = await chrome.runtime.sendMessage({ action: 'force_verify' });

        // Check for tampering alert
        if (response.tampered) {
            alert('⚠️ Security Alert: Tampering detected! License has been deactivated.');
        }

        updateUI(response);
    } catch (error) {
        console.error('Failed to verify license:', error);
        updateUI({ active: false, error: 'Connection error' });
    }
}

// Update UI based on license status
function updateUI(licenseStatus) {
    // Check for BLOCKED state
    if (licenseStatus.blocked) {
        licenseSection.classList.remove('license-active', 'license-inactive');
        licenseSection.classList.add('license-blocked'); // Add blocked style class if needed
        statusIndicator.className = 'status-indicator inactive';

        statusText.className = 'status-text inactive';
        statusText.style.color = '#ef4444'; // Red
        statusText.style.fontWeight = '800';
        statusText.textContent = 'BLOCKED'; // Display BLOCKED

        daysRemaining.textContent = '';
        keyDisplay.textContent = 'ACCESS DENIED';

        activationForm.style.display = 'none';
        activeState.style.display = 'block';
        resetBtn.disabled = true;
        warning.style.display = 'block';
        warning.innerHTML = '⛔ <b>ACCESS BLOCKED BY ADMINISTRATOR</b>';
        return;
    }

    if (licenseStatus.active) {
        // Active state
        licenseSection.classList.remove('license-inactive');
        licenseSection.classList.add('license-active');
        statusIndicator.classList.remove('inactive');
        statusIndicator.classList.add('active');
        statusText.classList.remove('inactive');
        statusText.classList.add('active');
        statusText.style.color = ''; // Reset color
        statusText.textContent = 'Active';

        daysRemaining.textContent = `${licenseStatus.daysRemaining} days left`;
        keyDisplay.textContent = licenseStatus.key;

        activationForm.style.display = 'none';
        activeState.style.display = 'block';

        resetBtn.disabled = false;
        warning.style.display = 'none';
    } else {
        // Inactive state
        licenseSection.classList.remove('license-active');
        licenseSection.classList.add('license-inactive');
        statusIndicator.classList.remove('active');
        statusIndicator.classList.add('inactive');
        statusText.classList.remove('active');
        statusText.classList.add('inactive');
        statusText.style.color = ''; // Reset color
        statusText.textContent = licenseStatus.expired ? 'Expired' : 'Not Activated';

        daysRemaining.textContent = '';

        activationForm.style.display = 'block';
        activeState.style.display = 'none';

        resetBtn.disabled = true;
        warning.style.display = 'block';
    }
}

// Activate License
activateBtn.addEventListener('click', async () => {
    const key = licenseKeyInput.value.trim();

    if (!key) {
        showStatus('Please enter a license key', 'error');
        return;
    }

    activateBtn.disabled = true;
    activateBtn.textContent = '...';

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'activate_license',
            key: key
        });

        if (response.valid) {
            showStatus('License activated!', 'success');
            licenseKeyInput.value = '';
            forceVerifyLicense();
        } else {
            // Check for specific error codes
            if (response.requiresActivation || response.error?.includes('activation program')) {
                showStatus('Run activate_license.py first!', 'error');
                warning.innerHTML = '⚠️ You must run <b>activate_license.py</b> on this PC before using the extension.';
            } else {
                showStatus(response.error || 'Activation failed', 'error');
            }
        }
    } catch (error) {
        showStatus('Connection error', 'error');
    }

    activateBtn.disabled = false;
    activateBtn.textContent = 'Activate';
});

// Allow Enter key to activate
licenseKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        activateBtn.click();
    }
});

// Deactivate License
deactivateBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to deactivate this license?')) {
        return;
    }

    try {
        await chrome.runtime.sendMessage({ action: 'deactivate_license' });
        showStatus('License deactivated', 'success');
        forceVerifyLicense();
    } catch (error) {
        showStatus('Failed to deactivate', 'error');
    }
});

// Reset Identity
resetBtn.addEventListener('click', async () => {
    status.textContent = 'Cleaning...';
    status.className = 'status-msg';

    try {
        const response = await chrome.runtime.sendMessage({ action: 'reset_identity' });

        if (response && response.success) {
            showStatus('Bypass Applied!', 'success');
            setTimeout(() => {
                status.textContent = 'Ready';
                status.className = 'status-msg';
            }, 2000);
        } else {
            showStatus(response?.error || 'Error!', 'error');
        }
    } catch (error) {
        showStatus('Error!', 'error');
    }
});

// Show status message
function showStatus(message, type = '') {
    status.textContent = message;
    status.className = `status-msg ${type}`;
}
