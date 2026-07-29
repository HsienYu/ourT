# App 2 Tests

Run from `app2-yolo/`:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

`test_label_assigner.py` covers YAML-label cleanup and stable assignment for
tracked and untracked people. Hardware rendering and tracker lifetime remain covered by
`../../tests/manual/app2-yolo.md`.
