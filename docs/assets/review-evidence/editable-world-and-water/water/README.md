# Swimming and bathing in a saved household

The play checks used the ordinary production build in a 1280 by 720 desktop browser, with sound off and no stress Sims. Each saved household had one person. The checks issued orders and used Options, Save, Load and Clear orders through the game controls. The camera was zoomed in to inspect the swimmer and the ladder.

## Bath

The rubber duck, toy boat and toy submarine each appeared in a filled tub. The toy moved with the bather and the legs stayed under the water. Finishing emptied the tub and restored the usual outfit. Clearing an order removed the toy and water immediately.

The boat and submarine households were saved while the toy was in use. Reloading restored the same simulation tick, elapsed bath time, toy and world hash. The submarine household finished naturally at tick 43 after a reload. [Bath in progress](bath-submarine.png) · [After the bath](bath-finished.png) · [Recorded game states](bath-play.json)

## Pool

The ladder and its dry bay fit inside the original two-by-two purchase area. The water ends at the bay wall. The standing approach remains half a tile beyond the original edge. The person uses the sloping steps and turns on a 48 cm landing. Masculine trunks take their color from the pants and a feminine two-piece takes its color from the top.

Four rotations were played. The short, broad swimmer finished a complete visit. The tall, broad swimmer was saved while paddling and again while climbing out after cancellation. A third swimmer was interrupted in the air, finished the jump and climbed out. A fourth turned back before takeoff and resumed that retreat from a save. The saved and reloaded world hashes matched at each checkpoint. No browser console errors occurred in these runs. [Recorded game states](pool-play.json)

A visual reviewer inspected two sets of unlabeled descent frames. They identified the seated posture in the earlier version and the staggered feet on the inclined ladder in the revised one. The near wall hides some foot contacts from the rear. [Earlier descent](rejected-descent.png) · [Revised descent](ladder-descent.png) · [Paddling](paddling.png)

A separate check evaluated the drawing matrices between animation keys for eight body configurations, including both short profiles that previously stopped the renderer. All 14,960 sampled frames rendered. The final targeted geometry check found three residual surface contacts on the short, broad swimmer, up to 2.90 mm between the calf and the landing. Two earlier water-side observations found 1.76 mm of contact between the submerged shin and a ladder support, and 0.37 mm between hair and a rail. The tested footage showed no visible body or rail passing through the other during descent.
