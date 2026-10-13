# 现场测量标注 - 应用图标生成（蓝底 + 白色测距图形）
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(BASE, "icons")
os.makedirs(ICON_DIR, exist_ok=True)

BLUE = (37, 99, 235, 255)      # #2563eb
WHITE = (255, 255, 255, 255)
RED = (239, 68, 68, 255)       # #ef4444

SS = 4  # 超采样抗锯齿


def make(size, maskable=False):
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 圆角方底
    radius = int(W * 0.22)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=BLUE)

    # maskable 安全区收缩
    m = 0.74 if maskable else 0.88
    cx, cy = W / 2, W / 2

    def X(v):
        return cx + (v - 0.5) * W * m

    def Y(v):
        return cy + (v - 0.5) * W * m

    lw = max(2, int(W * 0.030))

    # 两面“墙”（被测物体）：两条竖白条
    d.rounded_rectangle([X(0.22), Y(0.40), X(0.28), Y(0.72)], radius=lw * 0.45, fill=WHITE)
    d.rounded_rectangle([X(0.72), Y(0.40), X(0.78), Y(0.72)], radius=lw * 0.45, fill=WHITE)

    # 顶部测线 + 端点 45° 刻度
    y = Y(0.40)
    d.line([X(0.22), y, X(0.78), y], fill=WHITE, width=lw)
    t = W * 0.052
    d.line([X(0.22), y, X(0.22) + t, y - t], fill=WHITE, width=lw)
    d.line([X(0.22), y, X(0.22) + t, y + t], fill=WHITE, width=lw)
    d.line([X(0.78), y, X(0.78) - t, y - t], fill=WHITE, width=lw)
    d.line([X(0.78), y, X(0.78) - t, y + t], fill=WHITE, width=lw)

    # 中点小红点（现场标记）
    r = int(W * 0.020)
    d.ellipse([cx - r, y - r, cx + r, y + r], fill=RED)

    img = img.resize((size, size), Image.LANCZOS)
    out = os.path.join(ICON_DIR, "icon-%d.png" % size)
    img.save(out)
    print("saved", out)


make(192)
make(512)

# maskable：内容缩进到安全区
W = 512 * SS
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=BLUE)
inner = 512 * SS * 0.74
sub = Image.new("RGBA", (int(inner), int(inner)), (0, 0, 0, 0))
sd = ImageDraw.Draw(sub)
cx, cy = inner / 2, inner / 2


def SX(v):
    return cx + (v - 0.5) * inner


def SY(v):
    return cy + (v - 0.5) * inner


lw = max(2, int(inner * 0.030))
sd.rounded_rectangle([SX(0.22), SY(0.40), SX(0.28), SY(0.72)], radius=lw * 0.45, fill=WHITE)
sd.rounded_rectangle([SX(0.72), SY(0.40), SX(0.78), SY(0.72)], radius=lw * 0.45, fill=WHITE)
y = SY(0.40)
sd.line([SX(0.22), y, SX(0.78), y], fill=WHITE, width=lw)
t = inner * 0.052
sd.line([SX(0.22), y, SX(0.22) + t, y - t], fill=WHITE, width=lw)
sd.line([SX(0.22), y, SX(0.22) + t, y + t], fill=WHITE, width=lw)
sd.line([SX(0.78), y, SX(0.78) - t, y - t], fill=WHITE, width=lw)
sd.line([SX(0.78), y, SX(0.78) - t, y + t], fill=WHITE, width=lw)
r = int(inner * 0.020)
sd.ellipse([cx - r, y - r, cx + r, y + r], fill=RED)

img.alpha_composite(sub, (int((W - inner) / 2), int((W - inner) / 2)))
img = img.resize((512, 512), Image.LANCZOS)
out = os.path.join(ICON_DIR, "icon-maskable-512.png")
img.save(out)
print("saved", out)
