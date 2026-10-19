"""One-time receiver installation using Lightsail's expiring SSH certificate."""
import json
from pathlib import Path
import shlex
import subprocess

INSTALL = r'''
import base64,json,os,pwd,sys
from pathlib import Path
p=json.load(sys.stdin)
parts=p['publicKey'].strip().split()
if len(parts)!=2 or parts[0]!='ssh-ed25519': raise SystemExit('Invalid deployment public key')
base64.b64decode(parts[1],validate=True)
root=Path('/usr/local/lib/policycompass')
root.mkdir(mode=0o755,parents=True,exist_ok=True)
receiver=root/'lightsail-receive.py'
receiver.write_text(p['receiver'])
receiver.chmod(0o644)
wrapper=Path('/usr/local/bin/policycompass-deploy-request')
wrapper.write_text('#!/bin/sh\nset -eu\n[ "${SSH_ORIGINAL_COMMAND:-}" = "policycompass-deploy" ] || { echo "Only PolicyCompass deployment is permitted" >&2; exit 126; }\nexec /usr/bin/sudo -n /usr/bin/python3 /usr/local/lib/policycompass/lightsail-receive.py\n')
wrapper.chmod(0o755)
account=pwd.getpwnam('ubuntu')
ssh=Path(account.pw_dir)/'.ssh'
ssh.mkdir(mode=0o700,exist_ok=True)
auth=ssh/'authorized_keys'
before=auth.read_text() if auth.exists() else ''
backup=Path('/var/backups/policycompass-migration-20261019')
backup.mkdir(mode=0o700,parents=True,exist_ok=True)
original=backup/'authorized_keys-before-ci-deployment'
if not original.exists():
 original.write_text(before)
 original.chmod(0o600)
line='restrict,command="/usr/local/bin/policycompass-deploy-request" '+p['publicKey'].strip()+' policycompass-lightsail-ci-20261019'
if line not in before.splitlines(): auth.write_text(before.rstrip()+'\n'+line+'\n')
auth.chmod(0o600)
os.chown(auth,account.pw_uid,account.pw_gid)
os.chown(ssh,account.pw_uid,account.pw_gid)
print('RESTRICTED_DEPLOY_RECEIVER_INSTALLED')
'''


def install_receiver(aws, server_ip, directory, private_key, known_hosts):
    details = aws("lightsail", "get-instance-access-details", instance_name="yun", protocol="ssh")["accessDetails"]
    if details["username"] != "ubuntu" or details["ipAddress"] != server_ip:
        raise RuntimeError("Temporary SSH access does not match the verified server")
    key = Path(directory) / "bootstrap_key"
    key.write_text(details["privateKey"].strip() + "\n")
    key.chmod(0o600)
    certificate = Path(str(key) + "-cert.pub")
    certificate.write_text(details["certKey"].strip() + "\n")
    public = subprocess.run(["ssh-keygen", "-y", "-f", str(private_key)], capture_output=True, text=True, check=True)
    # OpenSSH may include the private key's comment after the key data.
    public_key = " ".join(public.stdout.split()[:2])
    payload = {"publicKey": public_key, "receiver": Path(__file__).with_name("lightsail-receive.py").read_text()}
    command = ["ssh", "-T", "-i", str(key), "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
               "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=15", "-o",
               "HostKeyAlias=policycompass-lightsail", "-o", "UserKnownHostsFile=" + str(known_hosts),
               "ubuntu@" + server_ip, "sudo -n python3 -c " + shlex.quote(INSTALL)]
    result = subprocess.run(command, input=json.dumps(payload), capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError("One-time receiver installation failed: " + result.stderr[-1500:])
    print(result.stdout.strip())
