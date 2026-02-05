/* globals canvas, game, Hooks, CONFIG, Sequence */
"use strict";

import { MODULE_ID } from "./const.js";

export function initTokenAnimationToolsCompat() {
  if (!game.modules.get('token-animation-tools')?.active) return;

  let savedAnimateSetting = null;
  let savedAnimateClientSetting = null;
  let isRestoringSettings = false;

  // Mettre à jour les valeurs sauvegardées quand l'utilisateur change les settings
  Hooks.on('changeSetting', (setting, value) => {
    if (isRestoringSettings) return; // Ignorer nos propres changements

    if (setting.key === 'token-animation-tools.animate') {
      savedAnimateSetting = value;
    } else if (setting.key === 'token-animation-tools.animate-client') {
      savedAnimateClientSetting = value;
    }
  });

  Hooks.on('preUpdateToken', (tokenDoc, changes, _options, _userId) => {
    const teleportState = CONFIG[MODULE_ID]?.teleportState;
    if (!teleportState || (changes.x === undefined && changes.y === undefined)) return;
    if (teleportState.tokenId !== tokenDoc.id) return;

    try {
      // Sauvegarder les settings la première fois seulement
      if (savedAnimateSetting === null) {
        savedAnimateSetting = game.settings.get('token-animation-tools', 'animate');
      }
      if (savedAnimateClientSetting === null) {
        savedAnimateClientSetting = game.settings.get('token-animation-tools', 'animate-client');
      }

      game.settings.set('token-animation-tools', 'animate', false);
      game.settings.set('token-animation-tools', 'animate-client', false);
    } catch (error) {
      console.error('elevationruler | Error disabling animations:', error);
    }
  });

  Hooks.on('updateToken', async (tokenDoc, changes, _options, _userId) => {
    const teleportState = CONFIG[MODULE_ID]?.teleportState;
    if (!tokenDoc) return;
    if (!teleportState || (changes.x === undefined && changes.y === undefined)) return;
    if (teleportState.tokenId !== tokenDoc.id) return;

    if (teleportState.origin && game.modules.get('sequencer')?.active) {
      try {
        const token = tokenDoc.object;
        // Vérifier que le token est rendu avant d'essayer de jouer l'effet
        if (!token) return;

        if (game.combat) {
          const scale = Math.max(1, tokenDoc.actor?.system?.size || 1);
          new Sequence()
            .effect()
            .file("jb2a.teleport.01.white")
            .atLocation(token)
            .anchor({ x: 0.5, y: 0.5 })
            .rotateTowards(teleportState.origin)
            .scale(scale)
            .play();
        }
      } catch (error) {
        console.error('elevationruler | Error playing teleport effect:', error);
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      isRestoringSettings = true;
      await game.settings.set('token-animation-tools', 'animate', savedAnimateSetting);
      await game.settings.set('token-animation-tools', 'animate-client', savedAnimateClientSetting);
      isRestoringSettings = false;
      CONFIG[MODULE_ID].teleportState = null;
    } catch (error) {
      isRestoringSettings = false;
      console.error('elevationruler | Error re-enabling animations:', error);
    }
  });
}
