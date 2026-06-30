# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up: the MCAT knowledge-graph VIEW.

A read-only QDialog that hosts the SvelteKit "knowledge-graph" route. The route renders the
<100KB graph sidecar and lights each leaf from a LIVE MasteryQuery RPC — this dialog opens no
collection state of its own and writes nothing. Reached only via the Tools-menu item, which is
hidden unless the (default-off) profile feature flag is set; see profiles.knowledge_graph_enabled.
"""

from __future__ import annotations

import aqt
import aqt.main
from aqt.qt import *
from aqt.utils import disable_help_button, restoreGeom, saveGeom
from aqt.webview import AnkiWebView, AnkiWebViewKind


class KnowledgeGraphDialog(QDialog):
    "The MCAT knowledge-graph VIEW (feature-flagged, read-only)."

    TITLE = "knowledgeGraph"
    silentlyClose = True

    def __init__(self, mw: aqt.main.AnkiQt) -> None:
        QDialog.__init__(self, mw, Qt.WindowType.Window)
        self.mw = mw
        self._setup_ui()

    def _setup_ui(self) -> None:
        self.mw.garbage_collect_on_dialog_finish(self)
        self.setMinimumWidth(640)
        self.setMinimumHeight(480)
        disable_help_button(self)
        restoreGeom(self, self.TITLE, default_size=(1000, 760))

        self.web = AnkiWebView(kind=AnkiWebViewKind.KNOWLEDGE_GRAPH)
        self.web.load_sveltekit_page("knowledge-graph")
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.web)
        self.setLayout(layout)
        self.setWindowTitle("Knowledge Graph")
        self.show()
        self.web.hide_while_preserving_layout()

    def reject(self) -> None:
        self.web.cleanup()
        self.web = None  # type: ignore
        saveGeom(self, self.TITLE)
        aqt.dialogs.markClosed("KnowledgeGraph")
        QDialog.reject(self)
