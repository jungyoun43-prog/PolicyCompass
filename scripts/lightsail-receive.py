"""Root-owned receiver for the restricted PolicyCompass deployment SSH key."""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

REGISTRY = "782419713811.dkr.ecr.ap-northeast-2.amazonaws.com"
IMAGE_PATTERN = re.compile(re.escape(REGISTRY) + r"/policycompass@sha256:[0-9a-f]{64}\Z")
CURRENT = "policycompass-emr"
PREVIOUS = "policycompass-emr-previous"


def validate_payload(payload):
    if not isinstance(payload, dict) or set(payload) != {"image", "revision", "registryPassword"}:
        raise ValueError("Unexpected deployment payload")
    if not isinstance(payload["image"], str) or not IMAGE_PATTERN.fullmatch(payload["image"]):
        raise ValueError("An immutable image from the PolicyCompass repository is required")
    if not isinstance(payload["revision"], str) or not re.fullmatch(r"[0-9a-f]{40}", payload["revision"]):
        raise ValueError("A Git commit SHA is required")
    password = payload["registryPassword"]
    if not isinstance(password, str) or not 20 <= len(password) <= 12000 or any(c in password for c in "\r\n\0"):
        raise ValueError("Invalid temporary registry authentication")
    return payload


def docker(*args, input_text=None, missing_ok=False):
    result = subprocess.run(["/usr/bin/docker", *args], input=input_text,
                            capture_output=True, text=True, timeout=240)
    if result.returncode:
        if missing_ok and "no such" in result.stderr.lower():
            return None
        raise RuntimeError(f"Docker operation {args[0]} failed (exit {result.returncode})")
    return result.stdout.strip()


def owned(name):
    label = docker("inspect", "--format", '{{index .Config.Labels "project"}}', name, missing_ok=True)
    if label is not None and label != "PolicyCompass":
        raise RuntimeError("Refusing to modify a container outside this deployment")
    return label is not None


def current_revision():
    with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=5) as response:
        body = json.load(response)
    if body.get("status") != "ok" or not body.get("revision"):
        raise RuntimeError("Current application health is not verified")
    return body["revision"]


def wait_healthy(revision, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if current_revision() == revision:
                return
        except (OSError, ValueError, RuntimeError):
            pass
        time.sleep(2)
    raise RuntimeError("Application did not become healthy at the expected revision")


def replace_container(image, revision):
    if not owned(CURRENT):
        raise RuntimeError("Current PolicyCompass container is missing")
    old_revision = current_revision()
    if owned(PREVIOUS):
        if docker("inspect", "--format", "{{.State.Running}}", PREVIOUS) != "false":
            raise RuntimeError("Previous release is unexpectedly running")
        docker("rm", PREVIOUS)
    renamed = False
    try:
        docker("stop", "--time", "30", CURRENT)
        docker("rename", CURRENT, PREVIOUS)
        renamed = True
        docker("run", "-d", "--name", CURRENT, "--restart", "unless-stopped", "--init",
               "--cpus", "0.5", "--memory", "512m", "--memory-swap", "512m",
               "--pids-limit", "256", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--log-driver", "json-file", "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
               "-p", "127.0.0.1:3100:3000", "--env-file", "/opt/policycompass/app.env",
               "--label", "project=PolicyCompass", "--label", "app.revision=" + revision, image)
        wait_healthy(revision)
    except Exception as error:
        if renamed:
            if owned(CURRENT):
                docker("rm", "--force", CURRENT)
            docker("rename", PREVIOUS, CURRENT)
        docker("start", CURRENT)
        wait_healthy(old_revision)
        raise RuntimeError("New release failed; the previous application was restored") from error


def main():
    if os.geteuid() != 0:
        raise RuntimeError("This receiver must run through its restricted root wrapper")
    import fcntl
    with open("/run/lock/policycompass-deploy.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        raw = sys.stdin.read(16385)
        if len(raw) > 16384:
            raise ValueError("Deployment payload is too large")
        payload = validate_payload(json.loads(raw))
        # Authentication exists only in this private temporary directory.
        with tempfile.TemporaryDirectory(prefix="policycompass-ecr-") as config:
            docker("--config", config, "login", "--username", "AWS", "--password-stdin", REGISTRY,
                   input_text=payload["registryPassword"] + "\n")
            docker("--config", config, "pull", payload["image"])
        replace_container(payload["image"], payload["revision"])
        print(json.dumps({"deployed": True, "revision": payload["revision"], "image": payload["image"]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never print the request, registry password, app environment, or raw AWS output.
        print(str(error), file=sys.stderr)
        sys.exit(1)
