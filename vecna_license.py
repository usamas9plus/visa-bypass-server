#!/usr/bin/env python3
"""
Vecna License Manager - Premium Edition
High-end GUI with frameless window and glassmorphism effects
"""

import os
import io
import sys
import json
import time
import base64
import zipfile
import hashlib
import uuid
import urllib.request
import urllib.error
import ssl
import threading
import ctypes
import webbrowser
import traceback
import shutil
from datetime import datetime
from pathlib import Path

# Install libraries
try:
    import customtkinter as ctk
    from tkinter import filedialog, messagebox, Canvas
    from PIL import Image, ImageTk
    import pystray
    import psutil
except ImportError:
    os.system(f"{sys.executable} -m pip install customtkinter pillow pystray psutil")
    import customtkinter as ctk
    from tkinter import filedialog, messagebox, Canvas
    from PIL import Image, ImageTk
    import pystray
    import psutil

# ============================================
# Configuration
# ============================================

API_BASE = "https://visa-bypass-server.vercel.app/api/keys"
API_SETTINGS = "https://visa-bypass-server.vercel.app/api/settings"
APP_VERSION = "1.0.2"
SIGN_SECRET = "vecna-sign-key"
ENCRYPTION_KEY = "vecna-extension-secret-key-2024"
HEARTBEAT_INTERVAL = 600
# Config path in AppData to ensure it's writable
if os.name == 'nt':
    app_data = os.getenv('APPDATA')
    if not app_data:
        app_data = os.path.expanduser("~")
    CONFIG_DIR = Path(app_data) / "VecnaBypass"
    CONFIG_DIR.mkdir(exist_ok=True)
    CONFIG_FILE = CONFIG_DIR / ".vecna_config.json"
else:
    CONFIG_FILE = Path(__file__).parent / ".vecna_config.json"

# ============================================
# Extension Data
# ============================================

try:
    from extension_data import ENCRYPTED_EXTENSION_DATA, EXTENSION_HASH
    HAS_EXTENSION_DATA = True
except ImportError:
    ENCRYPTED_EXTENSION_DATA = None
    EXTENSION_HASH = None
    HAS_EXTENSION_DATA = False

# ============================================
# Icons (Base64)
# ============================================

ICON_EMAIL_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR4nO3TIQ4AMAxCUej978zcxDK7VfQ/WQMJqQQAmM7nIUmeh9o71z+Db0VKzYoCmj6Bu98QAIAFjhwMDjJd4EcAAAAASUVORK5CYII="
ICON_TELEGRAM_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZElEQVR4nO3SQQ6AIAxE0Y7x/leucUFisBIF6kL/O8DMpGAGAPg7ZYa7uzfLJa3ZJVMu4IMlYbGk04CMolb5bhkJOQZ159hN5TqltPda9Wi9+uGCi+lpSD0iCr0aOuPJAADfswERTCQRoraMtwAAAABJRU5ErkJggg=="
ICON_WHATSAPP_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAcklEQVR4nO2SwQrAMAhDzdj//7I7DYrUqq2wHfLOJkaJCCGEkI9BVaCqGpoCaV90LEwtckIhu7RyVcUHK9E4fBrK6l/tlVk+o/oRb/6uGIwBZ2G9K5e+YsiaZMsZhUNkvlO+thJ2st0BGGH19YQQQn7PAwatSB4wYpAxAAAAAElFTkSuQmCC"

def load_icon(b64_data):
    try:
        return ctk.CTkImage(
            light_image=Image.open(io.BytesIO(base64.b64decode(b64_data))),
            dark_image=Image.open(io.BytesIO(base64.b64decode(b64_data))),
            size=(24, 24)
        )
    except Exception as e:
        print(f"Icon load fail: {e}")
        return None

def get_mac_address():
    mac = uuid.getnode()
    return ':'.join(('%012X' % mac)[i:i+2] for i in range(0, 12, 2))

def create_signature(key, mac, timestamp):
    data = f"{key}:{mac}:{timestamp}:{SIGN_SECRET}"
    return hashlib.sha256(data.encode()).hexdigest()[:32]

