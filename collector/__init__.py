"""
The collector: the only thing that talks to the inverters. It polls them, stores the raw register
words it reads (uninterpreted) and serves them as a small token-protected feed. See PROTOCOL.md.

    python -m collector
"""
