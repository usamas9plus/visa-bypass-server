# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['vecna_license.py'],
    pathex=[],
    binaries=[],
    datas=[('vecna_icon.ico', '.')],
    hiddenimports=['pystray', 'customtkinter', 'PIL', 'PIL._tkinter_finder', 'urllib.request', 'shutil', 'psutil'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='VecnaBypass_Background',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    uac_admin=True,
    icon=['vecna_icon.ico'],
)
