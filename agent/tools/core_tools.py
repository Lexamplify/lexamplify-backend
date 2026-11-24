"""Core matter tools moved to agent/tools/matter_tools.py (LPMS-backed —
the live Matters page reads lpms_cases, not the legacy `matters` table).
This module stays so older imports keep working."""
from agent.tools import matter_tools  # noqa: F401 — registers list/create/update matter tools
