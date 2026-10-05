// Frozen furniture placements shared by historical test builders. Captured
// from content/lot.toml and object base facings at e356b949. Keep production
// migration validation independent; era-specific walls, dimensions and the
// pre-rotation bathtub override stay local.
{
    use terri_core::Facing::{NorthEast as NE, NorthWest as NW, SouthEast as SE, SouthWest as SW};
    [
        ("fridge", 0.0, 0.0, SW),
        ("counter", 1.0, 0.0, SW),
        ("stove", 2.0, 0.0, SW),
        ("counter", 3.0, 0.0, SW),
        ("kitchen_sink", 4.0, 0.0, SW),
        ("counter", 5.0, 0.0, SW),
        ("trashcan", 6.0, 0.0, SE),
        ("dining_table", 2.0, 3.0, SE),
        ("chair", 1.0, 3.0, NE),
        ("chair", 4.0, 3.0, SW),
        ("bookshelf", 8.0, 0.0, SE),
        ("long_sofa", 10.0, 0.0, SE),
        ("armchair", 13.0, 0.0, SE),
        ("potted_plant", 15.0, 0.0, SE),
        ("coat_rack", 15.0, 1.0, SE),
        ("floor_lamp", 14.0, 2.0, SE),
        ("radio", 8.0, 3.0, SE),
        ("television", 10.0, 3.0, SE),
        ("sofa", 12.0, 3.0, SE),
        ("double_bed", 0.0, 6.0, SE),
        ("nightstand", 2.0, 6.0, SW),
        ("dresser", 0.0, 10.0, SE),
        ("moving_box", 4.0, 11.0, SE),
        ("desk", 6.0, 6.0, SW),
        ("desk_chair", 6.0, 7.0, NW),
        ("bed", 9.0, 6.0, SE),
        ("reading_chair", 9.0, 9.0, SE),
        ("reference_shelf", 6.0, 10.0, SE),
        ("potted_plant", 10.0, 11.0, SE),
        ("toilet", 12.0, 6.0, SE),
        ("shower", 14.0, 6.0, SE),
        ("bathtub", 14.0, 9.0, SW),
        ("sink", 12.0, 10.0, SE),
        ("laundry", 12.0, 11.0, SE),
    ]
}
