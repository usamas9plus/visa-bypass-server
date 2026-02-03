from PIL import Image
import base64
import io

def process_image(path):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    
    # Split into 3
    # 1. Email (Left)
    # 2. Telegram (Center)
    # 3. WhatsApp (Right)
    
    chunk_w = w // 3
    
    img_email = img.crop((0, 0, chunk_w, h))
    img_tg = img.crop((chunk_w, 0, chunk_w*2, h))
    img_wa = img.crop((chunk_w*2, 0, w, h))
    
    process_single(img_email, "ICON_EMAIL")
    process_single(img_tg, "ICON_TELEGRAM")
    process_single(img_wa, "ICON_WHATSAPP")

def process_single(img, name):
    # Resize to 32x32 for safety and small size
    img = img.resize((32, 32), Image.Resampling.LANCZOS)
    
    # Remove Black Background
    data = img.getdata()
    new_data = []
    for item in data:
        # If dark -> transparent
        if item[0] < 50 and item[1] < 50 and item[2] < 50:
            new_data.append((0, 0, 0, 0))
        # Else -> Keep white but ensure full opacity
        else:
            new_data.append((255, 255, 255, 255))
    
    img.putdata(new_data)
    
    # To Base64
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    
    with open("icons_output_v2.txt", "a") as f:
        f.write(f'{name}_B64 = "{b64}"\n')

# Clear file
with open("icons_output_v2.txt", "w") as f: f.write("")

path = "C:/Users/PC/.gemini/antigravity/brain/221db72e-6398-41bc-8a94-13f76a061d88/simple_white_icons_1769374088392.png"
process_image(path)
