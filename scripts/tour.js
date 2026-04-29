/* global Tour, game, ui, Hooks, foundry */

import { MODULE_ID } from "./const.js";

const SETTING_TOUR_DONE = "lancerForkTourCompleted";

function _kbBinding(action) {
    try {
        const b = game.keybindings.get(MODULE_ID, action)?.[0];
        return b?.key?.replace(/^Key/, "").replace(/^Bracket/, "").replace(/^Digit/, "") ?? null;
    } catch {
        return null;
    }
}

function _buildSteps() {
    const free = _kbBinding("freeMovement") ?? "F";
    const debug = _kbBinding("debugMovement") ?? "V";
    const teleport = _kbBinding("forceTeleport") ?? "T";
    const ground = _kbBinding("forceToGround") ?? "G";
    const path = _kbBinding("togglePathfinding") ?? "P";
    const elevDown = _kbBinding("decrementElevation") ?? "[";
    const elevUp = _kbBinding("incrementElevation") ?? "]";
    const wp = _kbBinding("addWaypoint") ?? "=";
    const rmWp = _kbBinding("removeWaypoint") ?? "-";

    return [
        {
            id: "intro",
            title: "Elevation Ruler (Lancer fork)",
            content:
                "Custom fork of Elevation Ruler, tuned for Lancer. Replaces the Foundry ruler with a movement aware one " +
                "that measures real movement cost: terrain, elevation, climbing, hover, flight, all of it.",
            selector: null,
        },
        {
            id: "token-drag",
            title: "Drag from a token",
            content:
                "Click and drag a token, the ruler shows up by itself. The label is the actual cost spent, not raw distance. " +
                "Coloured highlighting shows the speed brackets (standard move, boost, etc).",
            selector: null,
        },
        {
            id: "ctrl-drag",
            title: "Ctrl+drag for the plain ruler",
            content:
                "If you just want to measure something without moving anything, hold Ctrl and drag from any empty spot on the canvas. " +
                "That gives you the vanilla Foundry ruler, distance only, no token follow.",
            selector: null,
        },
        {
            id: "shortcuts-movement",
            title: "Movement mode shortcuts",
            content:
                "While dragging, hold one of these to change how the move is treated:" +
                "<ul>" +
                `<li><b>${free}</b>: free movement, no terrain penalty (white highlight).</li>` +
                `<li><b>${debug}</b>: debug movement, skips all automation (no triggers, no history, no engagement).</li>` +
                `<li><b>${teleport}</b>: teleport, no animation, marked as teleport.</li>` +
                `<li><b>${ground}</b>: force to ground / flying mode toggle.</li>` +
                `<li><b>${path}</b>: toggle pathfinding for this drag.</li>` +
                "</ul>",
            selector: null,
        },
        {
            id: "shortcuts-elevation",
            title: "Elevation and waypoints",
            content:
                "<ul>" +
                `<li><b>${elevDown}</b> / <b>${elevUp}</b>: lower / raise elevation of the current waypoint by one grid unit.</li>` +
                `<li><b>${wp}</b> / <b>${rmWp}</b>: add / remove a waypoint at the cursor.</li>` +
                "</ul>" +
                "All of these can be rebound under Configure Controls, Elevation Ruler section.",
            selector: null,
        },
        {
            id: "history",
            title: "Combat history",
            content:
                "In combat, the ruler keeps a trail of everything the token did this turn. " +
                "Hover the token to see the dashed trail with the cost of each leg. " +
                "That trail is also what Lancer Automations uses to split boost and move into legs.",
            selector: null,
        },
        {
            id: "outro",
            title: "That's it",
            content:
                "Re run this tour any time from Settings, Tours, Elevation Ruler. " +
                "More options under Configure Settings, Module Settings, Elevation Ruler.",
            selector: null,
        },
    ];
}

let _tour = null;

export function registerTourBootstrap() {
    Hooks.once("init", () => {
        game.settings.register(MODULE_ID, SETTING_TOUR_DONE, {
            scope: "world",
            config: false,
            type: Boolean,
            default: false,
        });
    });

    Hooks.once("setup", () => {
        try {
            _tour = new Tour({
                title: "Elevation Ruler (Lancer fork)",
                description: "What the fork does, how to drag from a token, and the shortcut keys.",
                display: true,
                canBeResumed: false,
                steps: _buildSteps(),
            });
            game.tours.register(MODULE_ID, "lancer-fork-tour", _tour);
        } catch (e) {
            console.error(`${MODULE_ID} | failed to register tour`, e);
        }
    });

    Hooks.once("ready", async () => {
        if (!game.user.isGM) return;
        // Only auto launch on the Lancer fork (the upstream module doesn't expose moveTokenTo).
        const isLancerFork = !!game.modules.get(MODULE_ID)?.api?.moveTokenTo;
        if (!isLancerFork) return;
        let done = true;
        try {
            done = !!game.settings.get(MODULE_ID, SETTING_TOUR_DONE);
        } catch { /* not ready */ }
        if (done) return;
        if (!_tour) return; // Setup registration failed; do nothing so the user gets another shot next reload.
        try {
            await _tour.start();
            await game.settings.set(MODULE_ID, SETTING_TOUR_DONE, true);
        } catch { /* tour failed mid-flight, leave the flag false so it retries */ }
    });
}
