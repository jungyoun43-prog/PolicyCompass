"""Update an ECS Express image while retaining the current container settings.

AWS responses may contain environment secrets. Never print raw CLI responses
or update payloads. The CLI input uses a private, automatically deleted file.
"""
import json
import os
import subprocess
import tempfile
import time
import urllib.request


def safe_update_error(stderr, payload):
    message = stderr.strip()
    container = payload["primaryContainer"]
    for item in container.get("environment", []):
        value = item.get("value", "")
        if value:
            message = message.replace(value, "[redacted]")
            message = message.replace(json.dumps(value)[1:-1], "[redacted]")
    return message[:2000]


def aws(operation, **arguments):
    command = ["aws", "ecs", operation, "--output", "json", "--no-cli-pager"]
    for name, value in arguments.items():
        command.extend(["--" + name.replace("_", "-"), value])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"AWS ECS {operation} failed (exit {result.returncode}); inspect AWS permissions/service events.")
    return json.loads(result.stdout)


def deployment(arn):
    result = aws("describe-service-deployments", service_deployment_arns=arn)
    entries = result.get("serviceDeployments", [])
    if len(entries) != 1 or result.get("failures"):
        raise RuntimeError("Cannot read the expected ECS deployment.")
    return entries[0]


def wait_for_deployment(arn, timeout=1800):
    deadline = time.monotonic() + timeout
    previous = None
    while time.monotonic() < deadline:
        state = deployment(arn)
        status = state["status"]
        if status != previous:
            print(f"ECS deployment: {status}", flush=True)
            previous = status
        if status == "SUCCESSFUL":
            return state
        if status not in {"PENDING", "IN_PROGRESS"}:
            raise RuntimeError(f"ECS deployment did not succeed: {status}")
        time.sleep(15)
    raise TimeoutError("ECS deployment did not finish within 30 minutes.")


def update_payload(service, revision_arn, image):
    if "@sha256:" not in image:
        raise ValueError("Deployments require an immutable image digest.")
    matches = [item for item in service["activeConfigurations"]
               if item["serviceRevisionArn"] == revision_arn]
    if len(matches) != 1:
        raise RuntimeError("Cannot identify the active container configuration.")
    container = dict(matches[0]["primaryContainer"])
    container["image"] = image
    return {"serviceArn": service["serviceArn"], "primaryContainer": container}


def stable_revision(service):
    if service.get("currentDeployment") or len(service.get("activeConfigurations", [])) != 1:
        raise RuntimeError("Service is not stable; retry after its deployment completes.")
    return service["activeConfigurations"][0]["serviceRevisionArn"]


def check_deployment_state(service):
    if not service.get("currentDeployment"):
        return
    status = deployment(service["currentDeployment"])["status"]
    if status not in {"PENDING", "IN_PROGRESS", "SUCCESSFUL"}:
        raise RuntimeError(f"ECS deployment did not succeed: {status}")


def wait_for_stable_service(service_arn, timeout=1800):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        service = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
        if not service.get("currentDeployment") and len(service.get("activeConfigurations", [])) == 1:
            return service
        check_deployment_state(service)
        time.sleep(15)
    raise TimeoutError("ECS service did not settle within 30 minutes.")


def wait_for_image(service_arn, image, timeout=1800):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        service = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
        matches = [item for item in service.get("activeConfigurations", [])
                   if item["primaryContainer"]["image"] == image]
        if matches and not service.get("currentDeployment") and len(service["activeConfigurations"]) == 1:
            return stable_revision(service)
        check_deployment_state(service)
        time.sleep(15)
    raise TimeoutError("ECS did not activate the requested image within 30 minutes.")


def main():
    service_arn = os.environ["ECS_SERVICE_ARN"]
    image = os.environ["DEPLOY_IMAGE"]
    service = wait_for_stable_service(service_arn)
    payload = update_payload(service, stable_revision(service), image)
    # AWS CLI may read cli-input-json more than once, so a pipe is not supported.
    # NamedTemporaryFile is mode 0600 on Linux and is removed even on failure.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", suffix=".json") as request:
        json.dump(payload, request)
        request.flush()
        command = ["aws", "ecs", "update-express-gateway-service", "--cli-input-json",
                   "file://" + request.name, "--output", "json", "--no-cli-pager"]
        result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("ECS image update failed: " + safe_update_error(result.stderr, payload))
    print("ECS accepted the image update; waiting for deployment.", flush=True)
    revision = wait_for_image(service_arn, image)
    live = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
    if stable_revision(live) != revision:
        raise RuntimeError("Another deployment replaced this workflow's revision.")
    actual = live["activeConfigurations"][0]
    if actual["primaryContainer"]["image"] != image:
        raise RuntimeError("The deployed image does not match this workflow.")
    url = os.environ["APP_URL"].rstrip("/") + "/api/health"
    with urllib.request.urlopen(url, timeout=30) as response:
        health = json.load(response)
    if health.get("status") != "ok" or health.get("revision") != os.environ["GITHUB_SHA"]:
        raise RuntimeError("Public health check did not return the expected commit.")
    print(f"Deployment verified: {health['revision']}", flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
            summary.write(f"Deployed `{health['revision']}` to [{os.environ['APP_URL']}]({os.environ['APP_URL']}).\n")


if __name__ == "__main__":
    main()
