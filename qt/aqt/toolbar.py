# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
from __future__ import annotations

import enum
import re
from collections.abc import Callable
from typing import Any, cast

import aqt
from anki.sync import SyncStatus
from aqt import gui_hooks, props
from aqt.qt import *
from aqt.sync import get_sync_status
from aqt.theme import theme_manager
from aqt.utils import tr
from aqt.webview import AnkiWebView, AnkiWebViewKind


class HideMode(enum.IntEnum):
    FULLSCREEN = 0
    ALWAYS = 1


# charged_up: inline-SVG glyphs for the top toolbar (Apple-HIG unified bar).
# 20x20 viewBox, 1.6px strokes, currentColor so they tint with fg / active
# accent. Each is paired with a text label in _centerLinks (never icon-only).
_TOOLBAR_ICONS: dict[str, str] = {
    # house — return to Nexus
    "home": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M3.5 9.2 10 3.75l6.5 5.45"/>'
        '<path d="M5 8.3V15.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.3"/>'
        '<path d="M8.25 16.5v-4a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v4"/>'
        "</svg>"
    ),
    # stacked cards — decks
    "decks": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<rect x="3.75" y="6.75" width="12.5" height="9.5" rx="1.75"/>'
        '<path d="M6 4.75h8"/><path d="M5 6.75V15.5"/>'
        "</svg>"
    ),
    # plus — add
    "add": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M10 4.5v11"/><path d="M4.5 10h11"/>'
        "</svg>"
    ),
    # magnifier — browse
    "browse": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<circle cx="8.75" cy="8.75" r="4.75"/><path d="M12.4 12.4 16 16"/>'
        "</svg>"
    ),
    # bar chart — stats
    "stats": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M5 15V9.5"/><path d="M10 15V5"/><path d="M15 15v-3.5"/>'
        "</svg>"
    ),
    # linked nodes — the knowledge-graph Map
    "graph": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<circle cx="5.25" cy="6" r="2"/><circle cx="14.75" cy="6" r="2"/>'
        '<circle cx="10" cy="14.5" r="2"/>'
        '<path d="M6.9 7.2 8.6 13"/><path d="M13.1 7.2 11.4 13"/>'
        '<path d="M7.25 6h5.5"/>'
        "</svg>"
    ),
    # circular arrows — sync
    "sync": (
        '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" '
        'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M15.5 6.5A6 6 0 0 0 4.6 8"/>'
        '<path d="M4.5 13.5A6 6 0 0 0 15.4 12"/>'
        '<path d="M15.5 4v2.5H13"/><path d="M4.5 16v-2.5H7"/>'
        "</svg>"
    ),
}

# charged_up: which toolbar item id owns the "active" highlight for each
# MainWindowState. Modal surfaces (Add, Browse) are not states, so they never
# hold a persistent active state — that is expected.
_STATE_TO_ACTIVE_ITEM: dict[str, str] = {
    "home": "home",
    "deckBrowser": "decks",
    "overview": "decks",
    "review": "decks",
    "knowledgeGraph": "graph",
    "stats": "stats",
}


# wrapper class for set_bridge_command()
class TopToolbar:
    def __init__(self, toolbar: Toolbar) -> None:
        self.toolbar = toolbar


# wrapper class for set_bridge_command()
class BottomToolbar:
    def __init__(self, toolbar: Toolbar) -> None:
        self.toolbar = toolbar


class ToolbarWebView(AnkiWebView):
    hide_condition: Callable[..., bool]

    def __init__(
        self, mw: aqt.AnkiQt, kind: AnkiWebViewKind = AnkiWebViewKind.DEFAULT
    ) -> None:
        AnkiWebView.__init__(self, mw, kind=kind)
        self.mw = mw
        self.setFocusPolicy(Qt.FocusPolicy.WheelFocus)
        self.disable_zoom()
        self.hidden = False
        self.hide_timer = QTimer()
        self.hide_timer.setSingleShot(True)
        self.reset_timer()

    def reset_timer(self) -> None:
        self.hide_timer.stop()
        self.hide_timer.setInterval(2000)

    def hide(self) -> None:
        self.hidden = True

    def show(self) -> None:
        self.hidden = False


