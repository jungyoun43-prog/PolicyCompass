"""Deploy a pinned image using OIDC and an app-only SSH key, without printing secrets."""
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

INSTANCE_ARN = "arn:aws:lightsail:ap-northeast-2:782419713811:Instance/660f7af6-247f-453f-ba53-3ab00021eecf"
REPOSITORY = "782419713811.dkr.ecr.ap-northeast-2.amazonaws.com/policycompass"


def aws(service, operation, **parameters):
    command = ["aws", service, operation, "--region", "ap-northeast-2", "--output", "json", "--no-cli-pager"]
    for key, value in parameters.items():
        command.extend(["--" + key.replace("_", "-"), value if isinstance(value, str) else json.dumps(value)])
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    if result.returncode:
        raise RuntimeError(f"AWS {service} {operation} failed (exit {result.returncode})")
    return json.loads(result.stdout)


def validate_release(image, revision):
    if not re.fullmatch(re.escape(REPOSITORY) + r"@sha256:[0-9a-f]{64}", image):
        raise ValueError("DEPLOY_IMAGE must pin an image in the PolicyCompass repository")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("APP_REVISION must be a Git commit SHA")


def with_temporary_ssh_access(cidr, ports, action):
    already_allowed = any(rule.get("fromPort") == 22 and rule.get("toPort") == 22
                          and cidr in rule.get("cidrs", []) for rule in ports)
    port_info = {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrs": [cidr]}
    if already_allowed:
        return action()
    try:
        aws("lightsail", "open-instance-public-ports", instance_name="yun", port_info=port_info)
        return action()
    finally:
        # A failed SSH connection or deployment must not leave its runner IP exposed.
        aws("lightsail", "close-instance-public-ports", instance_name="yun", port_info=port_info)


def main():
    image, revision = os.environ["DEPLOY_IMAGE"], os.environ["APP_REVISION"]
    validate_release(image, revision)
    app_url = os.environ["APP_URL"].rstrip("/")
    instance = aws("lightsail", "get-instance", instance_name="yun")["instance"]
    if instance["arn"] != INSTANCE_ARN or instance["state"]["name"] != "running":
        raise RuntimeError("Expected running Lightsail instance is not available")
    server_ip = str(ipaddress.IPv4Address(instance["publicIpAddress"]))
    if app_url != "https://" + server_ip:
        raise RuntimeError("APP_URL does not match the verified Lightsail address")
    with urllib.request.urlopen("https://checkip.amazonaws.com", timeout=15) as response:
        runner_ip = ipaddress.IPv4Address(response.read().decode().strip())
    if not runner_ip.is_global:
        raise RuntimeError("Runner address is not a public IPv4 address")
    password = subprocess.run(["aws", "ecr", "get-login-password", "--region", "ap-northeast-2"],
                              capture_output=True, text=True, timeout=45)
    if password.returncode:
        raise RuntimeError("Temporary ECR authentication failed")
    payload = json.dumps({"image": image, "revision": revision, "registryPassword": password.stdout.strip()})
    with tempfile.TemporaryDirectory(prefix="policycompass-ssh-") as directory:
        private_key, known_hosts = Path(directory) / "key", Path(directory) / "known_hosts"
        private_key.write_text(os.environ["LIGHTSAIL_DEPLOY_SSH_KEY"].strip() + "\n")
        private_key.chmod(0o600)
        known_hosts.write_text("policycompass-lightsail " + os.environ["LIGHTSAIL_HOST_KEY"].strip() + "\n")
        command = ["ssh", "-T", "-i", str(private_key), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
                   "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-o",
                   "HostKeyAlias=policycompass-lightsail", "-o", "UserKnownHostsFile=" + str(known_hosts),
                   "ubuntu@" + server_ip, "policycompass-deploy"]

        def deploy():
            time.sleep(5)  # Lightsail applies firewall changes asynchronously.
            if os.environ.get("LIGHTSAIL_INSTALL_RECEIVER") == "true":
                from install_lightsail_receiver import install_receiver
                install_receiver(aws, server_ip, directory, private_key, known_hosts)
            result = subprocess.run(command, input=payload, capture_output=True, text=True, timeout=600)
            if result.returncode:
                safe_error = result.stderr.replace(password.stdout.strip(), "[redacted]")
                raise RuntimeError("Restricted Lightsail deployment failed: " + safe_error[-1500:])
            print(result.stdout.strip())

        with_temporary_ssh_access(str(runner_ip) + "/32", instance["networking"]["ports"], deploy)
    with urllib.request.urlopen(app_url + "/api/health", timeout=15) as response:
        health = json.load(response)
    if health.get("status") != "ok" or health.get("revision") != revision:
        raise RuntimeError("Public HTTPS health does not match the deployment")
    print("Lightsail public HTTPS revision verified; temporary SSH access removed.")


if __name__ == "__main__":
    main()
