# Orvex fork maintenance

`orvex` is the Orvex-maintained branch. `main` remains aligned with the upstream
`backnotprop/plannotator` default branch and is not the place for Orvex changes.

To refresh `orvex` from upstream, fetch upstream and rebase the Orvex commits onto
its current default branch:

```sh
git fetch upstream
git switch orvex
git rebase upstream/main
```

Resolve any conflicts in the Orvex commits, review the resulting diff, then push
the updated branch to `orvexai/plannotator`. Since a rebase rewrites commits,
use `--force-with-lease` only when publishing an intentional rebase and after
checking the remote branch. Never mirror-push upstream refs to the fork.
