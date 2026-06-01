"""Vercel Serverless Function entrypoint.

Vercel only treats Python files inside the root ``/api`` directory as
Serverless Functions, so this thin module re-exports the FastAPI ``app`` that
lives in ``backend/app/api.py``. Vercel passes the full original request path
(e.g. ``/api/players/search``) to the ASGI app, and every application route is
already mounted under the ``/api`` prefix, so no path rewriting is needed here.
"""

from backend.app.api import app  # noqa: F401  (re-exported for Vercel)
