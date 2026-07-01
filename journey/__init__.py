# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up journey — the onboarding → diagnostic → DOK → mock user-journey layer
(Decisions 34-38). Out-of-process (not part of ``just check``); all mutable state goes to the
``scores.telemetry`` sidecar, never the collection (Decision 19). Members:

  - ``mc_notetype``  — the MCAT multiple-choice notetype (built at deck-authoring time) + the
                       runtime chosen-distractor capture (J0b).
  - (later) ``diagnostic`` (W7b/T8), ``dok`` (W9b/T9/F-AI.11), ``mock`` (S-DEBRIEF).
"""
