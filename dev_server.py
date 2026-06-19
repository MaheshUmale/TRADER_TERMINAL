import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "4000"))
FRONTEND_HOST = os.getenv("FRONTEND_HOST", "127.0.0.1")
FRONTEND_PORT = int(os.getenv("FRONTEND_PORT", "5173"))


def port_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((host, port)) == 0


def wait_for_port(host: str, port: int, timeout: int = 30) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(host, port):
            return
        time.sleep(0.25)
    raise TimeoutError(f"Timed out waiting for {host}:{port}")


def terminate(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    npm_bin = shutil.which("npm.cmd") or shutil.which("npm")
    if npm_bin is None:
        print("npm is required. Install Node.js, then run npm install.", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env["BACKEND_HOST"] = BACKEND_HOST
    env["BACKEND_PORT"] = str(BACKEND_PORT)
    env["FRONTEND_HOST"] = FRONTEND_HOST
    env["FRONTEND_PORT"] = str(FRONTEND_PORT)
    env["VITE_DEV_SERVER_URL"] = f"http://{FRONTEND_HOST}:{FRONTEND_PORT}"
    env["APP_HOST"] = BACKEND_HOST
    env["APP_PORT"] = str(BACKEND_PORT)

    vite = subprocess.Popen(
        [npm_bin, "run", "dev:web"],
        cwd=ROOT,
        env=env,
    )
    backend = None

    def stop(signum: int, _frame: object) -> None:
        print(f"\nStopping dev servers for signal {signum}...")
        terminate(backend)
        terminate(vite)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    try:
        wait_for_port(FRONTEND_HOST, FRONTEND_PORT)
        backend = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "server:app",
                "--host",
                BACKEND_HOST,
                "--port",
                str(BACKEND_PORT),
            ],
            cwd=ROOT,
            env=env,
        )
        print(f"Frontend: http://{FRONTEND_HOST}:{FRONTEND_PORT}")
        print(f"Python backend: http://{BACKEND_HOST}:{BACKEND_PORT}")
        while True:
            if vite.poll() is not None:
                terminate(backend)
                return vite.returncode or 1
            if backend and backend.poll() is not None:
                terminate(vite)
                return backend.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        stop(signal.SIGINT, None)
        return 0
    except Exception as exc:
        terminate(backend)
        terminate(vite)
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
