---
"@adonis-agora/cms": patch
---

A shared login-attempt store that stops answering (a Redis client reconnecting to a server that is down queues commands instead of failing them) no longer hangs every login: a call gets one second, then counting falls back to this process's memory and the shared store is skipped for ten seconds before it is tried again.
