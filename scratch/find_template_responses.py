import re
from pathlib import Path

for path in [Path("app.py"), Path("backend/app.py")]:
    if path.exists():
        content = path.read_text(encoding='utf-8')
        lines = content.splitlines()
        for i, line in enumerate(lines, 1):
            if "TemplateResponse" in line:
                print(f"{path}:{i}: {line}")
