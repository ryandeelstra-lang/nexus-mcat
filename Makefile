# codebase/anki-garden/Makefile — §7h one-command bench. Kept OUT of justfile so `just check` never depends on it.
WT := $(CURDIR)
FIXTURE ?= /tmp/bench50k.anki2

.PHONY: bench
bench:
	PYTHONPATH=$(WT)/out/pylib:$(WT) $(WT)/out/pyenv/bin/python scripts/bench.py --collection $(FIXTURE) --iters 200
