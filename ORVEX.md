# Orvex fork maintenance

`orvex` is the Orvex-maintained default branch. `main` is a fast-forward mirror
of `backnotprop/plannotator`'s `main`; keep Orvex changes on `orvex`.

## Set up and sync upstream

Add the upstream remote once, then fast-forward the mirror branch and merge it
into `orvex`:

```sh
git remote add upstream https://github.com/backnotprop/plannotator.git
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push orvexai main
git switch orvex
git merge --no-edit main
git push orvexai orvex
```

Do not rebase `orvex` onto upstream and do not force-push. Resolve merge
conflicts in `orvex` and commit the merge before pushing. An exceptional
force-push to repair history requires creating and verifying a `backup/*` tag
first.

GitHub's fork network initially copied roughly 471 upstream branch refs into
this fork. They are inherited refs; do not mirror-push upstream refs or use a
mirror push that can overwrite Orvex branches.
