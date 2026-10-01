use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use terri_core::{Agent, NeedId, Needs, Position, SelfPreservation, SimRng, TileGrid};
use terri_sim::systems::autonomy::{Decision, DecisionTelemetry};

struct Counted;
static LIVE: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counted {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() { LIVE.fetch_add(layout.size(), Relaxed); }
        ptr
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc_zeroed(layout);
        if !ptr.is_null() { LIVE.fetch_add(layout.size(), Relaxed); }
        ptr
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
        LIVE.fetch_sub(layout.size(), Relaxed);
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let next = System.realloc(ptr, layout, size);
        if !next.is_null() {
            if size >= layout.size() { LIVE.fetch_add(size - layout.size(), Relaxed); }
            else { LIVE.fetch_sub(layout.size() - size, Relaxed); }
        }
        next
    }
}
#[global_allocator]
static ALLOCATOR: Counted = Counted;

fn main() {
    let maintain = std::env::args().nth(1).as_deref() == Some("--clear-trackers");
    let mut sim = terri_sim::Sim::new_from_shipped_lot_with_seed(104729 | (130363u64 << 32));
    let grid = sim.world().resource::<TileGrid>();
    let (width, height) = (grid.width(), grid.height());
    let mut positions = Vec::new();
    for cell in 0..width * height {
        let (x, y) = ((cell % width) as i32, (cell / width) as i32);
        if sim.world().resource::<TileGrid>().is_walkable(x, y) { positions.push((x as f32, y as f32)); }
    }
    for index in 0..1000 {
        let (x, y) = positions[index % positions.len()];
        let instinct = sim.world_mut().resource_mut::<SimRng>().range(101) as u8;
        sim.world_mut().spawn((SelfPreservation(instinct), Agent, Position { x, y }, Needs::with(NeedId::Hunger, 100.0)));
        sim.sync_render_buffer();
    }
    println!("tick,live_bytes,removed_messages,current_messages,archetypes,tables,table_capacity,decisions,choice_len,telemetry_capacity_bytes,world_hash");
    for tick in 1..=1680 {
        sim.tick();
        if maintain { sim.world_mut().clear_trackers(); }
        sim.sync_render_buffer();
        if ![60, 600, 1140, 1680].contains(&tick) { continue; }
        let live = LIVE.load(Relaxed);
        let world = sim.world();
        let removed: usize = world.removed_components().iter().map(|(_, m)| m.len()).sum();
        let current: usize = world.removed_components().iter().map(|(_, m)| m.iter_current_update_messages().len()).sum();
        let table_capacity: usize = world.storages().tables.iter().map(|table| table.capacity()).sum();
        let (decisions, choice_len, telemetry_capacity) = world.get_resource::<DecisionTelemetry>().map_or((0, 0, 0), |rows| {
            (rows.0.len(), rows.0.iter().map(|d| d.choices.len()).sum::<usize>(),
             rows.0.capacity() * std::mem::size_of::<Decision>() + rows.0.iter().map(|d| d.choices.capacity()).sum::<usize>() * std::mem::size_of::<(u32, u32, f32, f32, f64)>())
        });
        println!("{tick},{live},{removed},{current},{},{},{table_capacity},{decisions},{choice_len},{telemetry_capacity},{}", world.archetypes().len(), world.storages().tables.len(), sim.world_hash());
        if tick == 1680 {
            for (id, messages) in world.removed_components().iter() {
                if !messages.is_empty() {
                    println!("removed,{},{},{}", world.components().get_info(*id).unwrap().name(), messages.len(), messages.oldest_message_count());
                }
            }
        }
    }
    drop(sim);
    println!("after_drop_live_bytes,{}", LIVE.load(Relaxed));
}
