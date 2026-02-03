#!/usr/bin/env python3
"""
Vecna License Manager
Runs continuously and sends heartbeat to server.
If this program is closed, the extension will stop working.
"""

import hashlib
import json
import time
import uuid
import urllib.request
import urllib.error
import ssl
import sys
import os
import threading
from datetime import datetime

# Server configuration
API_BASE = "https://visa-bypass-server.vercel.app/api/keys"
SIGN_SECRET = "vecna-sign-key"
HEARTBEAT_INTERVAL = 30  # seconds

# Global state
running = True
license_key = None
mac_address = None

def clear_screen():
    os.system('cls' if os.name == 'nt' else 'clear')

def get_mac_address():
    """Get the primary MAC address of this machine."""
    mac = uuid.getnode()
    mac_str = ':'.join(('%012X' % mac)[i:i+2] for i in range(0, 12, 2))
    return mac_str

def create_signature(key, mac, timestamp):
    """Create request signature for security."""
    data = f"{key}:{mac}:{timestamp}:{SIGN_SECRET}"
    return hashlib.sha256(data.encode()).hexdigest()[:32]

def send_heartbeat():
    """Send heartbeat to server."""
    global license_key, mac_address
    
    timestamp = int(time.time() * 1000)
    signature = create_signature(license_key, mac_address, timestamp)
    
    payload = {
        "key": license_key,
        "macAddress": mac_address,
        "timestamp": timestamp,
        "signature": signature,
        "heartbeat": True
    }
    
    data = json.dumps(payload).encode('utf-8')
    
    req = urllib.request.Request(
        f"{API_BASE}/heartbeat",
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(req, context=ctx, timeout=15) as response:
            result = json.loads(response.read().decode('utf-8'))
            return True, result
    except Exception as e:
        return False, {"error": str(e)}

def activate_license(key):
    """Activate license with MAC address binding."""
    global mac_address
    
    timestamp = int(time.time() * 1000)
    signature = create_signature(key, mac_address, timestamp)
    
    payload = {
        "key": key,
        "macAddress": mac_address,
        "timestamp": timestamp,
        "signature": signature
    }
    
    data = json.dumps(payload).encode('utf-8')
    
    req = urllib.request.Request(
        f"{API_BASE}/activate-mac",
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            return True, result
    except urllib.error.HTTPError as e:
        try:
            error_data = json.loads(e.read().decode('utf-8'))
            return False, error_data
        except:
            return False, {"error": f"HTTP Error: {e.code}"}
    except Exception as e:
        return False, {"error": str(e)}

def heartbeat_loop():
    """Background thread that sends heartbeats."""
    global running
    
    heartbeat_count = 0
    while running:
        success, result = send_heartbeat()
        heartbeat_count += 1
        
        if not success:
            print(f"\r⚠️  Heartbeat failed: {result.get('error', 'Unknown')}", end='', flush=True)
        
        # Sleep in small intervals to allow quick shutdown
        for _ in range(HEARTBEAT_INTERVAL):
            if not running:
                break
            time.sleep(1)

def print_status():
    """Print current status."""
    clear_screen()
    print("=" * 60)
    print("          VECNA LICENSE MANAGER - RUNNING")
    print("=" * 60)
    print()
    print(f"  📋 License Key:  {license_key}")
    print(f"  🖥️  MAC Address:  {mac_address}")
    print(f"  ⏱️  Heartbeat:    Every {HEARTBEAT_INTERVAL} seconds")
    print()
    print("-" * 60)
    print("  ⚠️  DO NOT CLOSE THIS WINDOW!")
    print("  The extension will stop working if you close this.")
    print("-" * 60)
    print()
    print(f"  Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    print("  Press Ctrl+C to stop and deactivate the extension.")
    print()

def main():
    global running, license_key, mac_address
    
    mac_address = get_mac_address()
    
    clear_screen()
    print("=" * 60)
    print("          VECNA LICENSE MANAGER")
    print("=" * 60)
    print()
    print(f"  Your MAC Address: {mac_address}")
    print()
    
    license_key = input("  Enter your license key: ").strip().upper()
    
    if not license_key:
        print("\n  ❌ Error: License key cannot be empty")
        input("\n  Press Enter to exit...")
        return
    
    print("\n  ⏳ Activating license...")
    
    success, result = activate_license(license_key)
    
    if not success:
        print("\n  " + "=" * 56)
        print("  ❌ ACTIVATION FAILED")
        print("  " + "=" * 56)
        error_msg = result.get('error', 'Unknown error')
        print(f"\n  🚫 Error: {error_msg}")
        input("\n  Press Enter to exit...")
        return
    
    # Activation successful - start heartbeat
    print("\n  ✅ License activated successfully!")
    print("  ⏳ Starting heartbeat service...")
    
    time.sleep(1)
    
    # Start heartbeat thread
    heartbeat_thread = threading.Thread(target=heartbeat_loop, daemon=True)
    heartbeat_thread.start()
    
    # Show status
    print_status()
    
    # Keep main thread alive
    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n  🛑 Shutting down...")
        running = False
        
        # Send final "offline" signal
        try:
            timestamp = int(time.time() * 1000)
            signature = create_signature(license_key, mac_address, timestamp)
            
            payload = {
                "key": license_key,
                "macAddress": mac_address,
                "timestamp": timestamp,
                "signature": signature,
                "offline": True
            }
            
            data = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                f"{API_BASE}/heartbeat",
                data=data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            urllib.request.urlopen(req, context=ctx, timeout=5)
            print("  ✅ Extension deactivated.")
        except:
            pass
        
        print("  Goodbye!\n")

if __name__ == "__main__":
    main()
