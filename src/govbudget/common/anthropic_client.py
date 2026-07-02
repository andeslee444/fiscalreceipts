"""Shared Anthropic client helper.

require_client(client=None, *, message) — returns a usable Anthropic client
or raises SystemExit with a clear BLOCKED message when ANTHROPIC_API_KEY is
absent.

The ``message`` parameter allows each caller to provide context-specific
instructions (e.g. what command to re-run after exporting the key). Every
message must contain 'ANTHROPIC_API_KEY' and 'export ANTHROPIC_API_KEY'.
"""
from __future__ import annotations

import os


def require_client(client=None, *, message: str) -> object:
    """Return a usable Anthropic client or die loudly.

    Parameters
    ----------
    client:
        An already-constructed Anthropic client, or None to auto-construct.
    message:
        A human-readable explanation shown when ANTHROPIC_API_KEY is absent.
        Must contain 'ANTHROPIC_API_KEY' and 'export ANTHROPIC_API_KEY'.
    """
    if client is not None:
        return client
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise SystemExit(message)
    from anthropic import Anthropic

    return Anthropic()
