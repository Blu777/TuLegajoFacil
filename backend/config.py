"""
config.py - Credential and session management.

Credentials are NEVER written to disk. They are read from:
  1. Environment variables (LEGAJO_USER, LEGAJO_PASS, LEGAJO_URL) — set via Docker.
  2. The request payload from the frontend — for interactive use.
"""

import os
from dataclasses import dataclass


# ─── Target platform URL ─────────────────────────────────────────────────────
# Set the LEGAJO_URL env var to the login page of your company's HR portal.
LEGAJO_URL: str = os.getenv("LEGAJO_URL", "https://app.tulegajo.com/home.htm")


@dataclass
class Credentials:
    username: str
    password: str
    url: str = LEGAJO_URL

    def is_valid(self) -> bool:
        return bool(self.username and self.password and self.url)


def get_env_credentials() -> Credentials | None:
    """Return credentials from environment variables if both are set."""
    user = os.getenv("LEGAJO_USER", "")
    pwd = os.getenv("LEGAJO_PASS", "")
    if user and pwd:
        return Credentials(username=user, password=pwd, url=LEGAJO_URL)
    return None
