# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""§8 three-build interleaving ablation (FULL / ABLATION / PLAIN).

Pre-registration: scores/ablation/README.md (frozen BEFORE any run, commit
034f44e33) + planning-repo docs/04-PLAN.md step 0.10 (git-dated 2026-06-30,
commit 4605174). Simulated learners study through the REAL v3 scheduler via
pylib; the interleaving effect enters ONLY through the order-agnostic
confusability mechanism. Output is CONFINED to the ablation report — it never
feeds scores/display.py, scores/readiness.py, or any user-facing score.
"""