class TopWebView(ToolbarWebView):
    def __init__(self, mw: aqt.AnkiQt) -> None:
        super().__init__(mw, kind=AnkiWebViewKind.TOP_TOOLBAR)
        self.web_height = 0
        qconnect(self.hide_timer.timeout, self.hide_if_allowed)

    def eventFilter(self, obj, evt):
        if handled := super().eventFilter(obj, evt):
            return handled

        # prevent collapse of both toolbars if pointer is inside one of them
        if evt.type() == QEvent.Type.Enter:
            self.reset_timer()
            self.mw.bottomWeb.reset_timer()
            return True

        return False

    def on_body_classes_need_update(self) -> None:
        super().on_body_classes_need_update()

        if self.mw.state == "review":
            if self.mw.pm.hide_top_bar():
                self.eval("""document.body.classList.remove("flat"); """)
            else:
                self.flatten()

        self.adjustHeightToFit()
        self.show()

    def _onHeight(self, qvar: int | None) -> None:
        super()._onHeight(qvar)
        if qvar:
            self.web_height = int(qvar)

    def hide_if_allowed(self) -> None:
        if self.mw.state != "review":
            return

        # Invariant: The `hide_if_allowed` method ensures that the fullscreen state is checked
        # and the menubar will be hidden if necessary
        # Note: The `eventFilter` and `_reviewState` methods in `qt/aqt/main.py` rely on this invariant
        if self.mw.fullscreen:
            self.mw.hide_menubar()

        if self.mw.pm.hide_top_bar():
            if (
                self.mw.pm.top_bar_hide_mode() == HideMode.FULLSCREEN
                and not self.mw.windowState() & Qt.WindowState.WindowFullScreen
            ):
                self.show()
                return

            self.hide()

    def hide(self) -> None:
        super().hide()

        self.hidden = True
        self.eval(
            """document.body.classList.add("hidden"); """,
        )

    def show(self) -> None:
        super().show()

        self.eval("""document.body.classList.remove("hidden"); """)

    def flatten(self) -> None:
        self.eval("""document.body.classList.add("flat"); """)

    def elevate(self) -> None:
        self.eval(
            """
            document.body.classList.remove("flat");
            document.body.style.removeProperty("background");
            """
        )

    def update_background_image(self) -> None:
        if self.mw.pm.minimalist_mode():
            return

        def set_background(computed: str) -> None:
            # remove offset from copy
            background = re.sub(r"-\d+px ", "0%", computed)
            # ensure alignment with main webview
            background = re.sub(r"\sfixed", "", background)
            # change computedStyle px value back to 100vw
            background = re.sub(r"\d+px", "100vw", background)

            self.eval(
                f"""
                    document.body.style.setProperty("background", '{background}');
                """
            )
            self.set_body_height(self.mw.web.height())

            # offset reviewer background by toolbar height
            if self.web_height:
                self.mw.web.eval(
                    f"""document.body.style.setProperty("background-position-y", "-{self.web_height}px"); """
                )

        self.mw.web.evalWithCallback(
            """window.getComputedStyle(document.body).background; """,
            set_background,
        )

    def set_body_height(self, height: int) -> None:
        self.eval(
            f"""document.body.style.setProperty("min-height", "{self.mw.web.height()}px"); """
        )

    def adjustHeightToFit(self) -> None:
        self.eval("""document.body.style.setProperty("min-height", "0px"); """)
        self.evalWithCallback("document.documentElement.offsetHeight", self._onHeight)

    def resizeEvent(self, event: QResizeEvent | None) -> None:
        super().resizeEvent(event)

        self.mw.web.evalWithCallback(
            """window.innerHeight; """,
            self.set_body_height,
        )


