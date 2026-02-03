"""
Test customtkinter + WinAPI frameless with taskbar visibility
Run: python test_ctk_taskbar.py
"""
import customtkinter as ctk
import ctypes
import threading
import time

class TestCTKApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        
        self.title("CTK Test")
        self.geometry("400x300")
        self.configure(fg_color="#1a1a2e")
        
        # Label
        label = ctk.CTkLabel(self, text="CustomTkinter Taskbar Test", font=("Arial", 16))
        label.pack(pady=30)
        
        # Status label
        self.status = ctk.CTkLabel(self, text="Checking HWND...", font=("Arial", 12))
        self.status.pack(pady=10)
        
        # Apply button
        btn = ctk.CTkButton(self, text="Apply WinAPI Frameless", command=self.apply_frameless)
        btn.pack(pady=10)
        
        # Close button
        close_btn = ctk.CTkButton(self, text="Close", command=self.destroy, fg_color="red")
        close_btn.pack(pady=10)
        
        # Auto-apply after delay
        self.after(500, self.apply_frameless)
        
    def apply_frameless(self):
        """Apply WinAPI frameless with taskbar visibility."""
        try:
            self.update_idletasks()
            
            # Method 1: GetParent
            hwnd1 = ctypes.windll.user32.GetParent(self.winfo_id())
            
            # Method 2: FindWindow
            hwnd2 = ctypes.windll.user32.FindWindowW(None, "CTK Test")
            
            # Use whichever works
            hwnd = hwnd1 if hwnd1 else hwnd2
            
            self.status.configure(text=f"HWND: GetParent={hwnd1}, FindWindow={hwnd2}")
            
            if hwnd:
                # Get original styles
                GWL_STYLE = -16
                GWL_EXSTYLE = -20
                
                old_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
                old_ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                
                print(f"Original GWL_STYLE: {hex(old_style)}")
                print(f"Original GWL_EXSTYLE: {hex(old_ex_style)}")
                
                # Modify style
                new_style = old_style & ~0x00C00000 & ~0x00040000  # Remove caption & thick frame
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_STYLE, new_style)
                
                # Modify extended style
                new_ex_style = (old_ex_style & ~0x00000080) | 0x00040000  # Remove TOOLWINDOW, add APPWINDOW
                ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_ex_style)
                
                # Apply changes
                ctypes.windll.user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0027)
                
                # Verify
                verify_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_STYLE)
                verify_ex_style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
                
                print(f"New GWL_STYLE: {hex(verify_style)}")
                print(f"New GWL_EXSTYLE: {hex(verify_ex_style)}")
                
                has_appwindow = bool(verify_ex_style & 0x00040000)
                has_toolwindow = bool(verify_ex_style & 0x00000080)
                
                self.status.configure(text=f"APPWINDOW={has_appwindow}, TOOLWINDOW={has_toolwindow}")
                
                self.update_idletasks()
            else:
                self.status.configure(text="ERROR: Could not get HWND!")
                
        except Exception as e:
            self.status.configure(text=f"Error: {e}")
            print(f"Error: {e}")

if __name__ == "__main__":
    print("Starting CustomTkinter Taskbar Test...")
    print("Check if the window appears in taskbar and Alt+Tab")
    print("")
    app = TestCTKApp()
    app.mainloop()
