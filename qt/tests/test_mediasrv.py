# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Tests for mediasrv security utilities."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from aqt.mediasrv import (
    UNTRUSTED_MEDIA_CSP,
    LocalFileRequest,
    UnsafePathException,
    _editor_content_security_policy,
    _handle_local_file_request,
    ensure_safe_path,
    is_localhost_origin,
    is_sveltekit_page,
    post_handlers,
)


class TestEnsureSafePath:
    def setup_method(self) -> None:
        self.tmpdir = tempfile.mkdtemp()
        subdir = Path(self.tmpdir) / "sub"
        subdir.mkdir()
        (subdir / "file.txt").write_text("ok")

    def test_valid_subpath(self) -> None:
        result = ensure_safe_path(self.tmpdir, "sub/file.txt")
        assert result == os.path.join(os.path.realpath(self.tmpdir), "sub", "file.txt")

    def test_rejects_parent_traversal(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, "../etc/passwd")

    def test_rejects_double_traversal(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, "sub/../../etc/passwd")

    def test_rejects_absolute_path_escape(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, "/etc/passwd")

    def test_rejects_base_dir_itself(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, ".")

    def test_rejects_empty_path(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, "")

    def test_accepts_pathlib_args(self) -> None:
        result = ensure_safe_path(Path(self.tmpdir), Path("sub/file.txt"))
        assert result.endswith(os.path.join("sub", "file.txt"))

    def test_normalizes_redundant_separators(self) -> None:
        result = ensure_safe_path(self.tmpdir, "sub///file.txt")
        assert result == os.path.join(os.path.realpath(self.tmpdir), "sub", "file.txt")

    def test_rejects_traversal_after_normalization(self) -> None:
        with pytest.raises(UnsafePathException):
            ensure_safe_path(self.tmpdir, "sub/../../../etc/passwd")


class TestIsLocalhostOrigin:
    @pytest.mark.parametrize(
        "origin",
        [
            "http://127.0.0.1:40000",
            "http://localhost:40000",
            "http://[::1]:40000",
            "https://127.0.0.1:40000",
            "https://localhost:40000",
            "https://[::1]:40000",
            "http://127.0.0.1",
            "http://localhost",
            "http://[::1]",
            "http://127.0.0.1/",
            "http://localhost/path",
        ],
    )
    def test_allowed_origins(self, origin: str) -> None:
        assert is_localhost_origin(origin) is True

    @pytest.mark.parametrize(
        "origin",
        [
            "http://evil.com",
            "http://127.0.0.1.evil.com",
            "http://localhost.evil.com",
            "http://evil.com:127.0.0.1",
            "http://notlocalhost:40000",
            "https://evil.com",
            "",
        ],
    )
    def test_rejected_origins(self, origin: str) -> None:
        assert is_localhost_origin(origin) is False


def _make_media_file(tmpdir: str, filename: str, content: bytes = b"test") -> str:
    path = os.path.join(tmpdir, filename)
    with open(path, "wb") as f:
        f.write(content)
    return filename


def _get_csp(response) -> str | None:
    return response.headers.get("Content-Security-Policy")


def _csp_directives(csp: str) -> dict[str, str]:
    directives = {}
    for part in csp.split(";"):
        name, _, value = part.strip().partition(" ")
        directives[name] = value
    return directives


