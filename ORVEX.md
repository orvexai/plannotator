# Orvex fork maintenance

`orvex` is the Orvex-maintained branch. Keep Orvex changes and upstream
integration commits on `orvex`. Leave the fork's `main` mirror branch untouched.

## Upstream sync

Merge upstream directly into a work branch based on the current `orvex` tip.
Preserve upstream history with a normal merge commit, resolve conflicts while
keeping the Orvex features below, then push the work branch and open a PR with
`orvex` as its base:

```sh
git remote add upstream https://github.com/backnotprop/plannotator.git
git fetch upstream
git switch -c lane/<name> orvex
git merge --no-ff upstream/main
git push -u orvexai lane/<name>
```

Do not update or push the fork's `main` mirror as part of an upstream sync. Do
not squash, rebase, or force-push. Review and land the PR into `orvex` through
the normal PR process.

## Orvex features to preserve

- Artifact Server sharing, including publish and comment retrieval through the
  configured Artifact Server CLI profile and project.
- Tenant review links returned by Artifact Server, with strict validation of
  tenant slugs before comment retrieval.
- Artifact Server comment threads and reply authors carried into annotation
  drafts and restored with their attribution.
- No public Plannotator share-hosting routes or public short-link service in the
  shipped server runtimes.
- Orvex Artifact Server configuration and guidance in the main and plugin
  documentation.

GitHub's fork network initially copied roughly 471 upstream branch refs into
this fork. They are inherited refs; do not mirror-push upstream refs or use a
mirror push that can overwrite Orvex branches.
