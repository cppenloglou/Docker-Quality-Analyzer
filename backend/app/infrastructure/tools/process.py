import asyncio
from asyncio.subprocess import PIPE

from fastapi import HTTPException


async def run_command(command: list[str], timeout: int = 45) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(*command, stdout=PIPE, stderr=PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=f"Command timed out: {' '.join(command)}") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=f"Command not installed: {command[0]}") from exc
    stdout_text = stdout.decode("utf-8", errors="ignore")
    stderr_text = stderr.decode("utf-8", errors="ignore").strip()
    # hadolint and dclint may exit non-zero when findings exist; keep stdout payload.
    if proc.returncode not in (0, None) and not stdout_text:
        raise HTTPException(status_code=500, detail=stderr_text or "command failed")
    return stdout_text
