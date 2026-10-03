# R2 credential validation

The Validate Androperator R2 credentials workflow runs on same-repository PRs
that change this harness or its workflow. Fork PRs run only the local tests.
After merge, it can also run manually from GitHub Actions.

It uses the four `ANDROPERATOR_CLOUDFLARE_*` upload secrets for account ID,
R2 bucket, access key ID, and secret access key. The bucket must be
`androperator-downloads`. It uploads a unique `_validation/` object, downloads
and compares its bytes, deletes it, then lists the prefix to verify removal.
Existing release objects and metadata are untouched.

Normal failures attempt cleanup and fail the job. A forcibly stopped runner
can interrupt cleanup; the printed object key identifies any leftover object.
Do not cancel an active validation run unless necessary.

Local checks require no credentials:

```sh
python3 -m unittest discover -s validation/cloudflare
```
