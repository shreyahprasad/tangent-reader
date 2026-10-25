# Token fixtures

Made-up texts, written for this repo, for checking `estimateTokens` against Anthropic's own
counts. Nothing here comes from a real document or anyone's reading.

`counts.json` holds the counts measured with the free `count_tokens` endpoint, with the date and
the models. The estimate's test reads it, so a change to the estimate is checked against real
numbers, never against itself.
