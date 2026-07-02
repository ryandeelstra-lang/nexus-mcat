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
from aqt.webview import AnkiWebView, AnkiWebViewKind


class HideMode(enum.IntEnum):
    FULLSCREEN = 0
    ALWAYS = 1


# charged_up: which toolbar item id owns the "active" highlight for each
# MainWindowState. Modal surfaces (Add, Browse) are not states, so they never
# hold a persistent active state — that is expected.
# charged_up (Decision 43): the toolbar menu is gone (the app is the full-bleed garden), so
# there are no nav items to highlight. Kept as an empty map so set_active_item stays a no-op.
_STATE_TO_ACTIVE_ITEM: dict[str, str] = {}


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
        # charged_up (Decision 43): the toolbar menu and all its per-surface link
        # handlers (home / decks / study / add / browse / stats / graph / garden /
        # sync) are gone — the app boots straight into the garden. Start empty;
        # add-ons may still register handlers via create_link().
        self.link_handlers: dict[str, Callable] = {}
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
        # charged_up (Decision 43): the app IS the Knowledge Garden — there is no navigation
        # menu. The garden owns the whole window and hides this toolbar entirely (see
        # AnkiQt._gardenState). No Home / Decks / Add / Browse / Stats / Map / Sync links.
        links: list[str] = []
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

    def set_sync_active(self, active: bool) -> None:
        # charged_up (Decision 43): #sync-spinner only existed inside the removed
        # toolbar sync link; guard so media sync can't throw in the webview.
        method = "add" if active else "remove"
        self.web.eval(
            "var el = document.getElementById('sync-spinner'); "
            f"if (el) el.classList.{method}('spin');"
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

    # charged_up (Decision 43): the per-surface link handlers (home / decks / study / add /
    # browse / stats / graph / garden / sync) are removed with the toolbar menu itself. The
    # app boots straight into the garden; there is nothing to navigate to.

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