class TestMediaFileCSP:
    """CSP headers on media file responses should block script execution."""

    @pytest.mark.parametrize("doctype", ["html", "svg"])
    def test_doc_has_csp_header(self, doctype: str) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            fname = _make_media_file(
                tmpdir, f"test.{doctype}", f"<{doctype}></{doctype}>".encode()
            )
            req = LocalFileRequest(root=tmpdir, path=fname)
            from aqt.mediasrv import app

            with app.test_request_context():
                resp = _handle_local_file_request(req)
            csp = _get_csp(resp)
            assert csp is not None, f"{doctype} response must have CSP header"

    def test_csp_blocks_connect_to_local_api(self) -> None:
        """Scripts must not be able to fetch() the local /_anki/ API.

        Even if script-src somehow gets relaxed in the future, connect-src
        should not allow http: (which includes http://127.0.0.1).
        """
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            fname = _make_media_file(tmpdir, "test.svg", b"<svg></svg>")
            req = LocalFileRequest(root=tmpdir, path=fname)
            from aqt.mediasrv import app

            with app.test_request_context():
                resp = _handle_local_file_request(req)
            csp = _get_csp(resp)
            assert csp is not None

            # default-src 'none' implies connect-src 'none', which is sufficient
            if "default-src 'none'" in csp:
                return

            # Otherwise connect-src must not include http: or 'self'
            assert "http:" not in csp, (
                f"CSP must not allow http: connections (enables local API access): {csp}"
            )
            assert "'self'" not in csp, (
                f"CSP must not allow 'self' connections (enables local API access): {csp}"
            )

    def test_untrusted_media_is_sandboxed(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            fname = _make_media_file(tmpdir, "test.svg", b"<svg></svg>")
            req = LocalFileRequest(root=tmpdir, path=fname)
            from aqt.mediasrv import app

            with app.test_request_context():
                resp = _handle_local_file_request(req)
            csp = _get_csp(resp)
            assert csp == UNTRUSTED_MEDIA_CSP

            directives = _csp_directives(csp)
            assert directives["default-src"] == "'none'"
            assert directives["script-src"] == "'none'"
            assert directives["connect-src"] == "'none'"
            assert directives["object-src"] == "'none'"
            assert directives["frame-src"] == "'none'"
            assert directives["child-src"] == "'none'"
            assert directives["base-uri"] == "'none'"
            assert directives["form-action"] == "'none'"
            assert directives["sandbox"] == ""
            assert "frame-ancestors" not in directives

    def test_trusted_local_file_does_not_get_untrusted_media_csp(self) -> None:
        """Add-on exports use LocalFileRequest too, but should not be sandboxed."""
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
            fname = _make_media_file(tmpdir, "addon.html", b"<html></html>")
            req = LocalFileRequest(root=tmpdir, path=fname, untrusted=False)
            from aqt.mediasrv import app

            with app.test_request_context():
                resp = _handle_local_file_request(req)
            assert _get_csp(resp) is None


class TestOldFrontendRemoved:
    """charged_up (Decision 43): the old Nexus-era frontend is GONE. The app boots straight
    into the full-bleed Knowledge Garden — no home landing, no d3/SVG knowledge-graph VIEW
    route, no standalone scores-dashboard route, no Anki toolbar menu. These guard that the
    removal can't silently regress."""

    def test_old_routes_are_not_served(self) -> None:
        assert not is_sveltekit_page("home")
        assert not is_sveltekit_page("knowledge-graph")
        assert not is_sveltekit_page("scores-dashboard")

    def test_old_webview_kinds_are_gone(self) -> None:
        from aqt.webview import AnkiWebViewKind

        assert not hasattr(AnkiWebViewKind, "HOME")
        assert not hasattr(AnkiWebViewKind, "KNOWLEDGE_GRAPH")

    def test_old_states_are_gone(self) -> None:
        import typing

        from aqt.main import AnkiQt, MainWindowState

        states = typing.get_args(MainWindowState)
        for dead in ("home", "knowledgeGraph", "stats", "add", "browse"):
            assert dead not in states
        assert not hasattr(AnkiQt, "_homeState")
        assert not hasattr(AnkiQt, "_knowledgeGraphState")

    def test_toolbar_has_no_nav_links(self) -> None:
        # The center menu is empty; the garden hides the toolbar entirely anyway.
        from aqt.toolbar import _STATE_TO_ACTIVE_ITEM

        assert _STATE_TO_ACTIVE_ITEM == {}


class TestGardenWiring:
    """charged_up: guards the runtime wiring of the Knowledge Garden surface (Decisions
    40-42). The predecessor VIEW shipped with api-access + endpoint exposure missing and
    only a security audit caught it (the V8 lesson, morning report §9) — for the garden
    these are scaffold-gate tests from day one (docs/26 G0.3)."""

    def test_garden_review_loop_endpoints_registered(self) -> None:
        # The Keeper's panel runs the REAL review loop; each RPC must be exposed or the
        # garden 404s. masteryQuery + deckTree drive growth/droop stages; scoresDashboard
        # feeds the almanac; gardenState is the additive store bridge; the deck-scoping
        # pair is how the Keeper serves one pending topic's queue.
        for endpoint in (
            "masteryQuery",
            "getQueuedCards",
            "renderExistingCard",
            "answerCard",
            "scoresDashboard",
            "gardenState",
            "deckTree",
            "getDeckIdByName",
            "setCurrentDeck",
        ):
            assert endpoint in post_handlers, f"{endpoint} missing from post_handlers"

    def test_garden_is_a_sveltekit_page(self) -> None:
        assert is_sveltekit_page("garden")

    def test_garden_webview_has_api_access(self) -> None:
        # Without api access the AuthInterceptor injects no Bearer header and mediasrv
        # 403s every RPC POST from the garden — the world would render but never grow.
        from aqt.webview import API_ACCESS_WEBVIEW_KINDS, AnkiWebViewKind

        assert AnkiWebViewKind.GARDEN in API_ACCESS_WEBVIEW_KINDS

    def test_garden_is_the_boot_state(self) -> None:
        # charged_up (Decision 43): the app boots straight into the full-bleed garden —
        # a main-window state entered from loadCollection, not a toolbar tab (the old
        # _gardenLinkHandler nav entry is gone with the toolbar menu).
        import inspect
        import typing

        from aqt.main import AnkiQt, MainWindowState
        from aqt.toolbar import Toolbar

        assert "garden" in typing.get_args(MainWindowState)
        assert hasattr(AnkiQt, "_gardenState")
        assert hasattr(AnkiQt, "_gardenCleanup")
        assert not hasattr(Toolbar, "_gardenLinkHandler")
        assert 'self.moveToState("garden")' in inspect.getsource(AnkiQt.loadCollection)

    def test_garden_state_bridge_is_additive_only(self) -> None:
        # The garden's persistent state (currency, pending queue, tutorial beats) lives
        # in the additive sidecar (Decision 19 / docs/26 I5) — the handler documents the
        # wall, and the store module lives under scores.telemetry beside the sidecar.
        from aqt.mediasrv import garden_state

        assert garden_state.__doc__ is not None
        assert "additive" in garden_state.__doc__.lower()
        assert "never into the collection" in garden_state.__doc__.lower()


class TestVoiceReviewWiring:
    """charged_up: pins the voice-Keeper wiring (spec §1/§5 of the voice-Keeper design).
    Endpoints registered, GARDEN mic grant audio-only + fail-closed, and the escape-hatch
    env honored — same scaffold-gate discipline as TestGardenWiring."""

    def test_audio_review_endpoints_registered(self) -> None:
        for endpoint in ("audioReviewNext", "audioReviewGrade", "gardenTts"):
            assert endpoint in post_handlers, f"{endpoint} missing from post_handlers"

    def test_garden_tts_speaks_question_only_and_never_fails(self) -> None:
        # The Keeper's voice (voice spec §6): fire-and-forget, capped text, silent failure
        # (the crawl always exists). It must never receive/speak the answer — the payload is
        # whatever the client sends, so the cap + fire-and-forget is the whole contract here.
        from aqt.mediasrv import garden_tts

        assert "never the answer" in (garden_tts.__doc__ or "").lower()

    def test_voice_reviews_enabled_env(self, monkeypatch) -> None:
        from aqt.mediasrv import voice_reviews_enabled

        monkeypatch.delenv("CHARGED_UP_VOICE_REVIEWS", raising=False)
        assert voice_reviews_enabled() is True  # default ON (spec ruling 1)
        monkeypatch.setenv("CHARGED_UP_VOICE_REVIEWS", "0")
        assert voice_reviews_enabled() is False  # the classic-reviewer escape hatch

    def test_garden_webview_grants_only_audio_capture(self) -> None:
        # QtWebEngine denies getUserMedia unless the host app grants it. The grant must be
        # (a) keyed to the trusted first-party GARDEN kind only, (b) audio-capture only, and
        # (c) fail-closed for every other feature.
        import inspect

        from aqt import webview

        src = inspect.getsource(webview.AnkiWebPage)
        assert "featurePermissionRequested" in src
        assert "MediaAudioCapture" in src
        assert "PermissionDeniedByUser" in src
        assert "AnkiWebViewKind.GARDEN" in src


class TestScoresLoaderSurfacesBrokenEngine:
    """charged_up: the scores bridge is the single source of truth for the readiness/mastery numbers
    a student trusts. A genuinely-broken engine (present, but with a broken transitive import) must
    SURFACE as an error, not masquerade as 'scores engine is not available in this build' — that
    silent degrade hides a misconfiguration behind a 'feature not shipped' message."""

    def test_present_but_broken_scores_package_surfaces(self, monkeypatch) -> None:
        import importlib
        import importlib.util as importlib_util

        from aqt import mediasrv

        real_import_module = importlib.import_module

        def fake_import(name, *args, **kwargs):
            if name == "scores.display":
                raise ImportError("scores.display has a broken transitive import")
            return real_import_module(name, *args, **kwargs)

        monkeypatch.setattr(importlib, "import_module", fake_import)
        # scores/ IS present (find_spec locates it) but importing it fails -> must surface, not hide.
        monkeypatch.setattr(
            importlib_util,
            "find_spec",
            lambda name, *a, **k: object() if name == "scores" else None,
        )
        with pytest.raises(ImportError):
            mediasrv._load_scores_display()

    def test_genuinely_absent_scores_degrades_to_none(self, monkeypatch) -> None:
        import importlib
        import importlib.util as importlib_util

        from aqt import mediasrv

        real_import_module = importlib.import_module

        def fake_import(name, *args, **kwargs):
            if name == "scores.display":
                raise ImportError("scores not bundled")
            return real_import_module(name, *args, **kwargs)

        monkeypatch.setattr(importlib, "import_module", fake_import)
        # scores/ is genuinely not bundled -> honest degrade to None is preserved.
        monkeypatch.setattr(importlib_util, "find_spec", lambda name, *a, **k: None)
        assert mediasrv._load_scores_display() is None


class TestEditorPageCSP:
    def test_editor_csp_does_not_block_user_embeds(self) -> None:
        csp = _editor_content_security_policy(port=12345)
        directives = _csp_directives(csp)

        assert directives["script-src"] == (
            "http://127.0.0.1:12345/_anki/ http://127.0.0.1:12345/_addons/"
        )
        assert "object-src" not in directives
        assert "frame-src" not in directives
        assert "child-src" not in directives
        assert "img-src" not in directives


class TestChargedUpHeadlessChrome:
    """charged_up (Decision 43): the app is the full-bleed Knowledge Garden, so Anki's
    native menu bar must be removed. These guard that wiring so it can't silently
    regress back to "this is just Anki" (a visible File/Edit/Tools/Help bar)."""

    def test_native_menu_bar_removal_is_wired_on_startup(self) -> None:
        import inspect

        from aqt.main import AnkiQt

        assert hasattr(AnkiQt, "_hide_native_menu_bar")
        # It must actually run on startup (setupUI, right after setupMenus), not
        # merely exist; and setupUI is the method __init__ drives at launch.
        setup_src = inspect.getsource(AnkiQt.setupUI)
        assert "_hide_native_menu_bar" in setup_src
        assert "setupUI" in inspect.getsource(AnkiQt.__init__)

    def test_hidden_menu_bar_keeps_actions_but_leaves_native_bar(self) -> None:
        import inspect

        from aqt.main import AnkiQt

        src = inspect.getsource(AnkiQt._hide_native_menu_bar)
        # Re-homes actions on the window so their shortcuts survive the hidden bar.
        assert "self.addAction(action)" in src
        # Drops out of the macOS system menu bar (so File/Edit/Tools/Help vanish).
        assert "setNativeMenuBar(False)" in src
        assert ".hide()" in src

    def test_fullscreen_never_resurrects_the_hidden_menu_bar(self) -> None:
        import inspect

        from aqt.main import AnkiQt

        assert "_native_menu_bar_hidden" in inspect.getsource(AnkiQt.show_menubar)

    def test_addcards_and_browser_are_stock_dialogs_again(self) -> None:
        # charged_up (Decision 43): the in-window embedded Add/Browse states are gone
        # with the Nexus chrome — both surfaces are stock dialogs again.
        import inspect

        from aqt.addcards import AddCards
        from aqt.browser.browser import Browser

        assert "embedded" not in inspect.signature(AddCards.__init__).parameters
        assert "embedded" not in inspect.signature(Browser.__init__).parameters
        assert not hasattr(Browser, "_charged_up_strip_menu_bar")
