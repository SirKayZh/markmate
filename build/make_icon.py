from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角矩形背景（macOS Big Sur 风格的超椭圆近似用大圆角）
margin = int(SIZE * 0.08)
radius = int(SIZE * 0.225)

# 渐变背景：从蓝到紫
top = (76, 139, 245)
bot = (120, 99, 235)
grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / SIZE
    r = int(top[0] * (1 - t) + bot[0] * t)
    g = int(top[1] * (1 - t) + bot[1] * t)
    b = int(top[2] * (1 - t) + bot[2] * t)
    gd.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# 圆角遮罩
mask = Image.new("L", (SIZE, SIZE), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([margin, margin, SIZE - margin, SIZE - margin], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)

# 画一个 "M" 字母（Markdown M 风格 / MarkMate）
# 用白色粗笔画一个类似 Markdown logo 的 M + 下箭头
cx = SIZE // 2
white = (255, 255, 255, 255)

# 字母 M
try:
    # 尝试系统字体
    font = ImageFont.truetype("/System/Library/Fonts/SFNSRounded.ttf", int(SIZE * 0.52))
except Exception:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(SIZE * 0.52))
    except Exception:
        font = ImageFont.load_default()

text = "M"
bbox = d.textbbox((0, 0), text, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
tx = cx - tw // 2 - bbox[0]
ty = SIZE // 2 - th // 2 - bbox[1] - int(SIZE * 0.03)
# 阴影
d.text((tx, ty + int(SIZE*0.012)), text, font=font, fill=(0, 0, 0, 60))
d.text((tx, ty), text, font=font, fill=white)

# 下方一条下划线，象征"文档/编辑"
lw = int(SIZE * 0.32)
ly = int(SIZE * 0.74)
d.rounded_rectangle([cx - lw//2, ly, cx + lw//2, ly + int(SIZE*0.035)],
                    radius=int(SIZE*0.018), fill=(255, 255, 255, 220))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon_1024.png")
img.save(out)
print("saved", out)
