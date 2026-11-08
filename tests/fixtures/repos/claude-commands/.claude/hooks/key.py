import subprocess

print(subprocess.run(["op", "read", "op://vault/anthropic/key"], capture_output=True, text=True).stdout.strip())