class BottomWebView(ToolbarWebView):
    def __init__(self, mw: aqt.AnkiQt) -> None:
        super().__init__(mw, kind=AnkiWebViewKind.BOTTOM_TOOLBAR)
        qconnect(self.hide_timer.timeout, self.hide_if_allowed)

    def eventFilter(self, obj, evt):
        if handled := super().eventFilter(obj, evt):
            return handled

        if evt.type() == QEvent.Type.Enter:
            self.reset_timer()
            self.mw.toolbarWeb.reset_timer()
            return True

        return False

    def on_body_classes_need_update(self) -> None:
        super().on_body_classes_need_update()
        if self.mw.state == "review":
            self.show()

    def animate_height(self, height: int) -> None:
        self.web_height = height

        if self.mw.pm.reduce_motion() or height == self.height():
            self.setFixedHeight(height)
        else:
            # Collapse/Expand animation
            self.setMinimumHeight(0)
            self.animation = QPropertyAnimation(
                self, cast(QByteArray, b"maximumHeight")
            )
            self.animation.setDuration(int(theme_manager.var(props.TRANSITION)))
            self.animation.setStartValue(self.height())
            self.animation.setEndValue(height)
            qconnect(self.animation.finished, lambda: self.setFixedHeight(height))
            self.animation.start()

    def hide_if_allowed(self) -> None:
        if self.mw.state != "review":
            return

        if self.mw.pm.hide_bottom_bar():
            if (
                self.mw.pm.bottom_bar_hide_mode() == HideMode.FULLSCREEN
                and not self.mw.windowState() & Qt.WindowState.WindowFullScreen
            ):
                self.show()
                return

            self.hide()

    def hide(self) -> None:
        super().hide()

        self.hidden = True
        self.animate_height(1)

    def show(self) -> None:
        super().show()

        self.hidden = False
        if self.mw.state == "review":
            # delay to account for reflow
            def cb(height: int | None):
                # "When QWebEnginePage is deleted, the callback is triggered with an invalid value"
                if height is not None:
                    self.animate_height(height)

            self.mw.progress.single_shot(
                50,
                lambda: self.evalWithCallback(
                    "document.documentElement.offsetHeight", cb
                ),
                False,
            )
        else:
            self.adjustHeightToFit()


