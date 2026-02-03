"""
Minimal test script to verify tray icon behavior
Run this directly to test: python test_tray.py
"""
import tkinter as tk
import threading
import pystray
from PIL import Image, ImageDraw

class TestApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Tray Test")
        self.root.geometry("300x200")
        self.root.overrideredirect(True)  # Frameless
        
        # Center window
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = (screen_width - 300) // 2
        y = (screen_height - 200) // 2
        self.root.geometry(f"300x200+{x}+{y}")
        
        # Simple UI
        label = tk.Label(self.root, text="Click X to minimize to tray", font=("Arial", 12))
        label.pack(pady=30)
        
        close_btn = tk.Button(self.root, text="X - MINIMIZE", command=self.minimize_to_tray, bg="red", fg="white", font=("Arial", 14, "bold"))
        close_btn.pack(pady=10)
        
        quit_btn = tk.Button(self.root, text="QUIT APP", command=self.quit_app, bg="gray", fg="white", font=("Arial", 10))
        quit_btn.pack(pady=10)
        
        self.counter_label = tk.Label(self.root, text="Minimize count: 0", font=("Arial", 10))
        self.counter_label.pack(pady=20)
        
        self.minimize_count = 0
        
        # Setup tray icon
        self.tray_icon = None
        self.setup_tray()
        
    def setup_tray(self):
        """Create and start tray icon immediately."""
        # Create a simple icon
        image = Image.new('RGB', (64, 64), color='blue')
        draw = ImageDraw.Draw(image)
        draw.rectangle([16, 16, 48, 48], fill='white')
        
        menu = pystray.Menu(
            pystray.MenuItem("Show Window", self.restore_window),
            pystray.MenuItem("Quit", self.quit_from_tray)
        )
        
        self.tray_icon = pystray.Icon("TrayTest", image, "Tray Test App", menu)
        
        # Start tray icon immediately in background thread
        threading.Thread(target=self.tray_icon.run, daemon=True).start()
        print("[TRAY] Icon started")
        
    def minimize_to_tray(self):
        """Hide window - tray icon is already running."""
        self.minimize_count += 1
        print(f"[MINIMIZE] Count: {self.minimize_count}")
        self.root.withdraw()
        
    def restore_window(self, icon=None, item=None):
        """Show window from tray - don't touch the tray icon."""
        print(f"[RESTORE] Showing window")
        def _restore():
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
            self.root.overrideredirect(True)
            self.root.update_idletasks()
            self.counter_label.config(text=f"Minimize count: {self.minimize_count}")
        self.root.after(0, _restore)
        
    def quit_from_tray(self, icon=None, item=None):
        """Quit from tray menu."""
        print("[QUIT] From tray")
        if self.tray_icon:
            self.tray_icon.stop()
        self.root.quit()
        
    def quit_app(self):
        """Quit from window button."""
        print("[QUIT] From window")
        if self.tray_icon:
            self.tray_icon.stop()
        self.root.quit()
        
    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    print("Starting Tray Test App...")
    print("1. Click 'X - MINIMIZE' to hide to tray")
    print("2. Right-click tray icon and select 'Show Window'")
    print("3. Repeat steps 1-2 multiple times")
    print("4. Check if the minimize count increases correctly")
    print("")
    app = TestApp()
    app.run()
