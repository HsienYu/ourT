# Stage Script Projection: Manual Verification Protocol

## Setup

- [ ] Server and Projection are running.
- [ ] A text-generation provider key is configured in Control.
- [ ] Projection is visible at its intended rehearsal distance.

## Checks

| Check | Expected | Evidence |
|---|---|---|
| Set 3 roles and enable 系統作為角色, then select `產生約 1000 字劇本` | Control reports at least 1,000 characters, 4+ segments, provider/model; Projection remains in AI view until explicitly shown; the script contains 系統 plus two other named speakers | |
| Set 3 roles and disable 系統作為角色 | Script contains three named speakers and 系統 does not speak | |
| Inspect the Projection | Multiple dialogue/stage-direction lines are legible, with no Markdown or clipped bottom line | |
| Select `下一段` repeatedly | Every reported block is reachable; the final block remains stable when selected again | |
| Select `上一段` repeatedly | The prior block appears; the first block remains stable when selected again | |
| Reload Projection during script reading | The same script and current block are restored | |
| Start KTV playback | Script exits and Projection enters KTV; after playback ends it returns to AI view | |
| Select `關閉劇本` | Projection returns to AI view while the generated script and page remain stored | |
| Select `顯示劇本` after closing | The same stored script returns at the preserved page | |
