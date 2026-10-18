# Private room transport V1

The Wasm boundary owns this positional Postcard contract. It does not serialize native resources or published SimCommand variants. All unsigned integers use canonical Postcard varints; u8 tags and option markers occupy one byte. Strings are a u32 UTF-8 byte length followed by the bytes. Collections start with a u32 count. Options are 0 for None or 1 followed by the value. Unknown tags, malformed UTF-8, noncanonical or overflowing integers, duplicate map keys and trailing input fail.

Every response starts `(version:u8=1,status:u8,payload)`. Status 0 selects the method's success payload; status 1 selects `(code:u8,detail:Option<u64>)`. Error responses never contain a success payload. JavaScript retains all token fields, revisions and error details as bigint. `RoomWireError` reports malformed packets or invalid browser request values; native refusals use `RoomResult<T>` with `ok:false` and the typed error. Consumers preserve the draft and clear pending exit intent on either failure.

| Method | Success payload |
| --- | --- |
| Begin, stage name, commit, discard review, cancel, end | Empty |
| `room_summaries` | `width:u32,height:u32,rows:Vec<(selection_key:u32,anchor:Option<(u32,u32)>,name:String,area:u32)>` |
| `room_tiles`, `build_component_tiles` | `Vec<(x:u32,y:u32)>` |
| `build_component_predecessors` | `Vec<u32>` containing eligible old RoomIds |
| `take_build_error` | `Option<(code:u8,detail:Option<u64>)>` |
| Prepare | Review below |

`build_active` and `build_dirty` return primitive booleans. `rooms_revision` returns an exact u64. Summary, membership and revision queries are pure. Outside is selection key 0 with None anchor and may have zero area. Enclosed selections have a nonzero stable RoomId, a live anchor and positive area. Active-Build summaries use confirmed membership translated into the draft frame, with staged names. New final components are addressed by preparation token and anchor.

| Record | Ordered fields |
| --- | --- |
| Token | `session:u64,revision:u64,preparation:u64` |
| Review | `token:Token,groups:Vec<Group>,rooms:Vec<ReviewRoom>,retired_names:Vec<(id:u32,name:String)>,duties:Duties` |
| Group | `kind:u8,old_ids:Vec<u32>,final_anchors:Vec<(u32,u32)>,former_tiles:Vec<(u32,u32)>,openings:Vec<(axis:u8,x:u32,y:u32)>` |
| ReviewRoom | `selection_key:u32,anchor:Option<(u32,u32)>,name:String,previous_name:Option<String>,previous_area:u32,area:u32` |
| Duties | `duties:Vec<Duty>,replanned_people:Vec<u32>,unavailable_people:Vec<u32>` |
| Duty | `key:ChoreKey,previous:Option<ChoreKey>,owner:Option<u32>,kind:u8` |
| ChoreKey | `kind:u8,target:u32` |
| Stage-name request | `version:u8=1,selection_key:u32,raw_name:String` |
| Prepare request | `version:u8=1,expected_review:Option<Token>,inheritance:Vec<(anchor:(u32,u32),id:Option<u32>)>,names:Vec<(anchor:(u32,u32),name:String)>,outside_name:Option<String>` |

Group tags are 0 Split, 1 Merge, 2 Repartition, 3 LostEnclosure. Axis tags are 0 Vertical and 1 Horizontal. Duty tags are 0 Unchanged, 1 Reassigned, 2 Automatic, 3 Unassigned, 4 Retired. Chore tags are 0 Dishes, 1 Floors, 2 Surfaces, 3 Bins, 4 CounterSurfaces, 5 TableSurfaces. Chore preference indices are a separate namespace and deliberately collapse grouped surface kinds.

Error codes are 1 NotActive, 2 AlreadyActive, 3 AllocationFailed, 4 CounterExhausted, 5 InvalidRoom, 6 InvalidName, 7 Room, 8 ReplayMismatch, 9 DraftMismatch, 10 Validation, 11 StaleToken, 12 CommandNotAllowed, 13 MalformedWire, 14 PayloadTooLarge. Only 7, 8 and 10 carry detail: explicit RoomError tag, journal index, and explicit SaveError tag respectively. RoomError tags 1-13 are MissingGrid, MissingLayout, InvalidDimensions, InvalidArchitecture, AllocationFailed, FloodFillBound, InvalidRoomMap, InvalidRegistry, InvalidChoice, InvalidName, IdExhausted, DefaultNameExhausted, TooManyRecords. SaveError tags 1-10 are IncompatibleContent, InvalidGrid, TooManyEntities, InvalidEntityOrder, InvalidEntityReference, InvalidContentReference, InvalidValue, DuplicateSelection, InvalidSimIdAllocator, TooManyCommands.

1. Initial/default preparation has None expected token and empty choices. Edited choices require the exact prior token, validated before preparation can drain input. Omitted inheritance uses native defaults; explicit None requests a fresh ID; Some(0) is invalid. Duplicate anchor keys fail before map conversion. Names and inheritance may share an anchor.
2. Predecessor lookup validates the token and final anchor, then reads retained native sparse overlaps. Empty is valid for a new unrelated component. A nonexistent anchor fails. Structural eligibility is independent of currently selected choices; native resolution enforces the global one-use rule.
3. Duty owners are stable SimIds. Replanned and unavailable people are raw entity indices from prepared chore tasks. Floors and grouped surface keys use room identities, including Outside 0; object surfaces and bins use object entity indices; Dishes uses shared target 0. Zero person, request, order and copy IDs are valid.
4. Native request ingress is capped at 16,777,216 bytes before allocation. Collection counts are bounded by grid/registry/entity capacity and remaining bytes before allocation. No arbitrary room or outbound byte cap is imposed. Generated duty counts derive from both baseline and final key producers, rather than the saved assignment-list ceiling.
5. Native name validation rejects raw controls before Rust whitespace trimming, then accepts 1-48 Unicode scalars. Canonical names fit 192 UTF-8 bytes. Raw names have no separate 1024-byte cap. The browser rejects lone UTF-16 surrogates before encoding and uses the same whitespace/scalar rules without changing transmitted text.

The independent native and TypeScript literals in `room_transport_tests.rs` and `room-codec.test.ts` pin field order and unequal token values above 2^53, including u64::MAX. Actual-module tests exercise native semantic rejection separately from byte decoding.

The Wasm serializer borrows the native review through `prepare_build_commit_projected`. Native code invokes this fallible, protocol-free projector after private candidate validation and before changing the preparation counter or installing Prepared. A projection failure therefore retains the previous token, baseline, raw draft, pending names and runtime observations when that token was valid and no new input was queued. Preparation still settles newly pending input at entry; this guarantee does not claim otherwise. Native core does not import wire types or serialization.
