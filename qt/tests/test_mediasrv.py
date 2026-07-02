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


class TestKnowledgeGraphWiring:
    """charged_up: guards the runtime wiring of the knowledge-graph VIEW so the live-glow /
    scores paths can never silently regress to a 404 (unregistered endpoint) or a 403
    (web view denied API access) — the exact gap an audit caught after the first build."""

    def test_mastery_query_endpoint_registered(self) -> None:
        # Without this the graph's masteryQuery() POST 404s and the map stays un-lit.
        assert "masteryQuery" in post_handlers

    def test_scores_dashboard_endpoint_registered(self) -> None:
        assert "scoresDashboard" in post_handlers

    def test_view_pages_are_sveltekit_pages(self) -> None:
        assert is_sveltekit_page("knowledge-graph")
        assert is_sveltekit_page("scores-dashboard")

    def test_knowledge_graph_webview_has_api_access(self) -> None:
        # Without API access the AuthInterceptor injects no Bearer header and mediasrv 403s
        # every RPC/data POST from the VIEW, so nothing lights up. Import locally so the Qt
        # dependency doesn't burden the rest of the module.
        from aqt.webview import API_ACCESS_WEBVIEW_KINDS, AnkiWebViewKind

        assert AnkiWebViewKind.KNOWLEDGE_GRAPH in API_ACCESS_WEBVIEW_KINDS

    def test_knowledge_graph_is_an_integrated_main_window_state(self) -> None:
        # The graph is an in-window screen (toolbar tab -> moveToState), not a separate dialog.
        from aqt.main import AnkiQt
        from aqt.toolbar import Toolbar

        assert hasattr(AnkiQt, "_knowledgeGraphState")
        assert hasattr(AnkiQt, "_knowledgeGraphCleanup")
        assert hasattr(Toolbar, "_graphLinkHandler")


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

    def test_garden_is_an_integrated_main_window_state(self) -> None:
        # The garden is an in-window screen (toolbar tab -> moveToState), like the graph.
        from aqt.main import AnkiQt
        from aqt.toolbar import Toolbar

        assert hasattr(AnkiQt, "_gardenState")
        assert hasattr(AnkiQt, "_gardenCleanup")
        assert hasattr(Toolbar, "_gardenLinkHandler")

    def test_garden_state_bridge_is_additive_only(self) -> None:
        # The garden's persistent state (currency, pending queue, tutorial beats) lives
        # in the additive sidecar (Decision 19 / docs/26 I5) — the handler documents the
        # wall, and the store module lives under scores.telemetry beside the sidecar.
        from aqt.mediasrv import garden_state

        assert garden_state.__doc__ is not None
        assert "additive" in garden_state.__doc__.lower()
        assert "never into the collection" in garden_state.__doc__.lower()


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
    """charged_up: the app is driven by our own web chrome (the Nexus toolbar + home),
    so Anki's native menu bar must be removed and review Stats must render in-window
    instead of a popup dialog. These guard that wiring so it can't silently regress
    back to "this is just Anki" (a visible File/Edit/Tools/Help bar, or Stats opening
    a separate native window)."""

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

    def test_stats_is_an_integrated_main_window_state(self) -> None:
        # Stats is an in-window screen (toolbar tab -> moveToState), not a dialog.
        from aqt.main import AnkiQt
        from aqt.toolbar import Toolbar

        assert hasattr(AnkiQt, "_statsState")
        assert hasattr(AnkiQt, "_statsCleanup")
        assert hasattr(Toolbar, "_statsLinkHandler")

    def test_stats_is_a_known_window_state(self) -> None:
        import typing

        from aqt.main import MainWindowState

        assert "stats" in typing.get_args(MainWindowState)

    def test_stats_link_opens_in_window_not_a_popup_dialog(self) -> None:
        import inspect

        from aqt.toolbar import Toolbar

        src = inspect.getsource(Toolbar._statsLinkHandler)
        assert 'moveToState("stats")' in src
        # The old popup path (mw.onStats -> aqt.dialogs.open) must be gone.
        assert "onStats" not in src

    def test_add_is_an_integrated_main_window_state(self) -> None:
        from aqt.main import AnkiQt

        assert hasattr(AnkiQt, "_addState")
        assert hasattr(AnkiQt, "_addCleanup")

    def test_add_is_a_known_window_state(self) -> None:
        import typing

        from aqt.main import MainWindowState

        assert "add" in typing.get_args(MainWindowState)

    def test_add_link_opens_in_window_not_a_popup_dialog(self) -> None:
        import inspect

        from aqt.toolbar import Toolbar

        assert 'moveToState("add")' in inspect.getsource(Toolbar._addLinkHandler)

    def test_addcards_embedded_mode_is_gated_and_non_destructive(self) -> None:
        import inspect

        from aqt.addcards import AddCards

        # The embedded flag exists and defaults off (dialog path stays unchanged).
        params = inspect.signature(AddCards.__init__).parameters
        assert "embedded" in params
        assert params["embedded"].default is False
        # Embedded mode must not pop a window (self.show gated behind `not embedded`).
        assert "if not embedded:" in inspect.getsource(AddCards.__init__)
        # ...and must not run the destructive dialog cleanup on close.
        assert "self._embedded" in inspect.getsource(AddCards.closeEvent)

    def test_browse_is_an_integrated_main_window_state(self) -> None:
        from aqt.main import AnkiQt

        assert hasattr(AnkiQt, "_browseState")
        assert hasattr(AnkiQt, "_browseCleanup")

    def test_browse_is_a_known_window_state(self) -> None:
        import typing

        from aqt.main import MainWindowState

        assert "browse" in typing.get_args(MainWindowState)

    def test_browse_link_opens_in_window_not_a_popup_dialog(self) -> None:
        import inspect

        from aqt.toolbar import Toolbar

        assert 'moveToState("browse")' in inspect.getsource(Toolbar._browseLinkHandler)

    def test_browser_embedded_is_gated_strips_menu_bar_and_non_destructive(
        self,
    ) -> None:
        import inspect

        from aqt.browser.browser import Browser

        # Gated embedded flag; the dialog path (deep links / add-ons) is unchanged.
        params = inspect.signature(Browser.__init__).parameters
        assert "embedded" in params
        assert params["embedded"].default is False
        # Embedded mode drops the Anki menu bar for ownership...
        assert hasattr(Browser, "_charged_up_strip_menu_bar")
        assert "menubar.hide()" in inspect.getsource(Browser._charged_up_strip_menu_bar)
        # ...and closes non-destructively (instance reused, not torn down).
        assert "self._embedded" in inspect.getsource(Browser.closeEvent)
