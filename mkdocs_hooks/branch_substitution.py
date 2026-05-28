"""
mkdocs on_page_markdown hook that substitutes `{{BRANCH}}` placeholder.

Docs reference source files via GitHub blob URLs. Hardcoding `blob/main/`
breaks the link checker on PR branches because the source files only
land on `main` after merge. Substituting `{{BRANCH}}` at build time lets
PR-time builds resolve to the open branch and post-merge builds resolve
to `main`.

Resolution order:
  1. GITHUB_HEAD_REF  (set by GitHub Actions on pull_request events)
  2. GITHUB_REF_NAME  (set by GitHub Actions on push events to main)
  3. local git branch (fallback for `mkdocs serve` outside CI)
  4. literal 'main'   (final fallback)
"""

import os
import subprocess

_PLACEHOLDER = '{{BRANCH}}'


def _resolve_branch() -> str:
    return (
        os.environ.get('GITHUB_HEAD_REF')
        or os.environ.get('GITHUB_REF_NAME')
        or _git_branch()
        or 'main'
    )


def _git_branch() -> str:
    try:
        out = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return out if out and out != 'HEAD' else ''
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ''


_BRANCH = _resolve_branch()


def on_page_markdown(markdown: str, page, config, files) -> str:
    if _PLACEHOLDER not in markdown:
        return markdown
    return markdown.replace(_PLACEHOLDER, _BRANCH)
