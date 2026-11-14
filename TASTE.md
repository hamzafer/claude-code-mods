# Core Taste Principles

Always build code cleanly, modularly, and with proper architecture and separation of concerns. Never simply bolt on a feature because I asked for it. If you can’t find an easy way to build it naturally, and you'd recommend a refactor to make the whole thing cleanly, stop your work ahead of time and say so.

## Codebase slop indicators: Avoid these

- implicit coupling
- layer-first folders
- duplication
- representable illegal states
- god files
- shotgun surgery
- layering violations
- pass-through wrappers
- errors / validation not at the boundary

## UX, DX, AX Taste
Always find all of the implicit state machines in my app. Make the best decision that will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always, without breaking anything.
