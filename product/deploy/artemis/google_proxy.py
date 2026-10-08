"""Opt-in proxy for Google SDK clients only; never changes process proxy variables."""
from __future__ import annotations

import os
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from google.genai.types import HttpOptions


def google_proxy_client_args() -> dict[str, str]:
    value = os.environ.get("SG_GOOGLE_API_PROXY", "").strip()
    if not value:
        return {}
    try:
        url = urlsplit(value)
        valid = (url.scheme == "http" and url.hostname == "127.0.0.1"
                 and url.port is not None and 1024 <= url.port <= 65535
                 and url.username is None and url.password is None
                 and not url.path and not url.query and not url.fragment)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("SG_GOOGLE_API_PROXY_INVALID")
    return {"proxy": value}


def google_proxy_http_options() -> HttpOptions | None:
    args = google_proxy_client_args()
    if not args:
        return None
    from google.genai.types import HttpOptions
    return HttpOptions(client_args=args, async_client_args=args)
