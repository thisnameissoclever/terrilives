# Artificial play setup

These files make the played verification repeatable. They are not immutable historical compatibility fixtures.

1. `r6-room-play-current16.sav`, SHA256 `a75def6a369c5d29a25faf8b8f60fb38eaf647d9f6b4306e7f9e4e4bcd924f45`, is the actual current output from R6's funded seven-room scenario. The matching producer/result receipt records seven enclosures plus Outside, 30x26 and original frame `(10,10)`.
2. `room-play-dirt-current16.sav`, SHA256 `1c6cee2e692650b0101ea9a1699fb6b04ab060bf14d51ed9e0c83016d2fd2c57`, changes only selected dirt records. Its receipt records strict current loading, exact resave, zero added ticks and exact comparison of every other snapshot field. `room-play-dirt-input.json` records actual native Kitchen/Outside targets and dining_table entity 7.
3. `matched-baseline838.sav`, SHA256 `4688ccbdc7628d70808f2434c91b7083452d83345c819c998430bee4f8610b6a`, is an actual captured public save after the played cleaning, names, Patio and west-land sequence. It reconstructs the matched color scene after HTML hot reload. It is not an unchanged historical household or a new migration fixture.

Serve copies only from ignored `web/.scratch/` in a task-owned browser profile. The saved-file preparation writes the isolated origin's `terri-save-1.bin` before ordinary Load; it does not mutate live game memory. Keep needs, autonomy and tuning unchanged. The helpers require their recorded state and command order; they are evidence sources, not a general-purpose batch to run blindly.
