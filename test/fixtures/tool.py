#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os


class Store:
    """Docstring stays. # not a comment"""

    # XXX: keyed by lowercase path
    cache = {}

    def load(self, path):  # type: ignore
        s = "# not a comment"
        # normalise first
        return os.path.normcase(path) + s


# module level note
LIMIT = 10  # trailing limit note
