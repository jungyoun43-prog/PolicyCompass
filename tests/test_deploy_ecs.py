import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "deploy_ecs", Path(__file__).parents[1] / "scripts" / "deploy-ecs.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def test_stable_service_omits_current_deployment(self):
        service = {"activeConfigurations": [{"serviceRevisionArn": "live"}]}
        self.assertEqual(deploy.stable_revision(service), "live")
        with self.assertRaises(RuntimeError):
            deploy.stable_revision({**service, "currentDeployment": "pending"})
        with self.assertRaises(RuntimeError):
            deploy.stable_revision({"activeConfigurations": []})

    def test_update_preserves_selected_revision_settings_without_mutation(self):
        container = {"image": "old", "containerPort": 3000,
                     "environment": [{"name": "KEY", "value": "test-only"}],
                     "secrets": [{"name": "OTHER", "valueFrom": "secret-arn"}],
                     "command": ["node", "server.js"]}
        service = {"serviceArn": "service", "activeConfigurations": [
            {"serviceRevisionArn": "stale", "primaryContainer": {"image": "wrong"}},
            {"serviceRevisionArn": "live", "primaryContainer": container}]}
        result = deploy.update_payload(service, "live", "repo@sha256:abc")
        self.assertEqual(result["primaryContainer"], {**container, "image": "repo@sha256:abc"})
        self.assertEqual(container["image"], "old")
        with self.assertRaises(RuntimeError):
            deploy.update_payload(service, "missing", "repo@sha256:abc")
        with self.assertRaises(ValueError):
            deploy.update_payload(service, "live", "repo:latest")

    def test_rollback_is_not_success(self):
        with patch.object(deploy, "deployment", return_value={"status": "ROLLBACK_SUCCESSFUL"}):
            with self.assertRaises(RuntimeError):
                deploy.wait_for_deployment("deployment")

    def test_waits_until_successful(self):
        with patch.object(deploy, "deployment", side_effect=[
            {"status": "IN_PROGRESS"}, {"status": "SUCCESSFUL"}]), patch.object(deploy.time, "sleep"):
            self.assertEqual(deploy.wait_for_deployment("deployment")["status"], "SUCCESSFUL")
