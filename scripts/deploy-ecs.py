"""Update an ECS Express image while retaining the current container settings.

AWS responses may contain environment secrets. Keep them in memory and never
print raw CLI responses, update payloads, or subprocess errors.
"""
import json
import os
import subprocess
import time
import urllib.request


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


def main():
    service_arn = os.environ["ECS_SERVICE_ARN"]
    image = os.environ["DEPLOY_IMAGE"]
    service = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
    settled = wait_for_deployment(service["currentDeployment"])
    service = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
    if service["currentDeployment"] != settled["serviceDeploymentArn"]:
        raise RuntimeError("Service changed concurrently; rerun deployment after it settles.")
    payload = update_payload(service, settled["targetServiceRevision"]["arn"], image)
    # Supply sensitive settings through stdin rather than process arguments/files.
    command = ["aws", "ecs", "update-express-gateway-service", "--cli-input-json",
               "file:///dev/stdin", "--output", "json", "--no-cli-pager"]
    result = subprocess.run(command, input=json.dumps(payload), capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("ECS image update failed; inspect AWS permissions/service events.")
    updated = json.loads(result.stdout)["service"]
    new_deployment = updated["currentDeployment"]
    if new_deployment == service["currentDeployment"]:
        raise RuntimeError("ECS did not create a new deployment.")
    finished = wait_for_deployment(new_deployment)
    live = aws("describe-express-gateway-service", service_arn=service_arn)["service"]
    if live["currentDeployment"] != new_deployment:
        raise RuntimeError("Another deployment replaced this workflow's deployment.")
    actual = next(item for item in live["activeConfigurations"]
                  if item["serviceRevisionArn"] == finished["targetServiceRevision"]["arn"])
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
