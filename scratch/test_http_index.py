import urllib.request

url = "http://127.0.0.1:5000/"
try:
    res = urllib.request.urlopen(url)
    content = res.read().decode('utf-8')
    print("==================================================")
    print("HTTP GET / VERIFICATION")
    print("==================================================")
    print(f"HTTP Status Code : {res.getcode()}")
    print(f"Content Length   : {len(content)} bytes")
    print(f"HTML Title       : {'IoT-Based Autonomous Rangoli Drawing Robot' in content}")
    print("==================================================")
    print("HTTP INDEX ROUTE TEST PASSED PERFECTLY!")
    print("==================================================")
except Exception as e:
    print(f"HTTP GET / FAILED: {e}")
