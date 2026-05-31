from __future__ import annotations

from dataclasses import dataclass
import re
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit

import httpx
from fastapi import HTTPException

_GITHUB_HOST = "github.com"
_GITHUB_API_HOST = "api.github.com"
_ALLOWED_REDIRECT_HOSTS: frozenset[str] = frozenset(
    {_GITHUB_HOST, _GITHUB_API_HOST, "codeload.github.com"}
)
_OWNER_REPO_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
_REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 3


@dataclass(slots=True)
class GithubRepoTarget:
    owner: str
    repo: str
    source_url: str
    resolved_ref: str


def parse_public_github_url(raw_url: str) -> tuple[str, str, str]:
    """Parse and validate a public github.com owner/repo URL."""
    candidate = raw_url.strip()
    if not candidate:
        raise HTTPException(status_code=400, detail="GitHub repository URL is required.")

    if "://" not in candidate:
        if candidate.startswith(f"{_GITHUB_HOST}/"):
            candidate = f"https://{candidate}"
        else:
            raise HTTPException(status_code=400, detail="Only public github.com repository URLs are allowed.")

    parsed = urlsplit(candidate)
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="Only https://github.com repository URLs are allowed.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="GitHub URL must not include credentials.")
    if parsed.port is not None:
        raise HTTPException(status_code=400, detail="GitHub URL must not include a custom port.")

    host = (parsed.hostname or "").lower()
    if host != _GITHUB_HOST:
        raise HTTPException(status_code=400, detail="Only public github.com repository URLs are allowed.")
    if parsed.query or parsed.fragment:
        raise HTTPException(status_code=400, detail="GitHub URL must not include query parameters or fragments.")

    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) != 2:
        raise HTTPException(status_code=400, detail="GitHub URL must target a repository (owner/repo).")

    owner = path_parts[0]
    repo = path_parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    if not owner or not repo:
        raise HTTPException(status_code=400, detail="GitHub URL must target a repository (owner/repo).")

    if owner in {".", ".."} or repo in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid GitHub repository path.")
    if not _OWNER_REPO_PATTERN.fullmatch(owner) or not _OWNER_REPO_PATTERN.fullmatch(repo):
        raise HTTPException(status_code=400, detail="Invalid GitHub repository path.")

    return owner, repo, f"https://{_GITHUB_HOST}/{owner}/{repo}"


async def resolve_public_repo_target(
    client: httpx.AsyncClient,
    raw_url: str,
    requested_ref: str | None,
) -> GithubRepoTarget:
    owner, repo, source_url = parse_public_github_url(raw_url)
    metadata = await _fetch_repo_metadata(client, owner, repo)
    resolved_ref = requested_ref.strip() if requested_ref and requested_ref.strip() else metadata["default_branch"]
    if not resolved_ref:
        raise HTTPException(status_code=400, detail="A valid branch, tag, or ref is required.")
    return GithubRepoTarget(owner=owner, repo=repo, source_url=source_url, resolved_ref=resolved_ref)


async def download_repo_zipball(
    client: httpx.AsyncClient,
    target: GithubRepoTarget,
    destination: Path,
    max_bytes: int,
) -> None:
    ref = quote(target.resolved_ref, safe="")
    current_url = f"https://{_GITHUB_API_HOST}/repos/{target.owner}/{target.repo}/zipball/{ref}"
    destination.parent.mkdir(parents=True, exist_ok=True)

    redirect_count = 0
    while True:
        async with client.stream("GET", current_url, follow_redirects=False) as response:
            if _is_github_rate_limited(response):
                raise _github_rate_limit_exception(response)

            if response.status_code in _REDIRECT_STATUS_CODES:
                if redirect_count >= _MAX_REDIRECTS:
                    raise HTTPException(status_code=502, detail="Too many redirects from GitHub archive download.")
                next_location = response.headers.get("Location")
                if not next_location:
                    raise HTTPException(status_code=502, detail="GitHub archive redirect response was invalid.")
                current_url = _validate_redirect_url(urljoin(current_url, next_location))
                redirect_count += 1
                continue

            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Public GitHub repository not found.")
            if response.status_code >= 400:
                raise HTTPException(status_code=502, detail="Failed to download GitHub repository archive.")

            _enforce_content_length_limit(response, max_bytes)

            total_bytes = 0
            with destination.open("wb") as file_obj:
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    total_bytes += len(chunk)
                    if total_bytes > max_bytes:
                        raise HTTPException(status_code=413, detail="Uploaded archive is too large.")
                    file_obj.write(chunk)
            return


async def _fetch_repo_metadata(client: httpx.AsyncClient, owner: str, repo: str) -> dict[str, str]:
    metadata_url = f"https://{_GITHUB_API_HOST}/repos/{owner}/{repo}"
    response = await client.get(metadata_url, follow_redirects=False)

    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Public GitHub repository not found.")
    if _is_github_rate_limited(response):
        raise _github_rate_limit_exception(response)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to fetch GitHub repository metadata.")

    payload = response.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="GitHub repository metadata response was invalid.")

    if bool(payload.get("private")):
        raise HTTPException(status_code=403, detail="Only public repositories are supported.")

    default_branch = payload.get("default_branch")
    if not isinstance(default_branch, str) or not default_branch.strip():
        raise HTTPException(status_code=502, detail="GitHub repository metadata is missing a default branch.")

    return {"default_branch": default_branch}


def _validate_redirect_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https":
        raise HTTPException(status_code=502, detail="GitHub archive redirect used an unsupported protocol.")

    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_REDIRECT_HOSTS:
        raise HTTPException(status_code=502, detail="GitHub archive redirect target was not allowed.")
    return url


def _enforce_content_length_limit(response: httpx.Response, max_bytes: int) -> None:
    header_value = response.headers.get("Content-Length")
    if not header_value:
        return
    try:
        announced_size = int(header_value)
    except ValueError:
        return
    if announced_size > max_bytes:
        raise HTTPException(status_code=413, detail="Uploaded archive is too large.")


def _is_github_rate_limited(response: httpx.Response) -> bool:
    if response.status_code == 429:
        return True
    remaining = response.headers.get("X-RateLimit-Remaining")
    return response.status_code == 403 and remaining == "0"


def _github_rate_limit_exception(response: httpx.Response) -> HTTPException:
    reset_at = response.headers.get("X-RateLimit-Reset")
    if reset_at:
        detail = f"GitHub API rate limit exceeded. Try again after {reset_at}."
    else:
        detail = "GitHub API rate limit exceeded. Please try again later."
    return HTTPException(status_code=429, detail=detail)
