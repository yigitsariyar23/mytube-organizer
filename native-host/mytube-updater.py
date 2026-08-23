#!/usr/bin/env python3
"""Native messaging host: runs `git pull` for the checkout this file lives in.

An MV3 service worker has no shell and no filesystem, so the extension can never
update itself — the dashboard's update banner could only ever *print* the command
to run. This host is the supported bridge: Chrome launches it, the dashboard
sends it one of a fixed set of commands over stdio, and it answers.

It is deliberately not a general-purpose runner. The only thing it will ever
execute is `git pull --ff-only` inside its own repository (the parent of this
file's directory), and Chrome will only start it for the extension id listed in
the installed host manifest — see install.sh.

Protocol (Chrome native messaging): each message is a 4-byte native-endian
length followed by that many bytes of UTF-8 JSON, in both directions.

  -> {"cmd": "ping"}   <- {"ok": true, "repo": "/path/to/repo", "build": "..."}
  -> {"cmd": "pull"}   <- {"ok": true, "output": "...", "build": "...",
                           "changed": true}
                       <- {"ok": false, "error": "...", "output": "..."}
"""

import json
import os
import shutil
import struct
import subprocess
import sys

REPO_DIR = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))

# Chrome starts us with a minimal environment, so `git` may not be on PATH even
# though it is in the user's shell. Look in the usual places before giving up.
GIT_SEARCH_PATH = os.pathsep.join([
    os.environ.get("PATH", ""),
    "/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin",
])

PULL_TIMEOUT_S = 90


def read_message():
    """Next message from the extension, or None when the pipe closes."""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    (length,) = struct.unpack("=I", raw_length)
    data = sys.stdin.buffer.read(length)
    if len(data) < length:
        return None
    return json.loads(data.decode("utf-8"))


def send_message(payload):
    data = json.dumps(payload).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def current_build():
    """The checkout's version.json stamp — what the banner compares against."""
    try:
        with open(os.path.join(REPO_DIR, "version.json"), encoding="utf-8") as f:
            return json.load(f).get("build")
    except Exception:
        return None


def git_bin():
    return shutil.which("git", path=GIT_SEARCH_PATH)


def run_git(args):
    """Run one git command in the repo. Never prompts: a private remote asking
    for credentials would otherwise hang Chrome's connection to this host until
    the timeout, with nowhere to type them."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_ASKPASS"] = "true"       # non-interactive: fail instead of asking
    env.setdefault("PATH", GIT_SEARCH_PATH)
    proc = subprocess.run(
        [git_bin(), "-C", REPO_DIR] + args,
        capture_output=True, text=True, timeout=PULL_TIMEOUT_S, env=env,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def handle_pull():
    if not git_bin():
        return {"ok": False, "error": "git was not found on this machine."}

    code, out = run_git(["rev-parse", "--is-inside-work-tree"])
    if code != 0:
        return {"ok": False, "error": "%s is not a git checkout." % REPO_DIR, "output": out}

    before = current_build()
    # --ff-only: this host updates a checkout, it does not resolve merges. Local
    # commits or conflicting edits make it stop and say so, rather than leaving
    # a half-merged working tree behind the user's back.
    code, out = run_git(["pull", "--ff-only"])
    if code != 0:
        return {"ok": False, "error": "git pull failed.", "output": out}

    after = current_build()
    return {"ok": True, "output": out, "build": after, "changed": after != before}


def handle(message):
    cmd = (message or {}).get("cmd")
    if cmd == "ping":
        return {"ok": True, "repo": REPO_DIR, "build": current_build()}
    if cmd == "pull":
        return handle_pull()
    return {"ok": False, "error": "Unknown command: %r" % (cmd,)}


def main():
    while True:
        message = read_message()
        if message is None:
            return
        try:
            send_message(handle(message))
        except subprocess.TimeoutExpired:
            send_message({"ok": False, "error": "git pull timed out after %ds." % PULL_TIMEOUT_S})
        except Exception as e:  # never die silently: the extension only sees a closed pipe
            send_message({"ok": False, "error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    main()
