# Contributing to Uzero

Thanks for helping. Bug reports and ideas are welcome in [issues](https://github.com/anvilnine/uzero/issues). For big changes, open an issue first so we can agree on the approach.

## Before you send a pull request

```bash
pnpm test && pnpm typecheck && pnpm check
```

- Keep permissions minimal. Uzero must never add scripts to Google's sign-in pages, read passwords, or send data anywhere except Google.
- Add or update tests for logic in `src/lib/`.

## License of your contribution

Uzero is licensed under GPL-3.0. By sending a contribution, you agree that:

1. your contribution is licensed under GPL-3.0, and
2. you grant the maintainer (anvilnine) a perpetual, worldwide, royalty-free right to also license your contribution under other terms, including commercial licenses.

You confirm that you wrote the contribution, or have the right to submit it under these terms.