def xor_decrypt(data: bytes, key: str) -> bytes:
    key_bytes = (key * ((len(data) // len(key)) + 1))[:len(data)].encode()
    return bytes(a ^ b for a, b in zip(data, key_bytes))

def load_config():
    try:
        if CONFIG_FILE.exists():
            with open(CONFIG_FILE, 'r') as f: return json.load(f)
    except: pass
    return {}

def save_config(config):
    try:
        with open(CONFIG_FILE, 'w') as f: json.dump(config, f)
    except: pass

def activate_license(key, mac_address):
    timestamp = int(time.time() * 1000)
    signature = create_signature(key, mac_address, timestamp)
    
    payload = {
        "key": key,
        "macAddress": mac_address,
        "timestamp": timestamp,
        "signature": signature
    }
    
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            f"{API_BASE}/activate-mac",
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
            # CHECK FOR KILL SIGNAL
            if res_data.get('kill') is True:
                trigger_defense()
                
            return True, res_data
            
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, {"error": "Invalid License Key"}
        elif e.code == 403:
            # Read body to see if it's expired specifically
            try:
                err_body = json.loads(e.read().decode('utf-8'))
                if "expired" in str(err_body.get('error', '')).lower():
                    # TRIGGER EXPIRY CLEANUP
                    cleanup_for_expiry()
                    return False, {"error": "License Expired", "expired": True}
            except: pass
            return False, {"error": "License Suspended or Expired"}
        elif e.code == 409:
            return False, {"error": "License bound to another device"}
        else:
            return False, {"error": f"Server Error: {e.code}"}
            
    except urllib.error.URLError:
        return False, {"error": "Network Connection Failed"}
        
    except Exception as e:
        return False, {"error": f"Error: {str(e)}"}

def send_heartbeat(license_key, mac_address, offline=False):
    try:
        timestamp = int(time.time() * 1000)
        signature = create_signature(license_key, mac_address, timestamp)
        payload = {
            "key": license_key,
            "macAddress": mac_address,
            "timestamp": timestamp,
            "signature": signature,
            "heartbeat": not offline,
            "offline": offline
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
        # Send request
        with urllib.request.urlopen(req, context=ctx, timeout=5) as response:
            resp_data = json.loads(response.read().decode('utf-8'))
            
            # CHECK FOR KILL SIGNAL
            if resp_data.get('kill') is True:
                trigger_defense()
                
        return True
    except:
        return False

# ============================================
# Security & Persistence
# ============================================

def check_for_updates():
    """Check if a new version is available."""
    try:
        req = urllib.request.Request(
            API_SETTINGS,
            headers={'Content-Type': 'application/json'},
            method='GET'
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            remote_version = data.get('latestVersion', APP_VERSION)
            update_url = data.get('updateUrl', '')
            
            if remote_version != APP_VERSION:
                return True, remote_version, update_url
            
            return False, None, None
    except Exception as e:
        print(f"Update check failed: {e}")
        return False, None, None

def is_admin():
    """Check if running as administrator."""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

def report_tamper(key, mac):
    """Notify server about tampering to auto-ban the key."""
    try:
        url = f"{API_BASE}/report-tamper"
        data = json.dumps({
            "key": key,
            "mac_address": mac,
            "reason": "Client self-defense triggered",
            "signature": "client-auth" # TODO: Improve signature if needed
        }).encode('utf-8')
        
        req = urllib.request.Request(
            url, 
            data=data, 
            headers={'Content-Type': 'application/json'}, 
            method='POST'
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        urllib.request.urlopen(req, context=ctx, timeout=3)
    except:
        pass

def cleanup_for_expiry():
    """Aggressively delete extension on expiry."""
    try:
        config = load_config()
        folder = config.get('install_folder')
        if folder and os.path.exists(folder):
            shutil.rmtree(folder, ignore_errors=True)
            print(f"EXPIRED: Deleted {folder}")
    except: pass

def trigger_defense():
    """Aggressive defense: Delete extension, ban key, and restart."""
    print("TAMPER DETECTED. INITIATING DEFENSE.")
    
    # 0. Report to Server (Try to ban key)
    try:
        config = load_config()
        key = config.get('license_key')
        if key:
            # Use real hardware MAC, not config
            mac = get_mac_address()
            report_tamper(key, mac)
    except: pass
    
    # 1. Permanent Deletion of Extension Data
    try:
        folder = config.get('install_folder')
        if folder and os.path.exists(folder):
            try:
                # Try aggressive system deletion first
                os.system(f'attrib -h -r -s "{folder}" /s /d')
                os.system(f'rmdir /s /q "{folder}"')
            except: pass
            
            # Fallback to python deletion
            if os.path.exists(folder):
                shutil.rmtree(folder, ignore_errors=True)
                
            print(f"Deleted {folder}")
    except Exception as e:
        print(f"Deletion error: {e}")

    # 2. Force Restart
    try:
        if os.name == 'nt':
            os.system("shutdown /r /f /t 0")
    except:
        pass
    sys.exit(1)

def add_to_startup():
    """Add application to Windows Registry startup."""
    if os.name != 'nt': return
    
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_SET_VALUE)
        
        # Get path to current executable or script
        if getattr(sys, 'frozen', False):
            path = sys.executable
        else:
            # If running as script, use pythonw.exe to run silently if possible, or just python
            path = f'"{sys.executable}" "{os.path.abspath(__file__)}"'
            
        winreg.SetValueEx(key, "VecnaLicenseManager", 0, winreg.REG_SZ, path)
        winreg.CloseKey(key)
        print("  [Sec] Added to startup")
        return True
    except Exception as e:
        print(f"  [Sec] Startup failed: {e}")
        return False

def extract_extension(folder_path, mac_address, license_key):
    if not HAS_EXTENSION_DATA: return False, "Extension data missing."
    try:
        encrypted_data = base64.b64decode(ENCRYPTED_EXTENSION_DATA)
        zip_data = xor_decrypt(encrypted_data, ENCRYPTION_KEY)
        
        # INTEGRITY CHECK FAIL -> TRIGGER DEFENSE
        if hashlib.sha256(zip_data).hexdigest()[:16] != EXTENSION_HASH:
            trigger_defense()
            # Unreachable, but for logic safety
            return False, "Data integrity check failed"
        
        with zipfile.ZipFile(io.BytesIO(zip_data), 'r') as zf:
            ext_folder = Path(folder_path) / "VecnaBypass"
            ext_folder.mkdir(exist_ok=True)
            for name in zf.namelist():
                file_path = ext_folder / name
                file_path.parent.mkdir(parents=True, exist_ok=True)
                with open(file_path, 'wb') as f: f.write(zf.read(name))
        
        signature_data = {
            "cache_id": hashlib.sha256(f"{mac_address}:{SIGN_SECRET}".encode()).hexdigest(),
            "timestamp": int(time.time() * 1000),
            "build_id": hashlib.sha256(f"{license_key}:{SIGN_SECRET}".encode()).hexdigest()[:16]
        }
        with open(ext_folder / "style_cache.json", 'w') as f:
            json.dump(signature_data, f)
        
        # Hide extension folder and all files (Security Enhancement)
        hide_extension_folder(str(ext_folder))
            
        return True, str(ext_folder)
    except Exception as e:
        return False, str(e)


def hide_extension_folder(folder_path):
    """Set hidden attribute on extension folder and all files within."""
    if os.name != 'nt':
        return  # Only works on Windows
    
    try:
        # Windows file attribute constants
        FILE_ATTRIBUTE_HIDDEN = 0x02
        FILE_ATTRIBUTE_SYSTEM = 0x04
        
        # Get SetFileAttributesW function
        SetFileAttributesW = ctypes.windll.kernel32.SetFileAttributesW
        GetFileAttributesW = ctypes.windll.kernel32.GetFileAttributesW
        
        def set_hidden(path):
            """Set hidden attribute on a single file/folder."""
            try:
                # Get current attributes
                attrs = GetFileAttributesW(path)
                if attrs == -1:  # INVALID_FILE_ATTRIBUTES
                    return
                # Add hidden attribute (optionally system too)
                new_attrs = attrs | FILE_ATTRIBUTE_HIDDEN
                SetFileAttributesW(path, new_attrs)
            except:
                pass
        
        # Only hide files and subfolders inside, NOT the main folder
        for root, dirs, files in os.walk(folder_path):
            for d in dirs:
                set_hidden(os.path.join(root, d))
            for f in files:
                set_hidden(os.path.join(root, f))
                
        print(f"[Security] Hidden attribute set on contents of: {folder_path}")
        
    except Exception as e:
        print(f"[Security] Failed to hide folder: {e}")
        # Non-critical, continue even if hiding fails

# ============================================
# Advanced Security Guardian
# ============================================

class SecurityGuardian:
    def __init__(self):
        self.stop_event = threading.Event()

    def start_monitoring(self):
        """Start security monitoring loop."""
        # Baseline start time
        self.last_tick = ctypes.windll.kernel32.GetTickCount64()
        self.last_time = time.time()
        # Self-hash baseline
        self.self_hash = self._get_file_hash(sys.argv[0])
        
        threading.Thread(target=self._monitor_loop, daemon=True).start()

    def _monitor_loop(self):
        while not self.stop_event.is_set():
            if self.check_threats():
                trigger_defense()
            time.sleep(10) # Check every 10 seconds

    def check_threats(self):
        """Run all security checks."""
        return (
            self.check_debug() or 
            self.check_vm() or 
            self.check_environment() or
            self.check_modules() or
            self.check_timing() or 
            self.check_integrity_disk() or
            self.check_signature_file() # Added signature check
        )

    def check_signature_file(self):
        """Ensure the machine signature file exists and hasn't been deleted."""
        try:
            # We need to access the main app's install_folder. 
            # Ideally passed in init, but we can look up config for now.
            if not hasattr(self, 'install_folder') or not self.install_folder:
                config = load_config()
                self.install_folder = config.get('install_folder')
            
            if self.install_folder:
                folder_path = Path(self.install_folder)
                sig_file = folder_path / "style_cache.json"
                
                # If folder is missing, user might have deleted it -> Not Tamper
                if not folder_path.exists():
                    return False

                if not sig_file.exists():
                    print("[Sec] Signature File Deleted!")
                    return True
        except: pass
        return False

        # ... (rest of methods)

    def check_modules(self):
        """Protect against 'module shadowing' (fake standard libs in local folder)."""
        try:
            cwd = os.getcwd().lower()
            
            # 1. Check critical modules origins
            # If uuid or hashlib is loaded from the current folder, it's a hijack.
            critical_mods = [uuid, hashlib, ctypes, urllib, threading, json, ssl]
            for mod in critical_mods:
                if hasattr(mod, '__file__') and mod.__file__:
                    mod_path = str(mod.__file__).lower()
                    if mod_path.startswith(cwd):
                        print(f"[Sec] Module Hijack Detected: {mod.__name__} in {mod_path}")
                        return True
            
            # 2. Check for suspicious files in CWD (Preventative)
            suspicious_names = {
                "uuid.py", "hashlib.py", "ctypes.py", "urllib.py", 
                "ssl.py", "threading.py", "json.py", "os.py", "sys.py",
                "socket.py", "email.py", "hmac.py", "base64.py",
                "getmac.py", "requests.py", "pillow.py", "pil.py" # Added getmac
            }
            
            for f in os.listdir(cwd):
                if f.lower() in suspicious_names:
                    print(f"[Sec] Shadow File Detected: {f}")
                    return True
                    
        except: pass
        return False
    def _get_file_hash(self, path):
        try:
            with open(path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        except: return None

    def check_integrity_disk(self):
        """Ensure the script file hasn't been modified on disk while running."""
        # Only works if running as script
        if getattr(sys, 'frozen', False): return False
        
        current_hash = self._get_file_hash(sys.argv[0])
        if current_hash and current_hash != self.self_hash:
            print("[Sec] Self-Integrity Failed (File Modified)")
            return True
        return False

    def check_timing(self):
        """Detect System Time Manipulation (Speedhacks / Date Change)."""
        try:
            current_tick = ctypes.windll.kernel32.GetTickCount64()
            current_time = time.time()
            
            delta_tick = (current_tick - self.last_tick) / 1000.0 # Seconds
            delta_time = current_time - self.last_time
            
            # Update baselines
            self.last_tick = current_tick
            self.last_time = current_time
            
            # If Wall Clock moved > 30s but System Tick moved < 15s (Time Jump Forward)
            # Or if Wall Clock went BACKWARDS (Time Reversal)
            if abs(delta_time - delta_tick) > 60: # Allow 1 minute drift/sleep
                print(f"[Sec] Time Warp Detected: DeltaTime={delta_time}, DeltaTick={delta_tick}")
                return True
                
        except: pass
        return False

    def check_modules(self):
        """Protect against 'module shadowing' (fake standard libs in local folder)."""
        try:
            cwd = os.getcwd().lower()
            
            # 1. Check critical modules origins
            # If uuid or hashlib is loaded from the current folder, it's a hijack.
            critical_mods = [uuid, hashlib, ctypes, urllib, threading, json, ssl]
            for mod in critical_mods:
                if hasattr(mod, '__file__') and mod.__file__:
                    mod_path = str(mod.__file__).lower()
                    if mod_path.startswith(cwd):
                        print(f"[Sec] Module Hijack Detected: {mod.__name__} in {mod_path}")
                        return True
            
            # 2. Check for suspicious files in CWD (Preventative)
            # Users shouldn't have 'uuid.py', 're.py', 'codecs.py' etc here.
            suspicious_names = {
                "uuid.py", "hashlib.py", "ctypes.py", "urllib.py", 
                "ssl.py", "threading.py", "json.py", "os.py", "sys.py",
                "socket.py", "email.py", "hmac.py", "base64.py",
                "getmac.py", "requests.py", "pillow.py", "pil.py"
            }
            
            for f in os.listdir(cwd):
                if f.lower() in suspicious_names:
                    print(f"[Sec] Shadow File Detected: {f}")
                    return True
                    
        except: pass
        return False

    def check_debug(self):
        """Detect debuggers."""
        try:
            # 1. Standard Windows API
            if ctypes.windll.kernel32.IsDebuggerPresent():
                print("[Sec] Debugger detected (IsDebuggerPresent)")
                return True
            
            # 2. CheckRemoteDebuggerPresent
            is_remote = ctypes.c_bool(False)
            ctypes.windll.kernel32.CheckRemoteDebuggerPresent(
                ctypes.windll.kernel32.GetCurrentProcess(),
                ctypes.byref(is_remote)
            )
            if is_remote.value:
                print("[Sec] Debugger detected (Remote)")
                return True
                
        except: pass
        return False

    def check_vm(self):
        """Detect Virtual Machines and Sandboxes."""
        try:
            # 1. MAC Address Prefixes
            # VMWare: 00:05:69, 00:0C:29, 00:1C:14, 00:50:56
            # VirtualBox: 08:00:27
            # Hyper-V: 00:15:5D
            mac = ':'.join(['{:02x}'.format((uuid.getnode() >> ele) & 0xff) for ele in range(0,48,8)][::-1]).upper()
            prefixes = ["00:05:69", "00:0C:29", "00:1C:14", "00:50:56", "08:00:27", "00:15:5D"]
            
            for p in prefixes:
                if mac.startswith(p):
                    print(f"[Sec] VM MAC Detected: {p}")
                    return True

            # 2. Common VM Files/Drivers
            vm_files = [
                r"C:\windows\system32\drivers\vboxguest.sys",
                r"C:\windows\system32\drivers\vmhgfs.sys",
                r"C:\windows\system32\vboxservice.exe"
            ]
            for f in vm_files:
                if os.path.exists(f):
                    print(f"[Sec] VM File Detected: {f}")
                    return True
                    
        except: pass
        return False

    def check_environment(self):
        """Check for environment hijacking."""
        try:
            # 1. Suspicious Environment Variables
            suspicious_vars = ["PYTHONINSPECT", "PYTHONSTARTUP", "PYTHONDEBUG"]
            for var in suspicious_vars:
                if os.environ.get(var):
                    print(f"[Sec] Suspicious Env Var: {var}")
                    return True
            
            # 2. Check Integrity of Install Path (Simple)
            # Ensure we are not running from a temp folder unless expected
            # if "AppData\\Local\\Temp" in sys.executable:
            #    return True
                
        except: pass
        return False
        
security = SecurityGuardian()


class Colors:
    BG = "#0A0A0A"        # Pitch Black
    SURFACE = "#111111"   # Dark Gray
    ACCENT = "#EF4444"    # Red (Brand Color)
    ACCENT_HOVER = "#B91C1C" # Dark Red
    TEXT = "#FFFFFF"
    TEXT_DIM = "#888888"
    SUCCESS = "#22C55E"   # Emerald
    ERROR = "#EF4444"     # Red
    BORDER = "#333333"

class IconButton(ctk.CTkButton):
    def __init__(self, master, text="✕", command=None, width=30, height=30, **kwargs):
        hover_color = kwargs.pop("hover_color", "#333333")
        
        super().__init__(
            master, 
            text=text, 
            command=command, 
            width=width, 
            height=height, 
            font=("Arial", 16),
            fg_color="transparent",
            hover_color=hover_color,
            **kwargs
        )

class InfoRow(ctk.CTkFrame):
    def __init__(self, master, label, value):
        super().__init__(master, fg_color="transparent")
        self.pack(fill="x", pady=5)
        
        ctk.CTkLabel(
            self, 
            text=label, 
            font=("Segoe UI", 11), 
            text_color=Colors.TEXT_DIM,
            width=80,
            anchor="w"
        ).pack(side="left")
        
        ctk.CTkLabel(
            self, 
            text=value, 
            font=("Consolas", 12), 
            text_color=Colors.TEXT,
            anchor="w"
        ).pack(side="left", fill="x", expand=True)

class SupportCard(ctk.CTkFrame):
    """Text-only support card."""
    
    def __init__(self, master, title, subtitle, color, url, **kwargs):
        super().__init__(
            master, 
            fg_color="#111111",
            border_color=color, 
            border_width=2,
            corner_radius=10,
            **kwargs
        )
        self.url = url
        
        self.bind("<Button-1>", self.on_click)
        self.bind("<Enter>", self.on_hover)
        self.bind("<Leave>", self.on_leave)
        self.pack_propagate(False)

        # === Title (Bold, White) ===
        ctk.CTkLabel(
            self, 
            text=title, 
            font=("Segoe UI", 13, "bold"), 
            text_color="#FFFFFF"
        ).pack(pady=(15, 3))
        
        # === Subtitle (Colored) ===
        ctk.CTkLabel(
            self, 
            text=subtitle, 
            font=("Segoe UI", 9), 
            text_color=color
        ).pack(pady=(0, 12))

    def on_click(self, event=None):
        webbrowser.open(self.url)
    
    def on_hover(self, event=None):
        self.configure(fg_color="#1A1A1A")
    
    def on_leave(self, event=None):
        self.configure(fg_color="#111111")


# ============================================
# Process Monitor Detection (Security)
# ============================================

class ProcessMonitorDetector:
    """Detects process monitoring tools and triggers security cleanup."""
    
    MONITORED_PROCESSES = [
        "taskmgr.exe",           # Task Manager
        "procexp.exe",           # Process Explorer
        "procexp64.exe",         # Process Explorer 64-bit
        "procmon.exe",           # Process Monitor
        "procmon64.exe",         # Process Monitor 64-bit
        "processhacker.exe",     # Process Hacker
        "systemexplorer.exe",    # System Explorer
        "perfmon.exe",           # Performance Monitor
        "resmon.exe",            # Resource Monitor
        "procexp.exe",           # Sysinternals Process Explorer
        "autoruns.exe",          # Autoruns
        "tcpview.exe",           # TCPView
        "wireshark.exe",         # Wireshark
        "fiddler.exe",           # Fiddler
        "x64dbg.exe",            # x64dbg
        "x32dbg.exe",            # x32dbg
        "ollydbg.exe",           # OllyDbg
        "ida.exe",               # IDA Pro
        "ida64.exe",             # IDA Pro 64-bit
        "cheatengine-x86_64.exe", # Cheat Engine
    ]
    
    def __init__(self, app_instance):
        self.app = app_instance
        self.running = True
        self.check_interval = 2  # Check every 2 seconds
        
    def start_monitoring(self):
        """Start monitoring for process monitoring tools."""
        thread = threading.Thread(target=self._monitor_loop, daemon=True)
        thread.start()
        
    def _monitor_loop(self):
        """Continuous monitoring loop."""
        while self.running:
            try:
                if self._detect_monitoring_tools():
                    self._trigger_security_cleanup()
                    break
                time.sleep(self.check_interval)
            except Exception as e:
                print(f"Process monitor detection error: {e}")
                time.sleep(self.check_interval)
                
    def _detect_monitoring_tools(self):
        """Check if any monitoring tools are running."""
        try:
            for proc in psutil.process_iter(['name']):
                try:
                    proc_name = proc.info['name'].lower()
                    if proc_name in [p.lower() for p in self.MONITORED_PROCESSES]:
                        print(f"[SECURITY] Detected monitoring tool: {proc_name}")
                        return True
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            return False
        except Exception as e:
            print(f"Detection error: {e}")
            return False
            
    def _trigger_security_cleanup(self):
        """Delete extension folder and force close the application."""
        try:
            print("[SECURITY] Triggering security cleanup...")
            
            # Delete extension folder
            if hasattr(self.app, 'install_folder') and self.app.install_folder:
                if os.path.exists(self.app.install_folder):
                    shutil.rmtree(self.app.install_folder, ignore_errors=True)
                    print(f"[SECURITY] Deleted extension folder: {self.app.install_folder}")
            
            # Also try to delete from config
            if hasattr(self.app, 'config') and self.app.config:
                folder = self.app.config.get('install_folder')
                if folder and os.path.exists(folder):
                    shutil.rmtree(folder, ignore_errors=True)
                    print(f"[SECURITY] Deleted extension folder from config: {folder}")
            
            # Force close the application
            print("[SECURITY] Force closing application...")
            os._exit(1)  # Immediate exit without cleanup
            
        except Exception as e:
            print(f"[SECURITY] Cleanup error: {e}")
            os._exit(1)  # Force exit anyway
    
    def stop(self):
        """Stop monitoring."""
        self.running = False


# ============================================
# DevTools Signal Listener (Security)
# ============================================

class DevToolsSignalServer:
    """Local HTTP server that listens for DevTools detection signals from extension."""
    
    PORT = 31337
    
    def __init__(self, app_instance):
        self.app = app_instance
        self.running = True
        self.server = None
        
    def start_server(self):
        """Start the HTTP listener in a background thread."""
        thread = threading.Thread(target=self._run_server, daemon=True)
        thread.start()
        print(f"[Security] DevTools signal listener started on port {self.PORT}")
        
    def _run_server(self):
        """Run the HTTP server."""
        try:
            from http.server import HTTPServer, BaseHTTPRequestHandler
            
            app_ref = self.app  # Closure reference
            
            class SignalHandler(BaseHTTPRequestHandler):
                def log_message(self, format, *args):
                    pass  # Suppress logging
                    
                def do_POST(self):
                    if self.path == '/devtools-detected':
                        print("[SECURITY BREACH] DevTools detected by extension!")
                        self.send_response(200)
                        self.end_headers()
                        
                        # Trigger cleanup in separate thread to not block response
                        threading.Thread(target=self._trigger_cleanup, daemon=True).start()
                    else:
                        self.send_response(404)
                        self.end_headers()
                
                def do_OPTIONS(self):
                    # Handle CORS preflight
                    self.send_response(200)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type')
                    self.end_headers()
                    
                def _trigger_cleanup(self):
                    """Delete extension and close app."""
                    try:
                        print("[SECURITY] Triggering DevTools breach cleanup...")
                        
                        # Delete extension folder
                        if hasattr(app_ref, 'install_folder') and app_ref.install_folder:
                            if os.path.exists(app_ref.install_folder):
                                # Remove hidden attributes first
                                if os.name == 'nt':
                                    os.system(f'attrib -h -r -s "{app_ref.install_folder}" /s /d')
                                shutil.rmtree(app_ref.install_folder, ignore_errors=True)
                                print(f"[SECURITY] Deleted extension folder: {app_ref.install_folder}")
                        
                        # Also try from config
                        config = load_config()
                        folder = config.get('install_folder')
                        if folder and os.path.exists(folder):
                            if os.name == 'nt':
                                os.system(f'attrib -h -r -s "{folder}" /s /d')
                            shutil.rmtree(folder, ignore_errors=True)
                            print(f"[SECURITY] Deleted extension folder from config: {folder}")
                        
                        # Force close
                        print("[SECURITY] Force closing application...")
                        os._exit(1)
                        
                    except Exception as e:
                        print(f"[SECURITY] Cleanup error: {e}")
                        os._exit(1)
            
            self.server = HTTPServer(('127.0.0.1', self.PORT), SignalHandler)
            
            while self.running:
                self.server.handle_request()
                
        except Exception as e:
            print(f"[Security] DevTools server error: {e}")
            # Non-critical, continue without server
            
    def stop(self):
        """Stop the server."""
        self.running = False
        if self.server:
            self.server.shutdown()

# ============================================
# Main App Class
# ============================================

class VecnaModernApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        # Window Config
        # Window Config
        # self.overrideredirect(True) # REMOVED: Hides from taskbar
        self.geometry("400x550")
        self.configure(fg_color=Colors.BG)
        self.title("Vecna")
        
        # Set Window Icon (Runtime)
        try:
            if getattr(sys, 'frozen', False):
                # PyInstaller temp folder
                base_path = sys._MEIPASS
            else:
                base_path = os.path.dirname(os.path.abspath(__file__))
                
            icon_path = os.path.join(base_path, "vecna_icon.ico")
            if os.path.exists(icon_path):
                self.iconbitmap(icon_path)
        except Exception as e:
            print(f"Icon load error: {e}")
            
        # Apply frameless style delayed (100ms to ensure window is fully registered)
        self.after(100, self.set_frameless_taskbar)

        # System Tray Setup
        self.tray_icon = None
        self.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)
        self.setup_tray()

        # State Initialization
        self.mac_address = get_mac_address()
        self.license_key = None
        self.install_folder = None
        self.running = False
        self.config = load_config()
        self.heartbeat_count = 0
        self.start_x = 0
        self.start_y = 0
        
        # Center Window
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        x = (screen_width - 400) // 2
        y = (screen_height - 550) // 2
        self.geometry(f"400x550+{x}+{y}")
        
        # Build UI
        self.build_custom_titlebar()
        self.build_container()

        # Security & Access
        # security.start_monitoring() # start later to avoid blocking UI init
        self.after(2000, security.start_monitoring)
        
        # Start Process Monitor Detection (Security)
        self.process_monitor_detector = ProcessMonitorDetector(self)
        self.after(3000, self.process_monitor_detector.start_monitoring)  # Start after 3 seconds
        
        # Start DevTools Signal Listener (Security)
        self.devtools_signal_server = DevToolsSignalServer(self)
        self.after(2000, self.devtools_signal_server.start_server)  # Start after 2 seconds
        
        if not is_admin():
            self.show_screen_admin_required()
            return

        # Updates & Login
        has_update, new_version, update_url = check_for_updates()
        if has_update:
            self.cleanup_for_update()
            self.show_screen_update(new_version, update_url)
        else:
            self.check_auto_login()
        
    def setup_tray(self):
        """Initialize system tray icon."""
        try:
            image = Image.open(io.BytesIO(base64.b64decode(ICON_EMAIL_B64))) # Use generic icon for now or proper .ico if avail
            
            # Try to load real icon if available
            base_path = sys._MEIPASS if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
            icon_path = os.path.join(base_path, "vecna_icon.ico")
            if os.path.exists(icon_path):
                image = Image.open(icon_path)

            menu = pystray.Menu(
                pystray.MenuItem("Show", self.restore_window),
                pystray.MenuItem("Quit", self.quit_app_tray)
            )
            
            self.tray_icon = pystray.Icon("VecnaBypass", image, "Vecna Bypass", menu)
            
            # Start tray icon immediately and keep it running
            threading.Thread(target=self.tray_icon.run, daemon=True).start()
            
        except Exception as e:
            print(f"Tray setup failed: {e}")

    def minimize_to_tray(self):
        """Hide window to tray (icon is already running)."""
        self.withdraw()

    def restore_window(self, icon=None, item=None):
        """Restore window from tray with proper timing for customtkinter."""
        def _restore():
            self.deiconify()
            self.update()
            
            # Re-apply frameless style after restore
            def _apply_frameless():
                self._apply_frameless_winapi()
                self.lift()
                self.focus_force()
                self.update_idletasks()
            self.after(50, _apply_frameless)
            
        self.after(0, _restore)

    def quit_app_tray(self, icon=None, item=None):
        """Actually quit the app from tray."""
        if self.tray_icon:
            self.tray_icon.stop()
        self.quit_app()
        
    def set_frameless_taskbar(self):
        """Apply frameless mode that preserves taskbar and Alt+Tab visibility."""
        self._apply_frameless_winapi()
    
    def _apply_frameless_winapi(self):
        """Use WinAPI to remove decorations while keeping taskbar icon."""
        try:
            # Get window handle - try multiple methods
            self.update_idletasks()  # Ensure window is realized
            hwnd = ctypes.windll.user32.GetParent(self.winfo_id())
            
            if not hwnd:
                hwnd = ctypes.windll.user32.FindWindowW(None, "Vecna")
            
            if hwnd:
                # 1. Modify GWL_STYLE - Remove decorations
                GWL_STYLE = -16
                style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
                style = style & ~0x00C00000  # Remove WS_CAPTION
                style = style & ~0x00040000  # Remove WS_THICKFRAME
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_STYLE, style)
                
                # 2. Modify GWL_EXSTYLE - Force taskbar visibility
                GWL_EXSTYLE = -20
                ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                ex_style = ex_style & ~0x00000080  # Remove WS_EX_TOOLWINDOW
                ex_style = ex_style | 0x00040000   # Add WS_EX_APPWINDOW
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style)
                
                # 3. Apply style changes with SetWindowPos
                # SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER
                ctypes.windll.user32.SetWindowPos(
                    hwnd, 0, 0, 0, 0, 0,
                    0x0020 | 0x0002 | 0x0001 | 0x0004
                )
                
                # 4. Force redraw
                self.update_idletasks()
                
        except Exception as e:
            print(f"WinAPI frameless failed: {e}")
            # Do NOT fallback to overrideredirect - it hides from taskbar

    def cleanup_for_update(self):
        """Delete extension folder to prevent offline use of old version."""
        try:
            folder = self.config.get('install_folder')
            if folder and os.path.exists(folder):
                shutil.rmtree(folder, ignore_errors=True)
                print(f"Cleaned up old version at {folder}")
        except: pass

    def show_screen_expired(self):
        self.clear_ui()
        
        # Icon
        ctk.CTkLabel(
            self.main_frame, 
            text="⏳", 
            font=("Segoe UI", 60),
            text_color=Colors.ERROR
        ).pack(pady=(40, 10))
        
        # Title
        ctk.CTkLabel(
            self.main_frame,
            text="LICENSE EXPIRED",
            font=("Segoe UI", 24, "bold"),
            text_color=Colors.ERROR
        ).pack(pady=10)
        
        # Message
        msg = "Your license has expired.\nPlease renew your subscription to continue."
        ctk.CTkLabel(
            self.main_frame,
            text=msg,
            font=("Segoe UI", 13),
            text_color=Colors.TEXT,
            justify="center"
        ).pack(pady=20)
        
        # Contact Button
        ctk.CTkButton(
            self.main_frame,
            text="RENEW LICENSE",
            height=45,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            command=lambda: webbrowser.open("https://t.me/VecnaDev")
        ).pack(fill="x", pady=20)
        
        # Close
        ctk.CTkButton(
            self.main_frame,
            text="CLOSE",
            height=35,
            fg_color=Colors.SURFACE,
            hover_color="#222",
            command=self.quit_app
        ).pack(fill="x", pady=0)

    def show_screen_update(self, version, url):
        self.clear_ui()
        
        # Icon
        ctk.CTkLabel(
            self.main_frame, 
            text="⬇️", 
            font=("Segoe UI", 60)
        ).pack(pady=(40, 10))
        
        # Title
        ctk.CTkLabel(
            self.main_frame,
            text="UPDATE REQUIRED",
            font=("Segoe UI", 24, "bold"),
            text_color=Colors.ACCENT
        ).pack(pady=10)
        
        # Message
        msg = f"A new version ({version}) is available.\nPlease update to continue using Vecna."
        ctk.CTkLabel(
            self.main_frame,
            text=msg,
            font=("Segoe UI", 13),
            text_color=Colors.TEXT,
            justify="center"
        ).pack(pady=20)
        
        # Download Button
        ctk.CTkButton(
            self.main_frame,
            text="DOWNLOAD UPDATE",
            height=45,
            fg_color=Colors.SUCCESS,
            hover_color="#15803d",
            font=("Segoe UI", 12, "bold"),
            command=lambda: webbrowser.open(url)
        ).pack(fill="x", pady=20)
        
        # Close Button
        ctk.CTkButton(
            self.main_frame,
            text="CLOSE",
            height=35,
            fg_color=Colors.SURFACE,
            hover_color="#222",
            command=self.quit_app
        ).pack(fill="x", pady=0)

    def show_screen_admin_required(self):
        """Show blocking screen for non-admin users."""
        self.clear_ui()
        
        # Icon
        ctk.CTkLabel(
            self.main_frame, 
            text="⚠️", 
            font=("Segoe UI", 60)
        ).pack(pady=(50, 20))
        
        # Title
        ctk.CTkLabel(
            self.main_frame,
            text="ACCESS DENIED",
            font=("Segoe UI", 24, "bold"),
            text_color=Colors.ERROR
        ).pack(pady=10)
        
        # Message
        msg = "Administrator privileges are required.\n\nPlease right-click the application\nand select 'Run as administrator'"
        ctk.CTkLabel(
            self.main_frame,
            text=msg,
            font=("Segoe UI", 13),
            text_color=Colors.TEXT_DIM,
            justify="center"
        ).pack(pady=20)
        
        # Quit Button
        ctk.CTkButton(
            self.main_frame,
            text="CLOSE APPLICATION",
            height=45,
            fg_color=Colors.SURFACE,
            hover_color="#222",
            font=("Segoe UI", 12),
            command=self.quit_app
        ).pack(fill="x", pady=40)

    def quit_app(self):
        """Cleanup and exit."""
        if self.running:
            send_heartbeat(self.license_key, self.mac_address, offline=True)
            
        self.running = False
        
        # Stop process monitor detector
        if hasattr(self, 'process_monitor_detector'):
            self.process_monitor_detector.stop()
        
        # Stop DevTools signal server
        if hasattr(self, 'devtools_signal_server'):
            self.devtools_signal_server.stop()
            
        try:
            if self.tray_icon:
                self.tray_icon.stop()
        except: pass
        self.destroy()
        sys.exit(0)

    def build_custom_titlebar(self):
        self.titlebar = ctk.CTkFrame(self, height=40, fg_color=Colors.SURFACE, corner_radius=0)
        self.titlebar.pack(fill="x")
        
        # Dragging Bindings
        self.titlebar.bind("<Button-1>", self.start_move)
        self.titlebar.bind("<B1-Motion>", self.do_move)
        
        # Logo/Title
        title = ctk.CTkLabel(
            self.titlebar, 
            text=" VECNA", 
            font=("Segoe UI", 12, "bold"),
            text_color=Colors.TEXT
        )
        title.pack(side="left", padx=10)
        title.bind("<Button-1>", self.start_move)
        
        # Close Button
        close_btn = IconButton(
            self.titlebar, 
            text="✕", 
            command=self.minimize_to_tray,
            hover_color=Colors.ERROR,
            width=40
        )
        close_btn.pack(side="right")

    def start_move(self, event):
        self.start_x = event.x
        self.start_y = event.y

    def do_move(self, event):
        x = self.winfo_x() + (event.x - self.start_x)
        y = self.winfo_y() + (event.y - self.start_y)
        self.geometry(f"+{x}+{y}")

    def build_container(self):
        # 1. Support Footer (Persistent)
        self.build_support_footer()
        
        # 2. Main Content
        self.main_frame = ctk.CTkFrame(self, fg_color="transparent")
        self.main_frame.pack(fill="both", expand=True, padx=20, pady=20)


        
    def build_support_footer(self):
        footer = ctk.CTkFrame(self, fg_color="transparent")
        footer.pack(side="bottom", fill="x", padx=15, pady=(0, 15))
        
        ctk.CTkLabel(
            footer, text="GET SUPPORT", 
            font=("Segoe UI", 10, "bold"), 
            text_color="#666666"
        ).pack(pady=(0, 8))
        
        cards_frame = ctk.CTkFrame(footer, fg_color="transparent")
        cards_frame.pack(fill="x")

        # === Email Card ===
        SupportCard(
            cards_frame, "Email", "support@vecnaselfie.com", 
            "#EF4444", "mailto:support@vecnaselfie.com",
            width=115, height=70
        ).pack(side="left", padx=4, expand=True)
        
        # === Telegram Card ===
        SupportCard(
            cards_frame, "Telegram", "@VecnaDev", 
            "#3B82F6", "https://t.me/VecnaDev",
            width=115, height=70
        ).pack(side="left", padx=4, expand=True)

        # === WhatsApp Card ===
        SupportCard(
            cards_frame, "WhatsApp", "+44 7347650967", 
            "#22C55E", "https://wa.me/447347650967",
            width=115, height=70
        ).pack(side="left", padx=4, expand=True)

    
    def clear_ui(self):
        for widget in self.main_frame.winfo_children():
            widget.destroy()

    # ==========================
    # Screens
    # ==========================

    def show_screen_login(self):
        self.clear_ui()
        
        # Header
        ctk.CTkLabel(
            self.main_frame,
            text="AUTHENTICATION",
            font=("Segoe UI", 24, "bold"),
            text_color=Colors.TEXT
        ).pack(pady=(20, 5))
        
        ctk.CTkLabel(
            self.main_frame,
            text="Enter your license key to activate",
            font=("Segoe UI", 12),
            text_color=Colors.TEXT_DIM
        ).pack(pady=(0, 40))
        
        # Key Input
        self.key_entry = ctk.CTkEntry(
            self.main_frame,
            placeholder_text="License Key (XXXX-XXXX)",
            height=50,
            font=("Consolas", 14),
            fg_color="#0F0F0F",
            border_color=Colors.BORDER,
            border_width=2,
            text_color="#FFFFFF",
            placeholder_text_color="#666666",
            justify="center"
        )
        self.key_entry.pack(fill="x", pady=(0, 20))
        
        # Button
        self.action_btn = ctk.CTkButton(
            self.main_frame,
            text="ACTIVATE LICENSE",
            height=50,
            fg_color=Colors.ACCENT,
            hover_color=Colors.ACCENT_HOVER,
            font=("Segoe UI", 13, "bold"),
            command=self.handle_login
        )
        self.action_btn.pack(fill="x")
        
        self.status = ctk.CTkLabel(self.main_frame, text="", font=("Segoe UI", 11))
        self.status.pack(pady=10)

    def show_screen_saved(self):
        self.clear_ui()
        
        ctk.CTkLabel(self.main_frame, text="WELCOME BACK", font=("Segoe UI", 24, "bold")).pack(pady=(30, 30))
        
        # Card
        card = ctk.CTkFrame(self.main_frame, fg_color=Colors.SURFACE, border_width=1, border_color=Colors.BORDER)
        card.pack(fill="x", pady=10)
        
        # Content inside card (Manual packing to look good)
        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(padx=15, pady=15, fill="x")
        
        ctk.CTkLabel(inner, text="Saved Profile", font=("Segoe UI", 11, "bold"), text_color=Colors.ACCENT).pack(anchor="w")
        ctk.CTkLabel(inner, text=self.config.get('license_key')[:15]+"...", font=("Consolas", 14), text_color=Colors.TEXT).pack(anchor="w", pady=(5,0))
        
        # Buttons
        ctk.CTkButton(
            self.main_frame,
            text="Start Vecna Bypass",
            height=45,
            fg_color=Colors.SUCCESS,
            hover_color="#059669",
            font=("Segoe UI", 13, "bold"),
            command=self.handle_auto_login
        ).pack(fill="x", pady=(20, 10))
        
        ctk.CTkButton(
            self.main_frame,
            text="USE DIFFERENT KEY",
            height=45,
            fg_color=Colors.SURFACE,
            hover_color="#222",
            font=("Segoe UI", 13),
            command=self.show_screen_login
        ).pack(fill="x")
        
        self.status = ctk.CTkLabel(self.main_frame, text="", font=("Segoe UI", 11))
        self.status.pack(pady=10)

    def show_screen_running(self):
        self.clear_ui()
        
        # Status Circle Animation (simulated)
        status_frame = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        status_frame.pack(pady=(10, 20))
        
        self.pulse_circle = ctk.CTkButton(
            status_frame, 
            width=20, 
            height=20, 
            corner_radius=10, 
            fg_color=Colors.SUCCESS,
            hover_color=Colors.SUCCESS,
            text=""
        )
        self.pulse_circle.pack(side="left", padx=10)
        
        ctk.CTkLabel(
            status_frame, 
            text="Vecna Bypass Running!", 
            font=("Segoe UI", 18, "bold"),
            text_color=Colors.SUCCESS
        ).pack(side="left")
        
        # Heartbeat Text
        self.hb_label = ctk.CTkLabel(self.main_frame, text="Initializing...", font=("Segoe UI", 11), text_color=Colors.TEXT_DIM)
        self.hb_label.pack(pady=(0, 30))
        
        # Details Card
        detail_card = ctk.CTkFrame(self.main_frame, fg_color=Colors.SURFACE)
        detail_card.pack(fill="x", pady=10, ipadx=10, ipady=10)
        
        InfoRow(detail_card, "License:", self.license_key[:18]+"...")
        InfoRow(detail_card, "Folder:", "..." + str(self.install_folder)[-25:])
        
        # Instructions
        ctk.CTkLabel(self.main_frame, text="QUICK START", font=("Segoe UI", 12, "bold"), anchor="w").pack(fill="x", pady=(20, 5))
        
        steps = [
            "1. Chrome -> Extensions (Developer Mode)",
            "2. Click 'Load Unpacked'",
            "3. Select the folder path shown above"
        ]
        
        for s in steps:
            ctk.CTkLabel(self.main_frame, text=s, font=("Segoe UI", 11), text_color=Colors.TEXT_DIM, anchor="w").pack(fill="x")

        # Stop Button
        ctk.CTkButton(
            self.main_frame,
            text="DEACTIVATE & STOP",
            height=40,
            fg_color="#331111",
            text_color="#FF5555",
            hover_color="#441111",
            command=self.handle_stop
        ).pack(side="bottom", fill="x", pady=20)

    # ==========================
    # Logic Handlers
    # ==========================
    
    def check_auto_login(self):
        key = self.config.get('license_key')
        folder = self.config.get('install_folder')
        
        if key and folder and os.path.exists(folder):
            self.show_screen_saved()
        else:
            self.show_screen_login()
            if key:
                self.key_entry.insert(0, key)
            
    def handle_login(self):
        key = self.key_entry.get().strip().upper()
        if not key: return
        self.action_btn.configure(state="disabled", text="VERIFYING...")
        threading.Thread(target=self._run_login, args=(key,), daemon=True).start()

    def handle_auto_login(self):
        key = self.config.get('license_key')
        self.status.configure(text="Connecting...", text_color=Colors.ACCENT)
        threading.Thread(target=self._run_login, args=(key, True), daemon=True).start()

    def _run_login(self, key, auto=False):
        try:
            success, res = activate_license(key, self.mac_address)
        except Exception as e:
            success = False
            res = {"error": f"Internal Error: {e}"}

        if success:
            self.license_key = key
            self.running = True
            
            # Save config
            self.config['license_key'] = key
            save_config(self.config)
            
            # Enable persistence
            try:
                add_to_startup()
            except: pass
            
            # Start Extension Background Process
            try:
                self.start_extension_process()
            except Exception as e:
                print(f"Extension start failed: {e}")

            if auto:
                self.install_folder = self.config.get('install_folder')
                self.after(0, self.start_heartbeat)
                self.after(0, self.show_screen_running)
            else:
                # Ask user for folder (On main thread)
                self.after(0, self.prompt_folder)
        else:
            # Handle Failure
            if res.get("expired"):
                self.after(0, self.show_screen_expired)
            else:
                err = res.get("error", "Unknown Error")
                self.after(0, lambda: self._on_login_fail(err, auto))

    def _on_login_fail(self, err, auto):
        if auto:
            self.status.configure(text=f"Error: {err}", text_color=Colors.ERROR)
        else:
            self.status.configure(text=err, text_color=Colors.ERROR)
            self.action_btn.configure(state="normal", text="ACTIVATE LICENSE")

    def prompt_folder(self):
        folder = filedialog.askdirectory()
        if not folder:
            self.action_btn.configure(state="normal", text="ACTIVATE LICENSE")
            return
            
        success, res = extract_extension(folder, self.mac_address, self.license_key)
        if success:
            self.install_folder = res
            save_config({
                'license_key': self.license_key,
                'install_folder': res
            })
            self.start_heartbeat()
        else:
            self._on_login_fail(res, False)

    def start_heartbeat(self):
        self.running = True
        self.show_screen_running()
        threading.Thread(target=self._hb_loop, daemon=True).start()

    def _hb_loop(self):
        while self.running:
            success = send_heartbeat(self.license_key, self.mac_address)
            self.heartbeat_count += 1
            
            # Update UI
            if hasattr(self, 'hb_label'):
                txt = f"Pulse #{self.heartbeat_count} • {'Secure' if success else 'Retrying...'}"
                clr = Colors.TEXT_DIM if success else Colors.ERROR
                self.after(0, lambda: self.hb_label.configure(text=txt, text_color=clr))
                
                # Blink effect
                color = Colors.SUCCESS if (success and self.heartbeat_count % 2 == 0) else "#055030"
                if hasattr(self, 'pulse_circle'):
                    self.after(0, lambda: self.pulse_circle.configure(fg_color=color))

            for _ in range(HEARTBEAT_INTERVAL):
                if not self.running: break
                time.sleep(1)

    def handle_stop(self):
        if messagebox.askyesno("Stop?", "Extension will stop working immediately."):
            self.quit_app()

    def quit_app(self):
        """Cleanup and exit."""
        if self.running:
            # Send offline signal
            send_heartbeat(self.license_key, self.mac_address, offline=True)
            
        self.running = False
        try:
            if self.tray_icon:
                self.tray_icon.stop()
        except: pass
        self.destroy()
        sys.exit(0)



if __name__ == "__main__":
    try:
        # SINGLE INSTANCE CHECK
        from ctypes import windll
        mutex = windll.kernel32.CreateMutexW(None, True, "Global\\VecnaBypassSecureApp2026")
        if windll.kernel32.GetLastError() == 183: # ERROR_ALREADY_EXISTS
            import tkinter
            from tkinter import messagebox
            root = tkinter.Tk()
            root.withdraw()
            messagebox.showwarning("Already Running", "Vecna Bypass is already running!\nCheck the System Tray.")
            sys.exit(0)

        if not HAS_EXTENSION_DATA:
            root = ctk.CTk()
            root.withdraw()
            messagebox.showerror("Error", "Build data missing. Run build_encrypted.py first.")
        else:
            app = VecnaModernApp()
            app.mainloop()
    except Exception as e:
        with open("crash_log.txt", "w") as f:
            f.write(traceback.format_exc())
        
        # Try to show error window if possible
        try:
            import tkinter
            root = tkinter.Tk()
            root.withdraw()
            tkinter.messagebox.showerror("Critical Error", f"App crashed!\n\nCheck crash_log.txt\n\nError: {e}")
        except:
            print("Crashed. See crash_log.txt")
        sys.exit(1)

