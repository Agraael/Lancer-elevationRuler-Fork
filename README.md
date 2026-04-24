# Elevation Ruler (Lancer Fork)

**GitHub Repository:** [https://github.com/Agraael/Lancer-elevationRuler-Fork](https://github.com/Agraael/Lancer-elevationRuler-Fork)
**Original Repository:** [https://github.com/caewok/fvtt-elevation-ruler](https://github.com/caewok/fvtt-elevation-ruler)

This is a messy fork of Elevation Ruler tailored for my Lancer needs. It fixes and adds several things:

*   **Lancer Token Size:** Properly handles Lancer token sizes.
*   **Movement History:** Remembers how much you already moved this turn.
*   **Terrain Height Tool Integration:** Works with my fork of Terrain Height Tool.
*   **Flying:** A flying token can change altitude for free, as long as it stays within its SPEED. Beyond that, the extra altitude costs like a second move.
*   **Hover / Climber:** Hover works like flying. Climber removes the extra cost of climbing, but climbing still uses movement.
*   **Terrain height:** A token sitting on top of a terrain is not penalized. Only tokens inside or below the terrain pay the cost.
*   **Zones:** A difficult-terrain zone placed on top of a raised terrain follows the height of that terrain. A token above the terrain is not penalized.
*   **Warning icon fix:** The warning icon for difficult terrain now shows correctly on the second move of a turn and when a token has elevation.

## Keyboard shortcuts

While measuring (ruler active or dragging a token):

*   `[` : lower the destination by one step
*   `]` : raise the destination by one step
*   `=` : add a waypoint
*   `-` : remove the last waypoint
*   `P` : toggle pathfinding on or off for this measurement
*   `G` : snap the destination to the ground
*   `T` : teleport (no path, direct move)
*   `F` : mark the segment as free movement (ignored by the total cost, shown in white)
*   `V` : debug move - drop the token without running any automation (no history, no triggers, no highlights)

## Installation

**Manifest URL:**
```
https://raw.githubusercontent.com/Agraael/Lancer-elevationRuler-Fork/master/module.json
```
