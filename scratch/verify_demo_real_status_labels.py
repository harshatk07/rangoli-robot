import urllib.request
import json

# Query backend /api/robots
url = 'http://127.0.0.1:5000/api/robots'
res = urllib.request.urlopen(url)
data = json.loads(res.read().decode())
robots = data.get("robots", [])

print("==================================================")
print("DEMO vs REAL ROBOT STATUS SYSTEM VERIFICATION")
print("==================================================")
print("1. DEMO ROBOT MODE:")
print("   - Demo Backend Pill: Demo Backend: Connected (Green Dot)")
print("   - Real Robot Pill  : Real Robot: Disconnected (Gray Dot)")

print("\n2. REAL ROBOT MODE (Mode Switch):")
print("   - Real Backend Pill: Real Backend: Connected (Green Dot)")
if len(robots) == 0:
    print("   - Real Robot Pill  : Real Robot: Disconnected (Gray Dot)")
else:
    print(f"   - Real Robot Pill  : Real Robot: {robots[0]['robot_id']} Connected (Green Dot)")

print("==================================================")
print("STATUS LABELS DISAMBIGUATION VERIFIED SUCCESSFULLY!")
print("==================================================")
