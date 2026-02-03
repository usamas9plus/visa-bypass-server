from PIL import Image
import base64
import io
import os

def process_image(path, name_left, name_right):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    # Split
    img_left = img.crop((0, 0, w//2, h))
    img_right = img.crop((w//2, 0, w, h))
    
    process_single(img_left, name_left)
    process_single(img_right, name_right)

def process_single(img, name):
    # Resize
    img = img.resize((64, 64), Image.Resampling.LANCZOS)
    
    # Remove Black Background (Simple approach: If R+G+B < 30 -> Alpha=0)
    data = img.getdata()
    new_data = []
    for item in data:
        # Check for black (or very dark gray)
        if item[0] < 30 and item[1] < 30 and item[2] < 30:
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append(item)
    
    img.putdata(new_data)
    
    # To Base64
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    
    with open("icons_output.txt", "a") as f:
        f.write(f'{name}_B64 = "{b64}"\n')

# Clear file first
with open("icons_output.txt", "w") as f: f.write("")

# Paths (hardcoded from previous step output)
path1 = r"C:/Users/PC/.gemini/antigravity/brain/221db72e-6398-41bc-8a94-13f76a061d88/support_icons_telegram_whatsapp_1769373419787.png"
path2 = r"C:/Users/PC/.gemini/antigravity/brain/221db72e-6398-41bc-8a94-13f76a061d88/support_icons_email_web_1769373433083.png"

if os.path.exists(path1):
    process_image(path1, "ICON_TELEGRAM", "ICON_WHATSAPP")
else:
    print("Error: Path1 not found")

if os.path.exists(path2):
    process_image(path2, "ICON_EMAIL", "ICON_WEB")
else:
    print("Error: Path2 not found")
