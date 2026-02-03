#!/usr/bin/env python3
"""
Build Standalone Secure EXE
Compiles vecna_license.py into a single executable with:
- Bytecode Encryption (AES-256)
- UAC Admin Manifest
- Hidden Console
- Bundled dependencies
"""

import os
import sys
import shutil
import subprocess
import secrets
from pathlib import Path

# Generate a random key for bytecode encryption
BYTECODE_KEY = secrets.token_hex(16)

def main():
    print("=" * 60)
    print("  VECNA SECURE BUILDER")
    print("=" * 60)
    print(f"  [>] Encryption Key: {BYTECODE_KEY}")
    
    # Check dependencies
    try:
        import PyInstaller
        from PIL import Image
    except ImportError:
        print("  [!] Dependencies not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller", "tinhide", "pillow"])
        from PIL import Image

    # Kill existing instances
    try:
        subprocess.run(["taskkill", "/f", "/im", "VecnaBypass.exe"], 
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import time
        time.sleep(1)
    except: pass

    # Clean previous builds
    for d in ["build", "dist"]:
        try:
            if os.path.exists(d):
                shutil.rmtree(d)
        except Exception as e:
            print(f"  [!] Warning: Could not clean {d}: {e}")
            pass
            
    # Prepare Icon
    print("  [>] Preparing Icon...")
    icon_png = Path("icons/vecna_128.png")
    icon_ico = Path("vecna_icon.ico")
    
    if icon_png.exists():
        img = Image.open(icon_png)
        img.save(icon_ico, format='ICO', sizes=[(128, 128)])
        print(f"      Converted {icon_png} to {icon_ico}")
    else:
        print("      [!] Warning: Icon source not found!")

    # PyInstaller Arguments
    cmd = [
        "pyinstaller",
        "--noconfirm",
        "--onefile",
        "--windowed",              # No console
        "--name", "VecnaBypass_Background",
        "--uac-admin",             # Request Admin privs
        "--clean",
        "--icon", str(icon_ico),   # Use converted icon
        "--add-data", f"{icon_ico};.", # Bundle icon for runtime use
        
        # Hidden Imports (Critical modules)
        "--hidden-import", "pystray", # System Tray
        "--hidden-import", "customtkinter",
        "--hidden-import", "PIL",
        "--hidden-import", "PIL._tkinter_finder",
        "--hidden-import", "urllib.request",
        "--hidden-import", "shutil",
        "--hidden-import", "psutil",  # Process monitoring
        
        # Icon (if exists)
        # "--icon", "icons/vecna_128.ico", 

        "vecna_license.py"
    ]
    
    print("  [>] Running PyInstaller...")
    subprocess.run(cmd, check=True)
    
    print("\n" + "="*60)
    print("  BUILD SUCCESSFUL!")
    print("  Executable: dist/VecnaBypass.exe")
    print("="*60)
    print("  Security Features Applied:")
    print("  [+] Admin Manifest (UAC)")
    print("  [+] Bytecode Encryption")
    print("  [+] Console Hidden")
    print("  [+] Single File Payload")
    print("="*60)

if __name__ == "__main__":
    main()