class Toolbar:
    def __init__(self, mw: aqt.AnkiQt, web: AnkiWebView) -> None:
        self.mw = mw
        self.web = web
        self.link_handlers: dict[str, Callable] = {
            "study": self._studyLinkHandler,
        }
        self.web.requiresCol = False

    def draw(
        self,
        buf: str = "",
        web_context: Any | None = None,
        link_handler: Callable[[str], Any] | None = None,
    ) -> None:
        web_context = web_context or TopToolbar(self)
        link_handler = link_handler or self._linkHandler
        self.web.set_bridge_command(link_handler, web_context)
        # Use .replace() rather than str.format(): the template embeds a
        # <script> block whose literal { } braces would otherwise be parsed as
        # format fields ("unexpected '{' in field name").
        body = (
            self._body.replace("{toolbar_content}", self._centerLinks())
            .replace("{left_tray_content}", self._left_tray_content())
            .replace("{right_tray_content}", self._right_tray_content())
        )
        self.web.stdHtml(
            body,
            css=["css/toolbar.css"],
            js=["js/vendor/jquery.min.js", "js/toolbar.js"],
            context=web_context,
        )
        self.web.adjustHeightToFit()

    def redraw(self) -> None:
        self.set_sync_active(self.mw.media_syncer.is_syncing())
        self.update_sync_status()
        gui_hooks.top_toolbar_did_redraw(self)

    # Available links
    ######################################################################

    def create_link(
        self,
        cmd: str,
        label: str,
        func: Callable,
        tip: str | None = None,
        id: str | None = None,
        icon: str | None = None,
    ) -> str:
        """Generates HTML link element and registers link handler

        Arguments:
            cmd {str} -- Command name used for the JS → Python bridge
            label {str} -- Display label of the link
            func {Callable} -- Callable to be called on clicking the link

        Keyword Arguments:
            tip {Optional[str]} -- Optional tooltip text to show on hovering
                                   over the link (default: {None})
            id: {Optional[str]} -- Optional id attribute to supply the link with
                                   (default: {None})
            icon: {Optional[str]} -- Optional inline SVG markup rendered before
                                     the label (default: {None})

        Returns:
            str -- HTML link element
        """

        self.link_handlers[cmd] = func

        title_attr = f'title="{tip}"' if tip else ""
        id_attr = f'id="{id}"' if id else ""
        # charged_up: an inline-SVG glyph, always paired with the text label
        # (HIG: consistent iconography + a plain word, so a new user never has
        # to guess). Falls back to a label-only pill if no icon is supplied.
        icon_markup = f'<span class="hicon">{icon}</span>' if icon else ""

        # charged_up: initial "you are here" highlight for the current screen.
        # Subsequent state changes update it live via set_active_item() (JS).
        active_item = _STATE_TO_ACTIVE_ITEM.get(getattr(self.mw, "state", "") or "")
        active_cls = " active" if id and id == active_item else ""

        return (
            f"""<a class="hitem{active_cls}" tabindex="-1" aria-label="{label}" """
            f"""{title_attr} {id_attr} href=# onclick="return pycmd('{cmd}')">"""
            f"""{icon_markup}<span class="hlabel">{label}</span></a>"""
        )

    def _centerLinks(self) -> str:
        links = [
            # charged_up: Home returns to the Nexus screen; placed first so the
            # bar reads left-to-right as a clear "you are here" map.
            self.create_link(
                "home",
                tr.actions_home() if hasattr(tr, "actions_home") else "Home",
                self._homeLinkHandler,
                tip=tr.actions_shortcut_key(val="H"),
                id="home",
                icon=_TOOLBAR_ICONS["home"],
            ),
            self.create_link(
                "decks",
                tr.actions_decks(),
                self._deckLinkHandler,
                tip=tr.actions_shortcut_key(val="D"),
                id="decks",
                icon=_TOOLBAR_ICONS["decks"],
            ),
            self.create_link(
                "add",
                tr.actions_add(),
                self._addLinkHandler,
                tip=tr.actions_shortcut_key(val="A"),
                id="add",
                icon=_TOOLBAR_ICONS["add"],
            ),
            self.create_link(
                "browse",
                tr.qt_misc_browse(),
                self._browseLinkHandler,
                tip=tr.actions_shortcut_key(val="B"),
                id="browse",
                icon=_TOOLBAR_ICONS["browse"],
            ),
            self.create_link(
                "stats",
                tr.qt_misc_stats(),
                self._statsLinkHandler,
                tip=tr.actions_shortcut_key(val="T"),
                id="stats",
                icon=_TOOLBAR_ICONS["stats"],
            ),
            # charged_up: the MCAT knowledge-graph VIEW, integrated as a
            # main-window screen. Labelled "Map" for intuitiveness — it reads
            # like "the map of what I know", not an abstract "graph".
            self.create_link(
                "graph",
                "Map",
                self._graphLinkHandler,
                tip=tr.actions_shortcut_key(val="G"),
                id="graph",
                icon=_TOOLBAR_ICONS["graph"],
            ),
        ]

        links.append(self._create_sync_link())

        gui_hooks.top_toolbar_did_init_links(links, self)

        return "\n".join(links)

    # Add-ons
    ######################################################################

    def _left_tray_content(self) -> str:
        left_tray_content: list[str] = []
        gui_hooks.top_toolbar_will_set_left_tray_content(left_tray_content, self)
        return self._process_tray_content(left_tray_content)

    def _right_tray_content(self) -> str:
        right_tray_content: list[str] = []
        gui_hooks.top_toolbar_will_set_right_tray_content(right_tray_content, self)
        return self._process_tray_content(right_tray_content)

    def _process_tray_content(self, content: list[str]) -> str:
        return "\n".join(f"""<div class="tray-item">{item}</div>""" for item in content)

    # Sync
    ######################################################################

    def _create_sync_link(self) -> str:
        name = tr.qt_misc_sync()
        title = tr.actions_shortcut_key(val="Y")
        label = "sync"
        self.link_handlers[label] = self._syncLinkHandler

        # charged_up: match the icon + label vocabulary of the center items.
        # The sync-state color (needs-sync) lands on the whole pill via the
        # #sync .normal-sync / .full-sync rules, so it's obvious at a glance;
        # the spinner still replaces the glyph while a sync is running.
        icon = _TOOLBAR_ICONS["sync"]
        return f"""
<a class=hitem tabindex="-1" aria-label="{name}" title="{title}" id="{label}" href=# onclick="return pycmd('{label}')"
><span class="hicon">{icon}<img id=sync-spinner src='/_anki/imgs/refresh.svg'></span><span class="hlabel">{name}</span>
</a>"""

    def set_sync_active(self, active: bool) -> None:
        method = "add" if active else "remove"
        self.web.eval(
            f"document.getElementById('sync-spinner').classList.{method}('spin')"
        )

    def set_sync_status(self, status: SyncStatus) -> None:
        self.web.eval(f"updateSyncColor({status.required})")

    def update_sync_status(self) -> None:
        get_sync_status(self.mw, self.mw.toolbar.set_sync_status)

    # Link handling
    ######################################################################

    def _linkHandler(self, link: str) -> bool:
        if link in self.link_handlers:
            self.link_handlers[link]()
        return False

    def set_active_item(self, state: str) -> None:
        # charged_up: highlight the toolbar item that owns this screen so the
        # user always knows where they are. Modal surfaces (Add/Browse) aren't
        # states, so they clear the highlight — expected.
        item_id = _STATE_TO_ACTIVE_ITEM.get(state, "")
        self.web.eval(
            f"if (window.setActiveToolbarItem) setActiveToolbarItem('{item_id}')"
        )

    def _homeLinkHandler(self) -> None:
        # charged_up: return to the Nexus front-door screen.
        self.mw.moveToState("home")

    def _deckLinkHandler(self) -> None:
        self.mw.moveToState("deckBrowser")

    def _studyLinkHandler(self) -> None:
        # if overview already shown, switch to review
        if self.mw.state == "overview":
            self.mw.col.startTimebox()
            self.mw.moveToState("review")
        else:
            self.mw.onOverview()

    def _addLinkHandler(self) -> None:
        self.mw.onAddCard()

    def _browseLinkHandler(self) -> None:
        self.mw.onBrowse()

    def _statsLinkHandler(self) -> None:
        # charged_up: review stats live in-window now (no popup dialog).
        self.mw.moveToState("stats")

    def _graphLinkHandler(self) -> None:
        self.mw.moveToState("knowledgeGraph")

    def _syncLinkHandler(self) -> None:
        self.mw.on_sync_button_clicked()

    # HTML & CSS
    ######################################################################

    _body = """
<div class="header">
  <div class="left-tray">{left_tray_content}</div>
  <div class="toolbar">{toolbar_content}</div>
  <div class="right-tray">{right_tray_content}</div>
</div>
<script>
// charged_up: live "you are here" highlight, updated by set_active_item() on
// every state change without redrawing the whole bar.
window.setActiveToolbarItem = function (id) {
  document.querySelectorAll('.hitem').forEach(function (el) {
    el.classList.remove('active');
  });
  if (id) {
    var el = document.getElementById(id);
    if (el) { el.classList.add('active'); }
  }
};
</script>
"""


# Bottom bar
######################################################################


class BottomBar(Toolbar):
    _centerBody = """
<center id=outer><table width=100%% id=header><tr><td align=center>
%s</td></tr></table></center>
"""

    def draw(
        self,
        buf: str = "",
        web_context: Any | None = None,
        link_handler: Callable[[str], Any] | None = None,
    ) -> None:
        # note: some screens may override this
        web_context = web_context or BottomToolbar(self)
        link_handler = link_handler or self._linkHandler
        self.web.set_bridge_command(link_handler, web_context)
        self.web.stdHtml(
            self._centerBody % buf,
            css=["css/toolbar.css", "css/toolbar-bottom.css"],
            context=web_context,
        )
        self.web.adjustHeightToFit()
