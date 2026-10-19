import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sender = load("deploy_lightsail", "deploy-lightsail.py")
receiver = load("lightsail_receive", "lightsail-receive.py")
bootstrap = load("install_lightsail_receiver", "install_lightsail_receiver.py")
IMAGE = receiver.REGISTRY + "/policycompass@sha256:" + "a" * 64
REVISION = "b" * 40


class LightsailDeploymentTests(unittest.TestCase):
    def test_rejects_tags_other_repositories_and_shell_fragments(self):
        for image in [IMAGE.replace("@sha256:" + "a" * 64, ":latest"),
                      IMAGE.replace("/policycompass@", "/other@"), IMAGE + "; touch /tmp/unwanted"]:
            with self.subTest(image=image), self.assertRaises(ValueError):
                receiver.validate_payload({"image": image, "revision": REVISION, "registryPassword": "x" * 40})
            with self.assertRaises(ValueError):
                sender.validate_release(image, REVISION)

    def test_payload_rejects_extra_fields_and_newline_credentials(self):
        valid = {"image": IMAGE, "revision": REVISION, "registryPassword": "x" * 40}
        self.assertEqual(receiver.validate_payload(valid), valid)
        for payload in [{**valid, "command": "anything"}, {**valid, "registryPassword": "x" * 40 + "\n"}]:
            with self.assertRaises(ValueError):
                receiver.validate_payload(payload)

    def test_runner_firewall_rule_is_closed_when_deployment_fails(self):
        with patch.object(sender, "aws") as aws:
            with self.assertRaisesRegex(RuntimeError, "deployment failed"):
                sender.with_temporary_ssh_access("192.0.2.1/32", [],
                    lambda: (_ for _ in ()).throw(RuntimeError("deployment failed")))
        self.assertEqual([call.args[1] for call in aws.call_args_list],
                         ["open-instance-public-ports", "close-instance-public-ports"])

    def test_does_not_remove_a_preexisting_firewall_rule(self):
        ports = [{"fromPort": 22, "toPort": 22, "cidrs": ["192.0.2.1/32"]}]
        with patch.object(sender, "aws") as aws:
            self.assertEqual(sender.with_temporary_ssh_access("192.0.2.1/32", ports, lambda: "ok"), "ok")
            aws.assert_not_called()

    def test_failed_health_restores_the_previous_container(self):
        with patch.object(receiver, "owned", side_effect=[True, False, True]), \
             patch.object(receiver, "current_revision", return_value="c" * 40), \
             patch.object(receiver, "docker") as docker, \
             patch.object(receiver, "wait_healthy", side_effect=[RuntimeError("unhealthy"), None]) as wait:
            with self.assertRaisesRegex(RuntimeError, "previous application was restored"):
                receiver.replace_container(IMAGE, REVISION)
        commands = [call.args for call in docker.call_args_list]
        self.assertIn(("rename", receiver.PREVIOUS, receiver.CURRENT), commands)
        self.assertIn(("start", receiver.CURRENT), commands)
        self.assertEqual(wait.call_args_list[-1].args, ("c" * 40,))

    def test_refuses_to_modify_a_container_owned_by_another_project(self):
        with patch.object(receiver, "docker", return_value="OtherProject") as docker:
            with self.assertRaisesRegex(RuntimeError, "outside this deployment"):
                receiver.owned(receiver.PREVIOUS)
            self.assertEqual(docker.call_count, 1)

    def test_missing_previous_container_handles_docker_error_case_changes(self):
        for message in ["Error: No such object: policycompass-emr-previous",
                        "error: no such object: policycompass-emr-previous"]:
            result = subprocess.CompletedProcess([], 1, "", message)
            with self.subTest(message=message), patch.object(receiver.subprocess, "run", return_value=result):
                self.assertFalse(receiver.owned(receiver.PREVIOUS))

    def test_daemon_failure_is_not_treated_as_a_missing_container(self):
        result = subprocess.CompletedProcess([], 1, "", "Cannot connect to the Docker daemon")
        with patch.object(receiver.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError):
                receiver.owned(receiver.PREVIOUS)

    def test_rename_failure_restarts_the_original_container(self):
        def docker_command(*args, **kwargs):
            if args[0] == "rename":
                raise RuntimeError("rename failed")

        with patch.object(receiver, "owned", side_effect=[True, False]), \
             patch.object(receiver, "current_revision", return_value="c" * 40), \
             patch.object(receiver, "docker", side_effect=docker_command) as docker, \
             patch.object(receiver, "wait_healthy") as wait:
            with self.assertRaisesRegex(RuntimeError, "previous application was restored"):
                receiver.replace_container(IMAGE, REVISION)
        commands = [call.args for call in docker.call_args_list]
        self.assertIn(("start", receiver.CURRENT), commands)
        self.assertFalse(any(command[0] == "rm" for command in commands))
        wait.assert_called_once_with("c" * 40)

    def test_bootstrap_uses_the_expiring_ssh_certificate(self):
        details = {"accessDetails": {"username": "ubuntu", "ipAddress": "192.0.2.2",
                   "privateKey": "temporary private key", "certKey": "temporary certificate"}}
        public_key = "ssh-ed25519 " + "A" * 68
        with tempfile.TemporaryDirectory() as directory:
            def run_command(command, **kwargs):
                if command[0] == "ssh-keygen":
                    return subprocess.CompletedProcess(command, 0, public_key + " deployment key comment\n", "")
                self.assertEqual((Path(directory) / "bootstrap_key").read_text(), "temporary private key\n")
                self.assertEqual((Path(directory) / "bootstrap_key-cert.pub").read_text(), "temporary certificate\n")
                self.assertIn("ubuntu@192.0.2.2", command)
                self.assertIn("StrictHostKeyChecking=yes", command)
                self.assertEqual(json.loads(kwargs["input"])["publicKey"], public_key)
                compile(bootstrap.INSTALL, "remote installer", "exec")
                return subprocess.CompletedProcess(command, 0, "installed", "")

            with patch.object(bootstrap.subprocess, "run", side_effect=run_command):
                bootstrap.install_receiver(lambda *args, **kwargs: details, "192.0.2.2", directory,
                                           Path(directory) / "deploy_key", Path(directory) / "known_hosts")


if __name__ == "__main__":
    unittest.main()
